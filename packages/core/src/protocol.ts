/**
 * 호스트와 화면과 서버가 주고받는 말의 모양. 두 스펙이 겹쳐 있다.
 *
 * - MCP Apps(`ui/*`): 화면이 iframe 안에서 호스트와 postMessage 로 나누는 JSON-RPC
 * - openai/mcp-extensions(`openai/*`): ChatGPT 가 그 위에 얹은 파일 · 메시지 · 컨텍스트 · 폼
 *
 * 서버와는 MCP 의 새 판(2026-07-28)으로 말한다. 새 판은 악수가 없고 요청마다 판과 능력을 `_meta` 에 싣는다.
 */
export const MODERN_VERSION = "2026-07-28";

/** `ui/initialize` 의 답에 적는 MCP Apps 의 판 */
export const APPS_VERSION = "2026-01-26";

export const UI_MIME = "text/html;profile=mcp-app";

export type Platform = "desktop" | "web" | "mobile";

export type Theme = "light" | "dark";

export type DisplayMode = "inline" | "fullscreen" | "pip";

/** 화면이 뜨는 자리. ChatGPT 의 자리 이름을 따랐다 */
export type Surface = "global" | "thread" | "file" | "inline";

export type Json = Record<string, unknown>;

export interface RpcError
{
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
}

export interface Incoming
{
    readonly jsonrpc: "2.0";
    readonly id?: number | string;
    readonly method?: string;
    readonly params?: Json;
    readonly result?: Json;
    readonly error?: RpcError;
}

export type Outgoing =
    | { readonly jsonrpc: "2.0"; readonly id: number | string; readonly result: Json }
    | { readonly jsonrpc: "2.0"; readonly id: number | string; readonly error: RpcError }
    | { readonly jsonrpc: "2.0"; readonly id?: number | string; readonly method: string; readonly params?: Json };

export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;

export const isRecord = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** 새 판의 요청이 싣는 `_meta`. 폼을 띄울 수 있는 호스트라고 함께 알린다 */
export const modernMeta = (): Json => ({
    "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
    "io.modelcontextprotocol/clientCapabilities": { extensions: { "openai/elicitation": { form: {} } } },
});
