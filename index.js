// Direction-Manager 확장 - 3개 고정 플레이스홀더 관리 (컴팩트 UI 전용)
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, characters, this_chid } from "../../../../script.js";

// 확장 설정
const extensionName = "Direction-Manager";
const LOG_PREFIX = "[Direction-Manager v2]";

// 기본 Direction 프롬프트
const DEFAULT_DIRECTION_PROMPT = `<direction>
- Resume the story based on the director's instructions below.
- The director only provides drafts; refine them into natural prose instead of directly quoting the sentences.
- Creatively construct and fill in any parts lacking persuasive causality so that the narrative suggested by the director unfolds smoothly.

[Direction(If blank, develop the story as you see fit): {{direction}}]
</direction>`;

function defaultPlaceholderState() {
    return {
        enabled: false,
        content: "",
    };
}

function defaultScopeState() {
    return {
        direction: defaultPlaceholderState(),
        char: defaultPlaceholderState(),
        user: defaultPlaceholderState(),
    };
}

const defaultSettings = {
    global: defaultScopeState(),
    chars: {},
    chats: {},
    presets: {
        direction: [],
        char: [],
        user: [],
    },
    // 확장 메뉴 설정
    extensionEnabled: true,
    directionPrompt: DEFAULT_DIRECTION_PROMPT,
    promptDepth: 1, // 0: Chat History 끝에 삽입, >0: 끝에서부터 N번째 위치에 삽입
    defaultScope: "chat",
    _migratedV2: false,
};

// 현재 선택된 플레이스홀더 인덱스
let currentPlaceholderIndex = 0;
let currentScope = "chat";

// 플레이스홀더 정의 (순서대로)
const placeholders = [
    { key: "direction", name: "{{direction}}", isCustom: true },
    { key: "char", name: "{{char}}", isCustom: false },
    { key: "user", name: "{{user}}", isCustom: false },
];

// 컴팩트 UI 관련 변수들
let compactUIButton = null;
let compactUIPopup = null;

function cloneSettings(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function getSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    return extension_settings[extensionName];
}

function sanitizePlaceholderValue(value) {
    return {
        enabled: Boolean(value?.enabled),
        content: typeof value?.content === "string" ? value.content : "",
    };
}

function sanitizeScopeState(scopeState) {
    const source = scopeState || {};
    return {
        direction: sanitizePlaceholderValue(source.direction),
        char: sanitizePlaceholderValue(source.char),
        user: sanitizePlaceholderValue(source.user),
    };
}

function sanitizePresets(presets) {
    const src = presets || {};
    const sanitizePresetList = (arr) => Array.isArray(arr)
        ? arr
            .filter(item => item && typeof item.content === "string")
            .map(item => ({
                id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random()}`,
                name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "이름 없는 프리셋",
                content: item.content,
            }))
        : [];

    return {
        direction: sanitizePresetList(src.direction),
        char: sanitizePresetList(src.char),
        user: sanitizePresetList(src.user),
    };
}

function isGroupContext(context) {
    return Boolean(context?.groupId ?? context?.selected_group ?? context?.group?.id ?? context?.is_group);
}

function getCurrentCharKey() {
    const context = getContext();
    if (isGroupContext(context)) {
        return null;
    }

    if (this_chid != null && Array.isArray(characters) && characters[this_chid]) {
        return characters[this_chid].avatar || null;
    }

    return null;
}

function getCurrentChatName(context) {
    if (!context) return null;

    const candidates = [
        context.chatId,
        context.chatFileName,
        context.chatName,
        context.chat_id,
        context.chat_file,
        context.chat_file_name,
        context.chatMetadata?.file_name,
        context.metadata?.chat_file,
    ];

    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && String(candidate).trim() !== "") {
            return String(candidate);
        }
    }

    return null;
}

function getCurrentChatKey() {
    const context = getContext();
    const chatName = getCurrentChatName(context);
    if (!chatName) {
        return null;
    }

    const groupId = context?.groupId ?? context?.selected_group ?? context?.group?.id;
    if (groupId != null) {
        return `group::${groupId}::${chatName}`;
    }

    const charKey = getCurrentCharKey();
    if (!charKey) {
        return null;
    }

    return `${charKey}::${chatName}`;
}

function getScopeAvailability(scope) {
    if (scope === "global") {
        return { available: true, reason: "" };
    }

    if (scope === "char") {
        const context = getContext();
        if (isGroupContext(context)) {
            return { available: false, reason: "그룹 채팅에서는 캐릭터 스코프를 사용할 수 없습니다" };
        }

        if (!getCurrentCharKey()) {
            return { available: false, reason: "현재 캐릭터를 찾을 수 없습니다" };
        }

        return { available: true, reason: "" };
    }

    if (!getCurrentChatKey()) {
        return { available: false, reason: "현재 채팅을 찾을 수 없습니다" };
    }

    return { available: true, reason: "" };
}

function normalizeSettings() {
    const settings = getSettings();

    settings.global = sanitizeScopeState(settings.global);
    settings.chars = settings.chars && typeof settings.chars === "object" ? settings.chars : {};
    settings.chats = settings.chats && typeof settings.chats === "object" ? settings.chats : {};
    settings.presets = sanitizePresets(settings.presets);

    settings.extensionEnabled = typeof settings.extensionEnabled === "boolean"
        ? settings.extensionEnabled
        : defaultSettings.extensionEnabled;
    settings.directionPrompt = typeof settings.directionPrompt === "string"
        ? settings.directionPrompt
        : defaultSettings.directionPrompt;
    settings.promptDepth = Number.isInteger(settings.promptDepth)
        ? settings.promptDepth
        : defaultSettings.promptDepth;
    settings.defaultScope = ["global", "char", "chat"].includes(settings.defaultScope)
        ? settings.defaultScope
        : defaultSettings.defaultScope;
    settings._migratedV2 = Boolean(settings._migratedV2);

    Object.keys(settings.chars).forEach((key) => {
        settings.chars[key] = sanitizeScopeState(settings.chars[key]);
    });

    Object.keys(settings.chats).forEach((key) => {
        settings.chats[key] = sanitizeScopeState(settings.chats[key]);
    });
}

function migrateV1SettingsIfNeeded() {
    const settings = getSettings();

    if (settings._migratedV2) {
        return false;
    }

    const hasLegacy = ["direction", "char", "user"].some((key) => settings[key] !== undefined);
    if (!hasLegacy) {
        settings._migratedV2 = true;
        return true;
    }

    settings.global = sanitizeScopeState(settings.global);
    ["direction", "char", "user"].forEach((key) => {
        if (settings[key] !== undefined) {
            settings.global[key] = sanitizePlaceholderValue(settings[key]);
            delete settings[key];
        }
    });

    settings._migratedV2 = true;
    console.log(`${LOG_PREFIX} v1 설정을 v2 global 스코프로 마이그레이션했습니다.`);
    return true;
}

// 설정 로드
async function loadSettings() {
    const settings = getSettings();
    if (Object.keys(settings).length === 0) {
        Object.assign(settings, cloneSettings(defaultSettings));
    }

    const migrated = migrateV1SettingsIfNeeded();
    normalizeSettings();

    if (migrated) {
        saveSettingsDebounced();
    }
}

function ensureScopedSettings(scope) {
    const settings = getSettings();

    if (scope === "global") {
        settings.global = settings.global || defaultScopeState();
        settings.global = sanitizeScopeState(settings.global);
        return settings.global;
    }

    if (scope === "char") {
        const key = getCurrentCharKey();
        if (!key) return null;
        settings.chars[key] = sanitizeScopeState(settings.chars[key]);
        return settings.chars[key];
    }

    const key = getCurrentChatKey();
    if (!key) return null;
    settings.chats[key] = sanitizeScopeState(settings.chats[key]);
    return settings.chats[key];
}

function getScopedSettings(scope) {
    const settings = getSettings();

    if (scope === "global") {
        return sanitizeScopeState(settings.global);
    }

    if (scope === "char") {
        const key = getCurrentCharKey();
        if (!key) return null;
        return sanitizeScopeState(settings.chars[key]);
    }

    const key = getCurrentChatKey();
    if (!key) return null;
    return sanitizeScopeState(settings.chats[key]);
}

function getScopedPlaceholder(scope, placeholderKey) {
    const scoped = getScopedSettings(scope);
    if (!scoped) return null;
    return sanitizePlaceholderValue(scoped[placeholderKey]);
}

function isValidEnabledContent(value) {
    return Boolean(value?.enabled && typeof value?.content === "string" && value.content.trim() !== "");
}

function resolveEffectiveSettingsWithSource(placeholderKey) {
    const chatValue = getScopedPlaceholder("chat", placeholderKey);
    if (isValidEnabledContent(chatValue)) {
        return { value: chatValue, source: "chat" };
    }

    const charValue = getScopedPlaceholder("char", placeholderKey);
    if (isValidEnabledContent(charValue)) {
        return { value: charValue, source: "char" };
    }

    const globalValue = getScopedPlaceholder("global", placeholderKey);
    if (isValidEnabledContent(globalValue)) {
        return { value: globalValue, source: "global" };
    }

    return { value: defaultPlaceholderState(), source: null };
}

function resolveEffectiveSettings(placeholderKey) {
    return resolveEffectiveSettingsWithSource(placeholderKey).value;
}

// 플레이스홀더를 시스템에 적용
function applyPlaceholderToSystem(placeholder) {
    const resolvedSettings = resolveEffectiveSettings(placeholder.key);

    if (!resolvedSettings.enabled) {
        // 비활성화된 경우
        if (placeholder.isCustom) {
            // 커스텀 플레이스홀더는 시스템에서 제거
            removePlaceholderFromSystem(placeholder.key);
        } else {
            // 사전등록된 플레이스홀더는 덮어쓴 값을 제거하여 원래 시스템 값으로 복원
            restoreSystemPlaceholder(placeholder.key);
        }
        return;
    }

    // 활성화된 경우
    if (placeholder.isCustom) {
        // 커스텀 플레이스홀더는 직접 생성
        registerCustomPlaceholder(placeholder.key, resolvedSettings.content);
    } else {
        // 사전등록된 플레이스홀더는 값 대체
        // 내용이 비어있으면 기존 시스템 값을 유지 (마치 비활성화된 것처럼 동작)
        if (resolvedSettings.content && resolvedSettings.content.trim() !== "") {
            replaceSystemPlaceholder(placeholder.key, resolvedSettings.content);
        } else {
            restoreSystemPlaceholder(placeholder.key);
        }
    }
}

// 커스텀 플레이스홀더 등록
function registerCustomPlaceholder(key, content) {
    try {
        const context = getContext();
        if (context && context.registerMacro) {
            // 기존 매크로가 있으면 먼저 제거
            if (context.unregisterMacro) {
                context.unregisterMacro(key);
            }

            context.registerMacro(key, content || "", `Direction Manager: ${key}`);
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to register custom placeholder:`, error);
    }
}

// 시스템 플레이스홀더 값 대체
function replaceSystemPlaceholder(key, content) {
    try {
        const context = getContext();
        if (context && context.registerMacro) {
            // 기존 매크로가 있으면 먼저 제거 (깔끔한 덮어쓰기를 위해)
            if (context.unregisterMacro) {
                context.unregisterMacro(key);
            }

            // 새로운 값으로 매크로 등록
            context.registerMacro(key, content || "", `Direction Manager override: ${key}`);
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to replace system placeholder:`, error);
    }
}

// 시스템에서 플레이스홀더 제거
function removePlaceholderFromSystem(key) {
    try {
        const context = getContext();
        if (context && context.unregisterMacro) {
            context.unregisterMacro(key);
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to remove placeholder from system:`, error);
    }
}

// 시스템 플레이스홀더를 원래 값으로 복원
function restoreSystemPlaceholder(key) {
    try {
        const context = getContext();
        if (context && context.unregisterMacro) {
            // Direction Manager가 덮어쓴 매크로를 제거
            context.unregisterMacro(key);
        }
        // 시스템이 원래 매크로를 자동으로 복원함
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to restore system placeholder:`, error);
    }
}

// 모든 플레이스홀더 적용
function applyAllPlaceholders() {
    placeholders.forEach((placeholder) => {
        applyPlaceholderToSystem(placeholder);
    });
}

// 모든 플레이스홀더 제거
function removeAllPlaceholders() {
    placeholders.forEach((placeholder) => {
        if (placeholder.isCustom) {
            // 커스텀 플레이스홀더는 시스템에서 제거
            removePlaceholderFromSystem(placeholder.key);
        } else {
            // 사전등록된 플레이스홀더는 원래 시스템 값으로 복원
            restoreSystemPlaceholder(placeholder.key);
        }
    });
}

function getPopupCurrentPlaceholder() {
    return placeholders[currentPlaceholderIndex];
}

function getScopeButtonTitle(scope) {
    const availability = getScopeAvailability(scope);
    if (availability.available) {
        return "";
    }
    return availability.reason;
}

function getCurrentScopeState(placeholderKey) {
    const scoped = getScopedSettings(currentScope);
    if (!scoped) {
        return defaultPlaceholderState();
    }
    return sanitizePlaceholderValue(scoped[placeholderKey]);
}

function setCurrentScopeState(placeholderKey, value) {
    const scoped = ensureScopedSettings(currentScope);
    if (!scoped) {
        return false;
    }

    scoped[placeholderKey] = sanitizePlaceholderValue(value);
    return true;
}

function ensureUsableCurrentScope() {
    const availability = getScopeAvailability(currentScope);
    if (availability.available) {
        return;
    }

    const defaultScope = getSettings().defaultScope;
    const fallbackOrder = [defaultScope, "chat", "char", "global"];
    for (const scope of fallbackOrder) {
        const available = getScopeAvailability(scope);
        if (available.available) {
            currentScope = scope;
            return;
        }
    }

    currentScope = "global";
}

function refreshScopeButtons() {
    if (!compactUIPopup) return;

    ["global", "char", "chat"].forEach((scope) => {
        const btn = compactUIPopup.find(`.dm-compact--scope-btn[data-scope="${scope}"]`);
        const availability = getScopeAvailability(scope);
        btn.prop("disabled", !availability.available);
        btn.attr("title", getScopeButtonTitle(scope));
        btn.toggleClass("dm-compact--scope-btn--active", scope === currentScope);
    });

    const copyButton = compactUIPopup.find(".dm-compact--copy-up");
    copyButton.prop("disabled", currentScope === "global");
}

function getPresetList(placeholderKey) {
    const settings = getSettings();
    settings.presets = sanitizePresets(settings.presets);
    return settings.presets[placeholderKey] || [];
}

function renderPresetSelect() {
    if (!compactUIPopup) return;

    const placeholder = getPopupCurrentPlaceholder();
    const select = compactUIPopup.find(".dm-compact--preset-select");
    const presets = getPresetList(placeholder.key);

    select.empty();
    select.append('<option value="">선택...</option>');
    presets.forEach((preset) => {
        select.append(`<option value="${preset.id}">${preset.name}</option>`);
    });

    compactUIPopup.find(".dm-compact--preset-rename").prop("disabled", true);
    compactUIPopup.find(".dm-compact--preset-delete").prop("disabled", true);
}

function updateAppliedIndicator() {
    if (!compactUIPopup) return;

    const placeholder = getPopupCurrentPlaceholder();
    const resolved = resolveEffectiveSettingsWithSource(placeholder.key);

    let text = "⚪ 모든 스코프 비활성";
    if (resolved.source === "chat") {
        text = "💡 적용 중: 채팅 스코프";
    } else if (resolved.source === "char") {
        text = "💡 적용 중: 캐릭터 스코프";
    } else if (resolved.source === "global") {
        text = "💡 적용 중: 전역(폴백)";
    }

    compactUIPopup.find(".dm-compact--indicator").text(text);
}

function syncPopupByCurrentState() {
    if (!compactUIPopup) return;

    ensureUsableCurrentScope();

    const currentPlaceholder = getPopupCurrentPlaceholder();
    const settings = getCurrentScopeState(currentPlaceholder.key);

    compactUIPopup.find(".dm-compact--title").text(currentPlaceholder.name);
    compactUIPopup.find(".dm-compact--radio").prop("checked", settings.enabled);
    compactUIPopup
        .find(".dm-compact--textarea")
        .val(settings.content || "")
        .prop("disabled", !settings.enabled);

    refreshScopeButtons();
    renderPresetSelect();
    updateAppliedIndicator();
}

function getUpperScopeSource(scope, placeholderKey) {
    if (scope === "global") {
        return null;
    }

    if (scope === "char") {
        const globalValue = getScopedPlaceholder("global", placeholderKey);
        return isValidEnabledContent(globalValue) ? globalValue : null;
    }

    const charValue = getScopedPlaceholder("char", placeholderKey);
    if (isValidEnabledContent(charValue)) {
        return charValue;
    }

    const globalValue = getScopedPlaceholder("global", placeholderKey);
    return isValidEnabledContent(globalValue) ? globalValue : null;
}

function generatePresetId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random()}`;
}

// 컴팩트 UI 팝업 닫기
function closeCompactUIPopup() {
    if (compactUIPopup) {
        compactUIPopup.removeClass("dm-compact--active");
        setTimeout(() => {
            if (compactUIPopup) {
                compactUIPopup.remove();
                compactUIPopup = null;
            }
        }, 200);
    }

    if (compactUIButton) {
        compactUIButton.removeClass("dm-compact--hasPopup");
    }

    $(document).off("click.compactUI");
}

// 컴팩트 UI 팝업 표시
function showCompactUIPopup() {
    if (compactUIPopup) {
        return closeCompactUIPopup();
    }

    const settings = getSettings();
    currentScope = settings.defaultScope;
    ensureUsableCurrentScope();

    compactUIButton.addClass("dm-compact--hasPopup");

    const popupHtml = `
        <div class="dm-compact--popup">
            <div class="dm-compact--header">
                <button class="dm-compact--nav dm-compact--prev" title="이전 플레이스홀더">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="dm-compact--title-row">
                    <input type="checkbox" class="dm-compact--radio">
                    <div class="dm-compact--title"></div>
                </div>
                <button class="dm-compact--nav dm-compact--clear" title="내용 지우기">
                    <i class="fa-solid fa-eraser"></i>
                </button>
                <button class="dm-compact--nav dm-compact--next" title="다음 플레이스홀더">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
            <div class="dm-compact--scope-row">
                <span>스코프:</span>
                <button class="dm-compact--scope-btn" data-scope="global" type="button">전역</button>
                <button class="dm-compact--scope-btn" data-scope="char" type="button">캐릭터</button>
                <button class="dm-compact--scope-btn" data-scope="chat" type="button">채팅</button>
                <button class="dm-compact--copy-up" type="button" title="상위 스코프 값 복사">
                    <i class="fa-solid fa-arrow-down"></i>
                </button>
            </div>
            <div class="dm-compact--preset-row">
                <span>프리셋:</span>
                <select class="dm-compact--preset-select" aria-label="프리셋 선택"></select>
                <button class="dm-compact--preset-btn dm-compact--preset-save" type="button" title="현재 내용 프리셋 저장">
                    <i class="fa-solid fa-floppy-disk"></i>
                </button>
                <button class="dm-compact--preset-btn dm-compact--preset-rename" type="button" title="선택한 프리셋 이름 변경">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="dm-compact--preset-btn dm-compact--preset-delete" type="button" title="선택한 프리셋 삭제">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="dm-compact--content">
                <textarea class="dm-compact--textarea" placeholder="플레이스홀더 내용을 입력하세요..."></textarea>
            </div>
            <div class="dm-compact--indicator"></div>
        </div>
    `;

    compactUIPopup = $(popupHtml);
    $("#nonQRFormItems").append(compactUIPopup);

    // 애니메이션
    setTimeout(() => {
        if (compactUIPopup) {
            compactUIPopup.addClass("dm-compact--active");
        }
    }, 10);

    // 이벤트 핸들러 설정
    setupCompactUIEventListeners();
    syncPopupByCurrentState();
}

// 컴팩트 UI 이벤트 리스너 설정
function setupCompactUIEventListeners() {
    if (!compactUIPopup) return;

    // 이전 플레이스홀더 버튼
    compactUIPopup.find(".dm-compact--prev").on("click", () => {
        navigateCompactPlaceholder(-1);
    });

    // 다음 플레이스홀더 버튼
    compactUIPopup.find(".dm-compact--next").on("click", () => {
        navigateCompactPlaceholder(1);
    });

    compactUIPopup.find(".dm-compact--scope-btn").on("click", function () {
        const nextScope = $(this).data("scope");
        const availability = getScopeAvailability(nextScope);
        if (!availability.available) {
            return;
        }

        currentScope = nextScope;
        syncPopupByCurrentState();
    });

    compactUIPopup.find(".dm-compact--copy-up").on("click", () => {
        const placeholder = getPopupCurrentPlaceholder();
        const sourceValue = getUpperScopeSource(currentScope, placeholder.key);

        if (!sourceValue) {
            alert("복사할 상위 스코프 값이 없습니다.");
            return;
        }

        if (!setCurrentScopeState(placeholder.key, sourceValue)) {
            console.warn(`${LOG_PREFIX} 현재 스코프에 값을 저장하지 못했습니다.`);
            return;
        }

        applyPlaceholderToSystem(placeholder);
        saveSettingsDebounced();
        syncPopupByCurrentState();
    });

    // 라디오 버튼 변경 이벤트
    compactUIPopup.find(".dm-compact--radio").on("change", function () {
        const isEnabled = $(this).is(":checked");
        const currentPlaceholder = getPopupCurrentPlaceholder();
        const scopedValue = getCurrentScopeState(currentPlaceholder.key);

        scopedValue.enabled = isEnabled;

        if (!setCurrentScopeState(currentPlaceholder.key, scopedValue)) {
            console.warn(`${LOG_PREFIX} 현재 스코프에 값을 저장하지 못했습니다.`);
            return;
        }

        // 텍스트에어리어 활성화/비활성화
        const textarea = compactUIPopup.find(".dm-compact--textarea");
        textarea.prop("disabled", !isEnabled);

        applyPlaceholderToSystem(currentPlaceholder);
        saveSettingsDebounced();
        updateAppliedIndicator();
    });

    // 지우개 버튼
    compactUIPopup.find(".dm-compact--clear").on("click", function () {
        const confirmed = confirm("이 플레이스홀더의 내용을 모두 지우시겠습니까?");
        if (confirmed) {
            const currentPlaceholder = getPopupCurrentPlaceholder();
            const scopedValue = getCurrentScopeState(currentPlaceholder.key);
            scopedValue.content = "";

            if (!setCurrentScopeState(currentPlaceholder.key, scopedValue)) {
                console.warn(`${LOG_PREFIX} 현재 스코프에 값을 저장하지 못했습니다.`);
                return;
            }

            compactUIPopup.find(".dm-compact--textarea").val("");
            applyPlaceholderToSystem(currentPlaceholder);
            saveSettingsDebounced();
            updateAppliedIndicator();
        }
    });

    // 텍스트에어리어 변경 이벤트
    compactUIPopup.find(".dm-compact--textarea").on("input", function () {
        const newContent = String($(this).val());
        const currentPlaceholder = getPopupCurrentPlaceholder();
        const scopedValue = getCurrentScopeState(currentPlaceholder.key);

        scopedValue.content = newContent;

        if (!setCurrentScopeState(currentPlaceholder.key, scopedValue)) {
            console.warn(`${LOG_PREFIX} 현재 스코프에 값을 저장하지 못했습니다.`);
            return;
        }

        applyPlaceholderToSystem(currentPlaceholder);
        saveSettingsDebounced();
        updateAppliedIndicator();
    });

    compactUIPopup.find(".dm-compact--preset-select").on("change", function () {
        const presetId = String($(this).val() || "");
        const placeholder = getPopupCurrentPlaceholder();
        const presets = getPresetList(placeholder.key);
        const selectedPreset = presets.find((preset) => preset.id === presetId);

        const hasSelection = Boolean(selectedPreset);
        compactUIPopup.find(".dm-compact--preset-rename").prop("disabled", !hasSelection);
        compactUIPopup.find(".dm-compact--preset-delete").prop("disabled", !hasSelection);

        if (!selectedPreset) {
            return;
        }

        compactUIPopup.find(".dm-compact--textarea").val(selectedPreset.content).trigger("input");
    });

    compactUIPopup.find(".dm-compact--preset-save").on("click", () => {
        const placeholder = getPopupCurrentPlaceholder();
        const textareaValue = String(compactUIPopup.find(".dm-compact--textarea").val() || "");
        const name = prompt("프리셋 이름을 입력하세요:", "새 프리셋");

        if (!name || !name.trim()) {
            return;
        }

        const settings = getSettings();
        settings.presets[placeholder.key].push({
            id: generatePresetId(),
            name: name.trim(),
            content: textareaValue,
        });

        saveSettingsDebounced();
        renderPresetSelect();
    });

    compactUIPopup.find(".dm-compact--preset-rename").on("click", () => {
        const placeholder = getPopupCurrentPlaceholder();
        const select = compactUIPopup.find(".dm-compact--preset-select");
        const presetId = String(select.val() || "");
        if (!presetId) {
            return;
        }

        const presets = getPresetList(placeholder.key);
        const target = presets.find((preset) => preset.id === presetId);
        if (!target) {
            return;
        }

        const newName = prompt("새 프리셋 이름을 입력하세요:", target.name);
        if (!newName || !newName.trim()) {
            return;
        }

        target.name = newName.trim();
        saveSettingsDebounced();
        renderPresetSelect();
        compactUIPopup.find(`.dm-compact--preset-select option[value="${presetId}"]`).prop("selected", true);
        compactUIPopup.find(".dm-compact--preset-rename").prop("disabled", false);
        compactUIPopup.find(".dm-compact--preset-delete").prop("disabled", false);
    });

    compactUIPopup.find(".dm-compact--preset-delete").on("click", () => {
        const placeholder = getPopupCurrentPlaceholder();
        const select = compactUIPopup.find(".dm-compact--preset-select");
        const presetId = String(select.val() || "");
        if (!presetId) {
            return;
        }

        const confirmed = confirm("선택한 프리셋을 삭제하시겠습니까?");
        if (!confirmed) {
            return;
        }

        const settings = getSettings();
        settings.presets[placeholder.key] = settings.presets[placeholder.key].filter((preset) => preset.id !== presetId);
        saveSettingsDebounced();
        renderPresetSelect();
    });

    // 외부 클릭시 닫기
    $(document).on("click.compactUI", (e) => {
        if (!$(e.target).closest(".dm-compact--popup, .dm-compact--button").length) {
            closeCompactUIPopup();
        }
    });
}

// 컴팩트 UI 플레이스홀더 네비게이션
function navigateCompactPlaceholder(direction) {
    currentPlaceholderIndex += direction;

    if (currentPlaceholderIndex < 0) {
        currentPlaceholderIndex = placeholders.length - 1;
    } else if (currentPlaceholderIndex >= placeholders.length) {
        currentPlaceholderIndex = 0;
    }

    syncPopupByCurrentState();
}

function refreshPopupIfOpened() {
    if (!compactUIPopup) {
        return;
    }

    syncPopupByCurrentState();
}

// 컴팩트 UI 버튼 추가
function addCompactUIButton() {
    const ta = document.querySelector("#send_textarea");
    if (!ta) {
        setTimeout(addCompactUIButton, 1000);
        return;
    }

    // 기존 버튼 제거
    if (compactUIButton) {
        compactUIButton.remove();
        compactUIButton = null;
    }

    const buttonHtml = `
        <div class="dm-compact--button menu_button" title="Direction Manager 빠른 편집">
            <i class="fa-solid fa-feather"></i>
        </div>
    `;

    compactUIButton = $(buttonHtml);
    $(ta).after(compactUIButton);

    // 확장 활성화 상태에 따라 버튼 표시/숨김
    const settings = getSettings();
    if (settings && settings.extensionEnabled) {
        compactUIButton.show();
    } else {
        compactUIButton.hide();
    }

    // 클릭 이벤트
    compactUIButton.on("click", showCompactUIPopup);
}

// 확장 메뉴 초기화
async function initializeExtensionMenu() {
    try {
        // HTML 로드 및 삽입
        const html = await $.get(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        $("#extensions_settings").append(html);

        // UI 업데이트
        updateExtensionMenuUI();

        // 이벤트 핸들러 설정
        setupExtensionMenuEventHandlers();

        console.log(`${LOG_PREFIX} 확장 메뉴 초기화 완료`);
    } catch (error) {
        console.error(`${LOG_PREFIX} 확장 메뉴 초기화 실패:`, error);
    }
}

// 확장 메뉴 UI 업데이트
function updateExtensionMenuUI() {
    const settings = getSettings();

    // 활성화 체크박스 상태 설정
    $("#direction_manager_enabled").prop("checked", settings.extensionEnabled);

    // 프롬프트 텍스트 설정
    $("#direction_prompt_text").val(settings.directionPrompt || DEFAULT_DIRECTION_PROMPT);

    // Depth 설정
    $("#direction_prompt_depth").val(settings.promptDepth || 1);

    // 기본 스코프 설정
    $("#direction_default_scope").val(settings.defaultScope || "chat");
}

function clearCurrentCharScopeData() {
    const key = getCurrentCharKey();
    if (!key) {
        alert("현재 캐릭터를 찾을 수 없습니다.");
        return;
    }

    const confirmed = confirm("현재 캐릭터 전용 저장 내용을 삭제하시겠습니까?");
    if (!confirmed) {
        return;
    }

    const settings = getSettings();
    delete settings.chars[key];
    applyAllPlaceholders();
    saveSettingsDebounced();
    refreshPopupIfOpened();
}

function clearCurrentChatScopeData() {
    const key = getCurrentChatKey();
    if (!key) {
        alert("현재 채팅을 찾을 수 없습니다.");
        return;
    }

    const confirmed = confirm("현재 채팅 전용 저장 내용을 삭제하시겠습니까?");
    if (!confirmed) {
        return;
    }

    const settings = getSettings();
    delete settings.chats[key];
    applyAllPlaceholders();
    saveSettingsDebounced();
    refreshPopupIfOpened();
}

// 확장 메뉴 이벤트 핸들러 설정
function setupExtensionMenuEventHandlers() {
    // 활성화 체크박스 변경 이벤트 (전체 확장 기능 제어)
    $("#direction_manager_enabled").on("change", function () {
        const isEnabled = $(this).is(":checked");
        getSettings().extensionEnabled = isEnabled;

        if (isEnabled) {
            // 확장 활성화 시: 컴팩트 UI 버튼 표시 및 모든 플레이스홀더 적용
            if (compactUIButton) {
                compactUIButton.show();
            }
            applyAllPlaceholders();
        } else {
            // 확장 비활성화 시: 컴팩트 UI 버튼 숨김 및 모든 매크로 제거
            if (compactUIButton) {
                compactUIButton.hide();
                // 팝업이 열려있으면 닫기
                if (compactUIPopup) {
                    closeCompactUIPopup();
                }
            }
            removeAllPlaceholders();
        }

        saveSettingsDebounced();
    });

    // 프롬프트 텍스트 변경 이벤트 (실시간 저장)
    $("#direction_prompt_text").on("input", function () {
        getSettings().directionPrompt = $(this).val();
        saveSettingsDebounced();
    });

    // Depth 설정 변경 이벤트
    $("#direction_prompt_depth").on("input", function () {
        const value = parseInt(String($(this).val()), 10);
        getSettings().promptDepth = Number.isNaN(value) ? 1 : value;
        saveSettingsDebounced();
    });

    // 기본 스코프 설정 변경 이벤트
    $("#direction_default_scope").on("change", function () {
        const value = String($(this).val());
        if (["global", "char", "chat"].includes(value)) {
            getSettings().defaultScope = value;
            saveSettingsDebounced();
        }
    });

    // 기본값 초기화 버튼
    $("#direction_reset_prompt").on("click", function () {
        $("#direction_prompt_text").val(DEFAULT_DIRECTION_PROMPT);
        $("#direction_prompt_depth").val(1);
        $("#direction_default_scope").val("chat");
        getSettings().directionPrompt = DEFAULT_DIRECTION_PROMPT;
        getSettings().promptDepth = 1;
        getSettings().defaultScope = "chat";
        saveSettingsDebounced();
    });

    $("#direction_clear_char").on("click", clearCurrentCharScopeData);
    $("#direction_clear_chat").on("click", clearCurrentChatScopeData);
}

function handleContextChanged() {
    applyAllPlaceholders();
    refreshPopupIfOpened();
}

// 프롬프트 주입 함수
function injectDirectionPrompt(eventData) {
    const settings = getSettings();

    // 확장이 비활성화되어 있으면 주입하지 않음
    if (!settings.extensionEnabled) {
        return;
    }

    const directionSettings = resolveEffectiveSettings("direction");

    // Direction 토글이 비활성화되어 있으면 주입하지 않음
    if (!directionSettings.enabled) {
        return;
    }

    // 프롬프트가 비어있으면 주입하지 않음
    if (!settings.directionPrompt || settings.directionPrompt.trim() === "") {
        return;
    }

    // 플레이스홀더 치환
    let processedPrompt = settings.directionPrompt;

    // {{direction}} 플레이스홀더 치환
    if (directionSettings.content) {
        processedPrompt = processedPrompt.replace(/\{\{direction\}\}/g, directionSettings.content);
    } else {
        processedPrompt = processedPrompt.replace(/\{\{direction\}\}/g, "");
    }

    const charSettings = resolveEffectiveSettings("char");
    const userSettings = resolveEffectiveSettings("user");

    // {{char}} 플레이스홀더 치환
    if (charSettings.enabled && charSettings.content) {
        processedPrompt = processedPrompt.replace(/\{\{char\}\}/g, charSettings.content);
    }

    // {{user}} 플레이스홀더 치환
    if (userSettings.enabled && userSettings.content) {
        processedPrompt = processedPrompt.replace(/\{\{user\}\}/g, userSettings.content);
    }

    const depth = settings.promptDepth || 1;

    // 참고 파일 방식: eventData.chat 또는 eventData.messages 확인
    let messages = eventData.chat || eventData.messages;

    if (messages && Array.isArray(messages)) {
        // system 메시지 생성
        const systemMessage = {
            role: "system",
            content: processedPrompt,
        };

        // 참고 파일의 방식을 따라 depth 적용
        if (depth === 0) {
            // 맨 끝에 추가
            messages.push(systemMessage);
        } else {
            // 끝에서부터 N번째 위치에 삽입
            const insertIndex = Math.max(messages.length - depth, 0);
            messages.splice(insertIndex, 0, systemMessage);
        }
    }
}

// 확장 초기화
jQuery(async () => {
    await loadSettings();
    applyAllPlaceholders();

    // 확장 메뉴 초기화
    await initializeExtensionMenu();

    // 컴팩트 UI 버튼 추가
    addCompactUIButton();

    // 프롬프트 주입 이벤트 리스너 등록
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, injectDirectionPrompt);
    eventSource.on(event_types.CHAT_CHANGED, handleContextChanged);

    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, handleContextChanged);
    }
});
