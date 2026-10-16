/**
 * 호스트가 지키는 규칙의 표. 「ChatGPT 와 똑같다」를 말로 두지 않고 줄마다 근거를 단다.
 *
 * 근거는 셋 중 하나다.
 * - `스펙`: 스펙 문서의 조항이 그렇게 적었다
 * - `녹취`: 실물 ChatGPT 에서 오간 말을 기록해 대조했다
 * - `추측`: 스펙이 말하지 않아 우리가 정했다. 개발 도구가 따로 표시한다
 *
 * 녹취가 쌓여 `추측` 줄이 줄어드는 것이 이 저장소의 진척이다. 줄의 `id` 는 테스트와 개발 도구가 가리킨다.
 */
export type Basis = "스펙" | "녹취" | "추측";

export interface Rule
{
    readonly id: string;
    readonly summary: string;
    readonly basis: Basis;
    readonly source: string;
}

const APPS = "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification";
const EXTENSIONS = "https://github.com/openai/mcp-extensions/blob/main/docs/spec.md";

export const RULES: ReadonlyArray<Rule> = [
    { id: "handshake-order", summary: "화면이 initialized 를 알린 뒤에야 tool-input 과 tool-result 를 보낸다", basis: "스펙", source: APPS },
    { id: "entry-calls-tool", summary: "진입점으로 연 화면에는 호스트가 도구를 먼저 부르고 그 결과를 넘긴다", basis: "스펙", source: EXTENSIONS },
    { id: "modern-meta", summary: "서버에 보내는 모든 요청에 새 판의 판과 능력을 싣는다", basis: "녹취", source: "OPIc 이 ChatGPT 데스크톱에서 확인(2026-10-16)" },
    { id: "resource-cache-fields", summary: "새 판의 resources/read 답에 ttlMs 와 cacheScope 가 없으면 화면을 버린다", basis: "녹취", source: "OPIc 이 ChatGPT 데스크톱에서 확인(2026-10-16). 실물은 말없이 버린다" },
    { id: "resource-mime", summary: "화면 자원의 mimeType 은 text/html;profile=mcp-app 이어야 한다", basis: "스펙", source: APPS },
    { id: "csp-from-resource", summary: "화면의 CSP 는 자원의 _meta.ui.csp 로 짓고 적지 않은 곳은 막는다", basis: "스펙", source: APPS },
    { id: "csp-wasm", summary: "CSP 의 script-src 에 wasm-unsafe-eval 을 연다", basis: "추측", source: "스펙에 적힌 것이 없다. 한글 엔진(WASM)이 돌려면 필요하다" },
    { id: "frame-origin", summary: "화면은 호스트와 다른 origin 에서 뜬다", basis: "스펙", source: APPS },
    { id: "frame-sandbox", summary: "iframe 의 sandbox 는 scripts · same-origin · forms · popups 를 연다", basis: "추측", source: "실물의 속성을 아직 녹취하지 못했다" },
    { id: "file-input", summary: "파일 진입점의 tool-input 에는 이름과 주소만 싣고 경로는 싣지 않는다", basis: "스펙", source: EXTENSIONS },
    { id: "file-path-meta", summary: "파일 진입점에서 나간 도구 호출에 호스트가 _meta.openai/resource.path 를 얹는다", basis: "추측", source: "scaffold 미리 보기가 이렇게 읽었다" },
    { id: "file-representation", summary: "resources/read 는 representation 이 blob 이면 base64, 아니면 글로 답한다", basis: "스펙", source: EXTENSIONS },
    { id: "file-conflict", summary: "ifMatch 가 지금의 etag 와 다르면 덮어쓰지 않고 conflict 로 답한다", basis: "스펙", source: EXTENSIONS },
    { id: "file-subscribe", summary: "구독한 파일이 밖에서 바뀌면 notifications/resources/updated 를 보낸다", basis: "스펙", source: EXTENSIONS },
    { id: "app-only-tools", summary: "visibility 가 app 인 도구는 모델에게 보이지 않는다", basis: "스펙", source: APPS },
    { id: "desktop-only", summary: "파일 · 멘션 · 로컬 파일 열기는 데스크톱에서만 알린다", basis: "스펙", source: "https://developers.openai.com/plugins/build/extensions" },
    { id: "unknown-method", summary: "알리지 않은 능력과 모르는 메서드는 -32601 로 답한다", basis: "추측", source: "JSON-RPC 의 기본을 따랐다" },
    { id: "context-empty", summary: "빈 모델 컨텍스트는 첨부를 뗀다. 사람이 떼면 화면에 null 로 알린다", basis: "추측", source: "scaffold 미리 보기가 이렇게 읽었다" },
    { id: "teardown", summary: "화면을 닫기 전에 ui/resource-teardown 을 청하고 답을 기다린다", basis: "스펙", source: APPS },
];

export const ruleOf = (id: string): Rule | undefined => RULES.find((rule) => rule.id === id);

export const guessCount = (): number => RULES.filter((rule) => rule.basis === "추측").length;
