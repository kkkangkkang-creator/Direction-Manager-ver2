# Direction-Manager v2

실리태번(SillyTavern)용 Direction-Manager 확장의 v2 포크입니다.

## 주요 기능
- 전역(Global) / 캐릭터(Character) / 채팅(Chat) 스코프 분리 저장
- 스코프 우선순위 적용: **Chat > Character > Global**
- 플레이스홀더별(`direction`, `char`, `user`) 프리셋 라이브러리
- 컴팩트 팝업에서 스코프 전환, 상위 스코프 복사, 프리셋 저장/이름변경/삭제 지원
- 기존 v1 설정 자동 마이그레이션(`_migratedV2: true`)

## 설치 방법
1. 이 저장소 파일을 실리태번 경로의 아래 폴더에 복사합니다.
   - `public/scripts/extensions/third-party/Direction-Manager/`
2. 실리태번을 새로고침합니다.
3. 확장 설정의 **Direction Manager** 패널에서 활성화/프롬프트/Depth/기본 스코프를 설정합니다.

## v1 → v2 차이점
- v1: `extension_settings["Direction-Manager"]` 최상위에 단일 값 저장
- v2: `global/chars/chats/presets` 구조로 분리 저장
- v2는 캐릭터 카드(`characters[].data.extensions`, `writeExtensionField`)에 저장하지 않고,
  **오직 `extension_settings` 내부에만 저장**합니다.

## 스코프 우선순위
각 플레이스홀더는 아래 순서로 적용됩니다.
1. Chat 스코프 값(활성 + 비어있지 않음)
2. Character 스코프 값(활성 + 비어있지 않음)
3. Global 스코프 값(활성 + 비어있지 않음)
4. 모두 없으면 비활성으로 처리

## 프리셋 사용법
- 프리셋 드롭다운: 현재 플레이스홀더용 목록 표시
- 💾: 현재 textarea 내용을 이름과 함께 저장
- ✏️: 선택 프리셋 이름 변경
- ❌: 선택 프리셋 삭제
- 프리셋은 스코프와 무관하게 전역 공용 라이브러리로 관리됩니다.

## 수동 테스트 체크리스트
1. 캐릭터 A에서 채팅 스코프로 "A용 지시" 입력 후 캐릭터 B로 전환 시 값 분리 확인
2. 캐릭터 스코프로 저장 후 같은 캐릭터의 다른 채팅에서도 유지 확인
3. 프리셋 저장/로드/삭제/이름변경 동작 확인
4. 콘솔에서 `extension_settings["Direction-Manager"]` 구조 확인
5. v1 데이터가 `global` 하위로 1회 마이그레이션되는지 확인
