import { isRecord, UI_MIME, type DisplayMode, type Json } from "./protocol";

/**
 * 서버가 내준 화면 자원을 받을지 정한다. 받으면 iframe 에 넣을 HTML 과 CSP 를 짓는다.
 */
export interface UiCsp
{
    readonly connectDomains: ReadonlyArray<string>;
    readonly resourceDomains: ReadonlyArray<string>;
    readonly frameDomains: ReadonlyArray<string>;
}

export interface UiFrame
{
    readonly uri: string;
    readonly html: string;
    readonly csp: string;
    readonly preferredDisplayMode: DisplayMode | null;
}

export type UiVerdict = { readonly ok: true; readonly frame: UiFrame } | { readonly ok: false; readonly reason: string; readonly rule: string };

const strings = (value: unknown): ReadonlyArray<string> =>
    Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];

export const cspOf = (meta: unknown): UiCsp =>
{
    const csp = isRecord(meta) && isRecord(meta["ui"]) && isRecord(meta["ui"]["csp"]) ? meta["ui"]["csp"] : {};

    return { connectDomains: strings(csp["connectDomains"]), resourceDomains: strings(csp["resourceDomains"]), frameDomains: strings(csp["frameDomains"]) };
};

/**
 * 자원의 csp 로 CSP 머리를 짓는다. 적지 않은 곳은 막는다(`csp-from-resource`).
 * `wasm-unsafe-eval` 은 스펙에 없는 우리의 추측이다(`csp-wasm`).
 */
export const contentSecurityPolicy = (csp: UiCsp): string =>
{
    const list = (domains: ReadonlyArray<string>, fallback: string): string => (domains.length === 0 ? fallback : domains.join(" "));
    const resources = csp.resourceDomains.join(" ");
    const withResources = (base: string): string => (resources === "" ? base : `${base} ${resources}`);

    return [
        "default-src 'none'",
        withResources("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"),
        withResources("style-src 'self' 'unsafe-inline'"),
        withResources("img-src 'self' data: blob:"),
        withResources("font-src 'self' data:"),
        withResources("media-src 'self' data: blob:"),
        `connect-src ${list(csp.connectDomains, "'none'")}`,
        `frame-src ${list(csp.frameDomains, "'none'")}`,
        "worker-src 'self' blob:",
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");
};

const preferredMode = (meta: unknown): DisplayMode | null =>
{
    const ui = isRecord(meta) && isRecord(meta["openai/ui"]) ? meta["openai/ui"] : {};
    const mode = ui["preferredDisplayMode"];

    return mode === "inline" || mode === "fullscreen" || mode === "pip" ? mode : null;
};

/**
 * `resources/read` 의 답에서 화면을 꺼낸다.
 *
 * ⚠ 새 판의 답에 `ttlMs` 와 `cacheScope` 가 없으면 ChatGPT 데스크톱은 말없이 화면을 버린다(`resource-cache-fields`).
 *    이 호스트는 버리되 까닭을 남긴다.
 */
export const acceptUiResource = (uri: string, result: Json, modern: boolean): UiVerdict =>
{
    const contents = Array.isArray(result["contents"]) ? result["contents"].filter(isRecord) : [];
    const content = contents.find((each) => each["uri"] === uri) ?? contents[0];

    if (modern && (typeof result["ttlMs"] !== "number" || typeof result["cacheScope"] !== "string"))
    {
        return { ok: false, rule: "resource-cache-fields", reason: `${uri} 의 답에 ttlMs 와 cacheScope 가 없다. 실물 ChatGPT 는 이 화면을 말없이 띄우지 않는다` };
    }

    if (content === undefined || typeof content["text"] !== "string")
    {
        return { ok: false, rule: "resource-mime", reason: `${uri} 의 답에 HTML 이 없다` };
    }

    if (content["mimeType"] !== UI_MIME)
    {
        return { ok: false, rule: "resource-mime", reason: `${uri} 의 mimeType 이 ${String(content["mimeType"])} 이다. ${UI_MIME} 여야 화면으로 띄운다` };
    }

    return {
        ok: true,
        frame: { uri, html: content["text"], csp: contentSecurityPolicy(cspOf(content["_meta"])), preferredDisplayMode: preferredMode(content["_meta"]) },
    };
};
