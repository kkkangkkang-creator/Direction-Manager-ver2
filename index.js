// Direction-Manager í™•ìž¥ - direction í”Œë ˆì´ìŠ¤í™€ë” ê´€ë¦¬ (ì»´íŒ©íŠ¸ UI ì „ìš©)
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, characters, this_chid } from "../../../../script.js";

// í™•ìž¥ ì„¤ì •
const extensionName = "Direction-Manager";
const LOG_PREFIX = "[Direction-Manager v2]";

// ê¸°ë³¸ Direction í”„ë¡¬í”„íŠ¸
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
    };
}

const defaultSettings = {
    global: defaultScopeState(),
    chars: {},
    chats: {},
    presets: {
        direction: [],
    },
    // í™•ìž¥ ë©”ë‰´ ì„¤ì •
    extensionEnabled: true,
    directionPrompt: DEFAULT_DIRECTION_PROMPT,
    promptDepth: 1, // 0: Chat History ëì— ì‚½ìž…, >0: ëì—ì„œë¶€í„° Në²ˆì§¸ ìœ„ì¹˜ì— ì‚½ìž…
    defaultScope: "chat",
    _migratedV2: false,
};

let currentScope = "chat";

// í”Œë ˆì´ìŠ¤í™€ë” ì •ì˜
const placeholders = [
    { key: "direction", name: "{{direction}}", isCustom: true },
];

// ì»´íŒ©íŠ¸ UI ê´€ë ¨ ë³€ìˆ˜ë“¤
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
    };
}

function sanitizePresets(presets) {
    const src = presets || {};

    const sanitizePresetList = (arr) => Array.isArray(arr)
        ? arr
            .filter(item => item && typeof item.content === "string")
            .map(item => ({
                id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random()}`,
                name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "ì´ë¦„ ì—†ëŠ” í”„ë¦¬ì…‹",
                content: item.content,
            }))
        : [];

    return {
        direction: sanitizePresetList(src.direction),
    };
}

function pruneRemovedPlaceholders() {
    const settings = getSettings();
    let changed = false;

    const pruneScope = (scopeState) => {
        if (!scopeState || typeof scopeState !== "object") return;

        if ("char" in scopeState) {
            delete scopeState.char;
            changed = true;
        }

        if ("user" in scopeState) {
            delete scopeState.user;
            changed = true;
        }
    };

    pruneScope(settings.global);

    Object.values(settings.chars || {}).forEach(pruneScope);
    Object.values(settings.chats || {}).forEach(pruneScope);

    if (settings.presets && typeof settings.presets === "object") {
        if ("char" in settings.presets) {
            delete settings.presets.char;
            changed = true;
        }

        if ("user" in settings.presets) {
            delete settings.presets.user;
            changed = true;
        }
    }

    if ("char" in settings) {
        delete settings.char;
        changed = true;
    }

    if ("user" in settings) {
        delete settings.user;
        changed = true;
    }

    return changed;
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
            return { available: false, reason: "ê·¸ë£¹ ì±„íŒ…ì—ì„œëŠ” ìºë¦­í„° ìŠ¤ì½”í”„ë¥¼ ì‚¬ìš©í•  ìˆ˜ ì—†ìŠµë‹ˆë‹¤" };
        }

        if (!getCurrentCharKey()) {
            return { available: false, reason: "í˜„ìž¬ ìºë¦­í„°ë¥¼ ì°¾ì„ ìˆ˜ ì—†ìŠµë‹ˆë‹¤" };
        }

        return { available: true, reason: "" };
    }

    if (!getCurrentChatKey()) {
        return { available: false, reason: "í˜„ìž¬ ì±„íŒ…ì„ ì°¾ì„ ìˆ˜ ì—†ìŠµë‹ˆë‹¤" };
    }

    return { available: true, reason: "" };
}

function normalizeSettings() {
    const settings = getSettings();

    settings.global = sanitizeScopeState(settings.global);
    settings.chars = settings.chars && typeof settings.chars === "object" ? settings.chars : {};
    settings.chats = settings.chats && typeof settings.chats === "object" ? settings.chats : {};
    settings.presets = sanitizePresets(settings.presets);
    settings.extensionEnabled = typeof settings.extensionEnabled === "boolean" ? settings.extensionEnabled : defaultSettings.extensionEnabled;
    settings.directionPrompt = typeof settings.directionPrompt === "string" ? settings.directionPrompt : defaultSettings.directionPrompt;
    settings.promptDepth = Number.isInteger(settings.promptDepth) ? settings.promptDepth : defaultSettings.promptDepth;
    settings.defaultScope = ["global", "char", "chat"].includes(settings.defaultScope) ? settings.defaultScope : defaultSettings.defaultScope;
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

    if (settings.direction !== undefined) {
        settings.global.direction = sanitizePlaceholderValue(settings.direction);
        delete settings.direction;
    }

    // v1ì— ìžˆë˜ {{char}} / {{user}} ì €ìž¥ê°’ì€ ë” ì´ìƒ ì‚¬ìš©í•˜ì§€ ì•Šìœ¼ë¯€ë¡œ ì‚­ì œ
    if (settings.char !== undefined) {
        delete settings.char;
    }

    if (settings.user !== undefined) {
        delete settings.user;
    }

    settings._migratedV2 = true;
    console.log(`${LOG_PREFIX} v1 ì„¤ì •ì„ v2 global ìŠ¤ì½”í”„ë¡œ ë§ˆì´ê·¸ë ˆì´ì…˜í–ˆìŠµë‹ˆë‹¤. {{char}}/{{user}} ê°’ì€ ì œê±°í–ˆìŠµë‹ˆë‹¤.`);
    return true;
}

// ì„¤ì • ë¡œë“œ
async function loadSettings() {
    const settings = getSettings();

    if (Object.keys(settings).length === 0) {
        Object.assign(settings, cloneSettings(defaultSettings));
    }

    const migrated = migrateV1SettingsIfNeeded();
    const pruned = pruneRemovedPlaceholders();
    normalizeSettings();

    if (migrated || pruned) {
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

// í”Œë ˆì´ìŠ¤í™€ë”ë¥¼ ì‹œìŠ¤í…œì— ì ìš©
function applyPlaceholderToSystem(placeholder) {
    const resolvedSettings = resolveEffectiveSettings(placeholder.key);

    if (!resolvedSettings.enabled) {
        removePlaceholderFromSystem(placeholder.key);
        return;
    }

    registerCustomPlaceholder(placeholder.key, resolvedSettings.content);
}

// ì»¤ìŠ¤í…€ í”Œë ˆì´ìŠ¤í™€ë” ë“±ë¡
function registerCustomPlaceholder(key, content) {
    try {
        const context = getContext();

        if (context && context.registerMacro) {
            // ê¸°ì¡´ ë§¤í¬ë¡œê°€ ìžˆìœ¼ë©´ ë¨¼ì € ì œê±°
            if (context.unregisterMacro) {
                context.unregisterMacro(key);
            }

            context.registerMacro(key, content || "", `Direction Manager: ${key}`);
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to register custom placeholder:`, error);
    }
}

// ì‹œìŠ¤í…œì—ì„œ í”Œë ˆì´ìŠ¤í™€ë” ì œê±°
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

// ëª¨ë“  í”Œë ˆì´ìŠ¤í™€ë” ì ìš©
function applyAllPlaceholders() {
    placeholders.forEach((placeholder) => {
        applyPlaceholderToSystem(placeholder);
    });
}

// ëª¨ë“  í”Œë ˆì´ìŠ¤í™€ë” ì œê±°
function removeAllPlaceholders() {
    placeholders.forEach((placeholder) => {
        removePlaceholderFromSystem(placeholder.key);
    });
}

function getPopupCurrentPlaceholder() {
    return placeholders[0];
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
    select.append('<option value="">ì„ íƒ...</option>');

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
    let text = "âšª ëª¨ë“  ìŠ¤ì½”í”„ ë¹„í™œì„±";

    if (resolved.source === "chat") {
        text = "ðŸŸ¢ ì ìš© ì¤‘: ì±„íŒ… ìŠ¤ì½”í”„";
    } else if (resolved.source === "char") {
        text = "ðŸŸ¢ ì ìš© ì¤‘: ìºë¦­í„° ìŠ¤ì½”í”„";
    } else if (resolved.source === "global") {
        text = "ðŸŸ¢ ì ìš© ì¤‘: ì „ì—­(í´ë°±)";
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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ì»´íŒ©íŠ¸ UI íŒì—… ë‹«ê¸°
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

// ì»´íŒ©íŠ¸ UI íŒì—… í‘œì‹œ
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
                <div class="dm-compact--title-row">
                    <input type="checkbox" class="dm-compact--radio">
                    <div class="dm-compact--title"></div>
                </div>
                <button class="dm-compact--nav dm-compact--clear" title="ë‚´ìš© ì§€ìš°ê¸°" type="button">
                    <i class="fa-solid fa-eraser"></i>
                </button>
            </div>

            <div class="dm-compact--scope-row">
                <span>ìŠ¤ì½”í”„:</span>
                <button class="dm-compact--scope-btn" data-scope="global" type="button">ì „ì—­</button>
                <button class="dm-compact--scope-btn" data-scope="char" type="button">ìºë¦­í„°</button>
                <button class="dm-compact--scope-btn" data-scope="chat" type="button">ì±„íŒ…</button>
                <button class="dm-compact--copy-up" type="button" title="ìƒìœ„ ìŠ¤ì½”í”„ ê°’ ë³µì‚¬">
                    <i class="fa-solid fa-arrow-down"></i>
                </button>
            </div>

            <div class="dm-compact--preset-row">
                <span>í”„ë¦¬ì…‹:</span>
                <select class="dm-compact--preset-select" aria-label="í”„ë¦¬ì…‹ ì„ íƒ"></select>
                <button class="dm-compact--preset-btn dm-compact--preset-save" type="button" title="í˜„ìž¬ ë‚´ìš© í”„ë¦¬ì…‹ ì €ìž¥">
                    <i class="fa-solid fa-floppy-disk"></i>
                </button>
                <button class="dm-compact--preset-btn dm-compact--preset-rename" type="button" title="ì„ íƒí•œ í”„ë¦¬ì…‹ ì´ë¦„ ë³€ê²½">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="dm-compact--preset-btn dm-compact--preset-delete" type="button" title="ì„ íƒí•œ í”„ë¦¬ì…‹ ì‚­ì œ">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="dm-compact--content">
                <textarea class="dm-compact--textarea" placeholder="Direction ë‚´ìš©ì„ ìž…ë ¥í•˜ì„¸ìš”..."></textarea>
            </div>
            <div class="dm-compact--indicator"></div>
        </div>
    `;

    compactUIPopup = $(popupHtml);
    $("#nonQRFormItems").append(compactUIPopup);

    // ì• ë‹ˆë©”ì´ì…˜
    setTimeout(() => {
        if (compactUIPopup) {
            compactUIPopup.addClass("dm-compact--active");
        }
    }, 10);

    // ì´ë²¤íŠ¸ í•¸ë“¤ëŸ¬ ì„¤ì •
    setupCompactUIEventListeners();
    syncPopupByCurrentState();
}

// ì»´íŒ©íŠ¸ UI ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ ì„¤ì •
function setupCompactUIEventListeners() {
    if (!compactUIPopup) return;

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
            alert("ë³µì‚¬í•  ìƒìœ„ ìŠ¤ì½”í”„ ê°’ì´ ì—†ìŠµë‹ˆë‹¤.");
            return;
        }

        if (!setCurrentScopeState(placeholder.key, sourceValue)) {
            console.warn(`${LOG_PREFIX} í˜„ìž¬ ìŠ¤ì½”í”„ì— ê°’ì„ ì €ìž¥í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.`);
            return;
        }

        applyPlaceholderToSystem(placeholder);
        saveSettingsDebounced();
        syncPopupByCurrentState();
    });

    // ë¼ë””ì˜¤ ë²„íŠ¼ ë³€ê²½ ì´ë²¤íŠ¸
    compactUIPopup.find(".dm-compact--radio").on("change", function () {
        const isEnabled = $(this).is(":checked");
        const currentPlaceholder = getPopupCurrentPlaceholder();
        const scopedValue = getCurrentScopeState(currentPlaceholder.key);
        scopedValue.enabled = isEnabled;

        if (!setCurrentScopeState(currentPlaceholder.key, scopedValue)) {
            console.warn(`${LOG_PREFIX} í˜„ìž¬ ìŠ¤ì½”í”„ì— ê°’ì„ ì €ìž¥í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.`);
            return;
        }

        // í…ìŠ¤íŠ¸ì—ì–´ë¦¬ì–´ í™œì„±í™”/ë¹„í™œì„±í™”
        const textarea = compactUIPopup.find(".dm-compact--textarea");
        textarea.prop("disabled", !isEnabled);

        applyPlaceholderToSystem(currentPlaceholder);
        saveSettingsDebounced();
        updateAppliedIndicator();
    });

    // ì§€ìš°ê°œ ë²„íŠ¼
    compactUIPopup.find(".dm-compact--clear").on("click", function () {
        const confirmed = confirm("Direction ë‚´ìš©ì„ ëª¨ë‘ ì§€ìš°ì‹œê² ìŠµë‹ˆê¹Œ?");

        if (confirmed) {
            const currentPlaceholder = getPopupCurrentPlaceholder();
            const scopedValue = getCurrentScopeState(currentPlaceholder.key);
            scopedValue.content = "";

            if (!setCurrentScopeState(currentPlaceholder.key, scopedValue)) {
                console.warn(`${LOG_PREFIX} í˜„ìž¬ ìŠ¤ì½”í”„ì— ê°’ì„ ì €ìž¥í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.`);
                return;
            }

            compactUIPopup.find(".dm-compact--textarea").val("");
            applyPlaceholderToSystem(currentPlaceholder);
            saveSettingsDebounced();
            updateAppliedIndicator();
        }
    });

    // í…ìŠ¤íŠ¸ì—ì–´ë¦¬ì–´ ë³€ê²½ ì´ë²¤íŠ¸
    compactUIPopup.find(".dm-compact--textarea").on("input", function () {
        const newContent = String($(this).val());
        const currentPlaceholder = getPopupCurrentPlaceholder();
        const scopedValue = getCurrentScopeState(currentPlaceholder.key);
        scopedValue.content = newContent;

        if (!setCurrentScopeState(currentPlaceholder.key, scopedValue)) {
            console.warn(`${LOG_PREFIX} í˜„ìž¬ ìŠ¤ì½”í”„ì— ê°’ì„ ì €ìž¥í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.`);
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
        const name = prompt("í”„ë¦¬ì…‹ ì´ë¦„ì„ ìž…ë ¥í•˜ì„¸ìš”:", "ìƒˆ í”„ë¦¬ì…‹");

        if (!name || !name.trim()) {
            return;
        }

        const settings = getSettings();
        settings.presets = sanitizePresets(settings.presets);
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

        const newName = prompt("ìƒˆ í”„ë¦¬ì…‹ ì´ë¦„ì„ ìž…ë ¥í•˜ì„¸ìš”:", target.name);

        if (!newName || !newName.trim()) {
            return;
        }

        target.name = newName.trim();

        const settings = getSettings();
        settings.presets[placeholder.key] = presets;
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

        const confirmed = confirm("ì„ íƒí•œ í”„ë¦¬ì…‹ì„ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?");

        if (!confirmed) {
            return;
        }

        const settings = getSettings();
        settings.presets = sanitizePresets(settings.presets);
        settings.presets[placeholder.key] = settings.presets[placeholder.key].filter((preset) => preset.id !== presetId);
        saveSettingsDebounced();
        renderPresetSelect();
    });

    // ì™¸ë¶€ í´ë¦­ì‹œ ë‹«ê¸°
    $(document).on("click.compactUI", (e) => {
        if (!$(e.target).closest(".dm-compact--popup, .dm-compact--button").length) {
            closeCompactUIPopup();
        }
    });
}

function refreshPopupIfOpened() {
    if (!compactUIPopup) {
        return;
    }

    syncPopupByCurrentState();
}

// ì»´íŒ©íŠ¸ UI ë²„íŠ¼ ì¶”ê°€
function addCompactUIButton() {
    const ta = document.querySelector("#send_textarea");

    if (!ta) {
        setTimeout(addCompactUIButton, 1000);
        return;
    }

    // ê¸°ì¡´ ë²„íŠ¼ ì œê±°
    if (compactUIButton) {
        compactUIButton.remove();
        compactUIButton = null;
    }

    const buttonHtml = `
        <div class="dm-compact--button menu_button" title="Direction Manager ë¹ ë¥¸ íŽ¸ì§‘">
            <i class="fa-solid fa-feather"></i>
        </div>
    `;

    compactUIButton = $(buttonHtml);
    $(ta).after(compactUIButton);

    // í™•ìž¥ í™œì„±í™” ìƒíƒœì— ë”°ë¼ ë²„íŠ¼ í‘œì‹œ/ìˆ¨ê¹€
    const settings = getSettings();

    if (settings && settings.extensionEnabled) {
        compactUIButton.show();
    } else {
        compactUIButton.hide();
    }

    // í´ë¦­ ì´ë²¤íŠ¸
    compactUIButton.on("click", showCompactUIPopup);
}

// í™•ìž¥ ë©”ë‰´ ì´ˆê¸°í™”
async function initializeExtensionMenu() {
    try {
        // HTML ë¡œë“œ ë° ì‚½ìž…
        const html = await $.get(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        $("#extensions_settings").append(html);

        // UI ì—…ë°ì´íŠ¸
        updateExtensionMenuUI();

        // ì´ë²¤íŠ¸ í•¸ë“¤ëŸ¬ ì„¤ì •
        setupExtensionMenuEventHandlers();

        console.log(`${LOG_PREFIX} í™•ìž¥ ë©”ë‰´ ì´ˆê¸°í™” ì™„ë£Œ`);
    } catch (error) {
        console.error(`${LOG_PREFIX} í™•ìž¥ ë©”ë‰´ ì´ˆê¸°í™” ì‹¤íŒ¨:`, error);
    }
}

// í™•ìž¥ ë©”ë‰´ UI ì—…ë°ì´íŠ¸
function updateExtensionMenuUI() {
    const settings = getSettings();

    // í™œì„±í™” ì²´í¬ë°•ìŠ¤ ìƒíƒœ ì„¤ì •
    $("#direction_manager_enabled").prop("checked", settings.extensionEnabled);

    // í”„ë¡¬í”„íŠ¸ í…ìŠ¤íŠ¸ ì„¤ì •
    $("#direction_prompt_text").val(settings.directionPrompt || DEFAULT_DIRECTION_PROMPT);

    // Depth ì„¤ì •
    $("#direction_prompt_depth").val(settings.promptDepth || 1);

    // ê¸°ë³¸ ìŠ¤ì½”í”„ ì„¤ì •
    $("#direction_default_scope").val(settings.defaultScope || "chat");
}

function clearCurrentCharScopeData() {
    const key = getCurrentCharKey();

    if (!key) {
        alert("í˜„ìž¬ ìºë¦­í„°ë¥¼ ì°¾ì„ ìˆ˜ ì—†ìŠµë‹ˆë‹¤.");
        return;
    }

    const confirmed = confirm("í˜„ìž¬ ìºë¦­í„° ì „ìš© ì €ìž¥ ë‚´ìš©ì„ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?");

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
        alert("í˜„ìž¬ ì±„íŒ…ì„ ì°¾ì„ ìˆ˜ ì—†ìŠµë‹ˆë‹¤.");
        return;
    }

    const confirmed = confirm("í˜„ìž¬ ì±„íŒ… ì „ìš© ì €ìž¥ ë‚´ìš©ì„ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?");

    if (!confirmed) {
        return;
    }

    const settings = getSettings();
    delete settings.chats[key];
    applyAllPlaceholders();
    saveSettingsDebounced();
    refreshPopupIfOpened();
}

// í™•ìž¥ ë©”ë‰´ ì´ë²¤íŠ¸ í•¸ë“¤ëŸ¬ ì„¤ì •
function setupExtensionMenuEventHandlers() {
    // í™œì„±í™” ì²´í¬ë°•ìŠ¤ ë³€ê²½ ì´ë²¤íŠ¸ (ì „ì²´ í™•ìž¥ ê¸°ëŠ¥ ì œì–´)
    $("#direction_manager_enabled").on("change", function () {
        const isEnabled = $(this).is(":checked");
        getSettings().extensionEnabled = isEnabled;

        if (isEnabled) {
            // í™•ìž¥ í™œì„±í™” ì‹œ: ì»´íŒ©íŠ¸ UI ë²„íŠ¼ í‘œì‹œ ë° ëª¨ë“  í”Œë ˆì´ìŠ¤í™€ë” ì ìš©
            if (compactUIButton) {
                compactUIButton.show();
            }

            applyAllPlaceholders();
        } else {
            // í™•ìž¥ ë¹„í™œì„±í™” ì‹œ: ì»´íŒ©íŠ¸ UI ë²„íŠ¼ ìˆ¨ê¹€ ë° ëª¨ë“  ë§¤í¬ë¡œ ì œê±°
            if (compactUIButton) {
                compactUIButton.hide();

                // íŒì—…ì´ ì—´ë ¤ìžˆìœ¼ë©´ ë‹«ê¸°
                if (compactUIPopup) {
                    closeCompactUIPopup();
                }
            }

            removeAllPlaceholders();
        }

        saveSettingsDebounced();
    });

    // í”„ë¡¬í”„íŠ¸ í…ìŠ¤íŠ¸ ë³€ê²½ ì´ë²¤íŠ¸ (ì‹¤ì‹œê°„ ì €ìž¥)
    $("#direction_prompt_text").on("input", function () {
        getSettings().directionPrompt = $(this).val();
        saveSettingsDebounced();
    });

    // Depth ì„¤ì • ë³€ê²½ ì´ë²¤íŠ¸
    $("#direction_prompt_depth").on("input", function () {
        const value = parseInt(String($(this).val()), 10);
        getSettings().promptDepth = Number.isNaN(value) ? 1 : value;
        saveSettingsDebounced();
    });

    // ê¸°ë³¸ ìŠ¤ì½”í”„ ì„¤ì • ë³€ê²½ ì´ë²¤íŠ¸
    $("#direction_default_scope").on("change", function () {
        const value = String($(this).val());

        if (["global", "char", "chat"].includes(value)) {
            getSettings().defaultScope = value;
            saveSettingsDebounced();
        }
    });

    // ê¸°ë³¸ê°’ ì´ˆê¸°í™” ë²„íŠ¼
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

// í”„ë¡¬í”„íŠ¸ ì£¼ìž… í•¨ìˆ˜
function injectDirectionPrompt(eventData) {
    const settings = getSettings();

    // í™•ìž¥ì´ ë¹„í™œì„±í™”ë˜ì–´ ìžˆìœ¼ë©´ ì£¼ìž…í•˜ì§€ ì•ŠìŒ
    if (!settings.extensionEnabled) {
        return;
    }

    const directionSettings = resolveEffectiveSettings("direction");

    // Direction í† ê¸€ì´ ë¹„í™œì„±í™”ë˜ì–´ ìžˆìœ¼ë©´ ì£¼ìž…í•˜ì§€ ì•ŠìŒ
    if (!directionSettings.enabled) {
        return;
    }

    // í”„ë¡¬í”„íŠ¸ê°€ ë¹„ì–´ìžˆìœ¼ë©´ ì£¼ìž…í•˜ì§€ ì•ŠìŒ
    if (!settings.directionPrompt || settings.directionPrompt.trim() === "") {
        return;
    }

    // í”Œë ˆì´ìŠ¤í™€ë” ì¹˜í™˜
    let processedPrompt = settings.directionPrompt;

    processedPrompt = processedPrompt
        .replace(/\{\{direction\}\}/g, directionSettings.content || "")
        // ì˜ˆì „ì— ì»¤ìŠ¤í…€ í”„ë¡¬í”„íŠ¸ì— ë‚¨ê¸´ í”ì ì´ ìžˆì–´ë„ í™•ìž¥ì—ì„œëŠ” ë” ì´ìƒ ì²˜ë¦¬í•˜ì§€ ì•ŠìŒ
        .replace(/\{\{char\}\}/g, "")
        .replace(/\{\{user\}\}/g, "");

    const depth = settings.promptDepth || 1;

    // ì°¸ê³  íŒŒì¼ ë°©ì‹: eventData.chat ë˜ëŠ” eventData.messages í™•ì¸
    const messages = eventData.chat || eventData.messages;

    if (messages && Array.isArray(messages)) {
        // system ë©”ì‹œì§€ ìƒì„±
        const systemMessage = {
            role: "system",
            content: processedPrompt,
        };

        // ì°¸ê³  íŒŒì¼ì˜ ë°©ì‹ì„ ë”°ë¼ depth ì ìš©
        if (depth === 0) {
            // ë§¨ ëì— ì¶”ê°€
            messages.push(systemMessage);
        } else {
            // ëì—ì„œë¶€í„° Në²ˆì§¸ ìœ„ì¹˜ì— ì‚½ìž…
            const insertIndex = Math.max(messages.length - depth, 0);
            messages.splice(insertIndex, 0, systemMessage);
        }
    }
}

// í™•ìž¥ ì´ˆê¸°í™”
jQuery(async () => {
    await loadSettings();
    applyAllPlaceholders();

    // í™•ìž¥ ë©”ë‰´ ì´ˆê¸°í™”
    await initializeExtensionMenu();

    // ì»´íŒ©íŠ¸ UI ë²„íŠ¼ ì¶”ê°€
    addCompactUIButton();

    // í”„ë¡¬í”„íŠ¸ ì£¼ìž… ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ ë“±ë¡
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, injectDirectionPrompt);
    eventSource.on(event_types.CHAT_CHANGED, handleContextChanged);

    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, handleContextChanged);
    }
});
