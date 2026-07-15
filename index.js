// Direction-Manager 확장 - direction 플레이스홀더 관리 (컴팩트 UI 전용)
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
    };
}

const defaultSettings = {
    global: defaultScopeState(),
    chars: {},
    chats: {},
    presets: {
        direction: [],
    },
    // 확장 메뉴 설정
    extensionEnabled: true,
    directionPrompt: DEFAULT_DIRECTION_PROMPT,
    promptDepth: 1, // 0: Chat History 끝에 삽입, >0: 끝에서부터 N번째 위치에 삽입
    defaultScope: "chat",
