import { fromBase64, textOf, toBase64, type FileStore } from "./files";
import {
    APPS_VERSION,
    INTERNAL_ERROR,
    isRecord,
    METHOD_NOT_FOUND,
    modernMeta,
    type DisplayMode,
    type Incoming,
    type Json,
    type Outgoing,
    type Platform,
    type RpcError,
    type Surface,
    type Theme,
} from "./protocol";
import { acceptUiResource, type UiFrame } from "./resource";
import { isAppOnly, resourceUriOf, type Tool } from "./tools";

export type { Outgoing } from "./protocol";

/**
 * 가짜 호스트의 몸통. 화면 하나하나를 세션으로 쥐고, 화면이 보낸 말에 답하고, 서버에 넘길 것은 넘긴다.
 *
 * 브라우저를 모른다. 화면에 말을 보내는 일(`send`)과 서버를 부르는 일(`server`)은 밖에서 받는다.
 * 그래서 창(shell)과 테스트가 같은 규칙을 쓴다. 규칙마다 근거는 `rules.ts` 에 있다.
 */
export interface HostEvents
{
    /** 화면이 `ui/message` 로 대화에 글을 보냈다 */
    readonly message?: (session: Session, params: Json) => void;
    /** 화면이 표시 방식을 바꿔 달라고 했다. 받아 준 방식을 돌려준다 */
    readonly displayMode?: (session: Session, wanted: DisplayMode) => DisplayMode;
    readonly openLink?: (session: Session, url: string) => void;
    readonly filesOpen?: (session: Session, path: string) => void;
    readonly contextChanged?: (session: Session) => void;
    readonly sizeChanged?: (session: Session, size: { readonly width?: number; readonly height?: number }) => void;
    /** 오간 말. 개발 도구와 e2e 가 읽는다 */
    readonly log?: (entry: LogEntry) => void;
}

export interface LogEntry
{
    readonly direction: "화면→호스트" | "호스트→화면" | "호스트→서버" | "서버→호스트";
    readonly session: string | null;
    readonly method: string;
    readonly payload: unknown;
}

export interface HostOptions
{
    readonly server: (method: string, params?: Json) => Promise<Json>;
    readonly tools: ReadonlyArray<Tool>;
    readonly files: FileStore;
    readonly platform: Platform;
    readonly theme: Theme;
    readonly send: (session: string, message: Outgoing) => void;
    readonly events?: HostEvents;
    /** 서버와 새 판(2026-07-28)으로 말하는가. 끄면 `_meta` 를 싣지 않는 옛 클라이언트처럼 군다 */
    readonly modern?: boolean;
    readonly locale?: string;
}

export interface Session
{
    readonly id: string;
    readonly tool: Tool;
    readonly input: Json;
    readonly result: Json;
    readonly surface: Surface;
    readonly frame: UiFrame;
    mode: DisplayMode;
    initialized: boolean;
    context: Json | null;
    readonly subscriptions: Set<string>;
    /** 파일 진입점으로 열었으면 그 파일의 주소 */
    readonly fileUri: string | null;
}

export interface MountRequest
{
    readonly tool: string;
    readonly input: Json;
    readonly surface: Surface;
    /** 모델이 이미 부른 도구의 결과. 있으면 도구를 다시 부르지 않는다 */
    readonly result?: Json;
    readonly mode?: DisplayMode;
}

export class HostRefusal extends Error
{
    constructor(readonly rule: string, message: string)
    {
        super(message);
    }
}

/** 화면이 부를 수 있으려면 호스트가 알려야 하는 능력 */
const NEEDS: Readonly<Record<string, string>> = {
    "openai/files/open": "openai/files",
    "openai/resources/write": "openai/resource",
};

export const hostCapabilities = (platform: Platform): Json => ({
    openLinks: {},
    serverTools: {},
    serverResources: {},
    logging: {},
    message: { text: {} },
    updateModelContext: { text: {}, structuredContent: {} },
    experimental: {
        "openai/message": {},
        "openai/modelContext": {},
        // 파일을 읽고 쓰고 여는 능력은 데스크톱 앱에만 있다(`desktop-only`)
        ...(platform === "desktop" ? { "openai/files": {}, "openai/resource": {} } : {}),
    },
});

const announced = (platform: Platform, capability: string): boolean =>
    isRecord(hostCapabilities(platform)["experimental"]) && (hostCapabilities(platform)["experimental"] as Json)[capability] !== undefined;

const fail = (code: number, message: string): RpcError => ({ code, message });

class RpcFailure extends Error
{
    constructor(readonly error: RpcError)
    {
        super(error.message);
    }
}

export interface Host
{
    readonly mount: (request: MountRequest) => Promise<Session>;
    readonly receive: (session: string, message: Incoming) => Promise<void>;
    readonly unmount: (session: string) => Promise<void>;
    readonly session: (session: string) => Session | undefined;
    readonly sessions: () => ReadonlyArray<Session>;
    readonly modelTools: () => ReadonlyArray<Tool>;
    readonly tools: () => ReadonlyArray<Tool>;
    /** 모델이 도구를 부른다. 새 판의 `_meta` 를 싣는다 */
    readonly callTool: (name: string, args?: Json, more?: Json) => Promise<Json>;
    readonly readResource: (uri: string) => Promise<Json>;
    readonly detachContext: (session: string) => void;
    readonly notify: (session: string, method: string, params?: Json) => void;
    readonly setTheme: (theme: Theme) => void;
    readonly setPlatform: (platform: Platform) => void;
    readonly setMode: (session: string, mode: DisplayMode) => void;
    readonly deepLink: (session: string, url: string) => void;
    readonly platform: () => Platform;
    readonly theme: () => Theme;
}

export const createHost = (options: HostOptions): Host =>
{
    const modern = options.modern ?? true;
    const sessions = new Map<string, Session>();
    const waiting = new Map<number | string, (message: Incoming) => void>();
    let platform = options.platform;
    let theme = options.theme;
    let sequence = 0;
    let requestSequence = 0;

    const log = (entry: LogEntry): void => options.events?.log?.(entry);

    const toSession = (session: string, message: Outgoing): void =>
    {
        log({ direction: "호스트→화면", session, method: "method" in message ? message.method : "(답)", payload: message });
        options.send(session, message);
    };

    const withMeta = (params: Json = {}): Json =>
    {
        if (!modern)
        {
            return params;
        }

        const extra = isRecord(params["_meta"]) ? params["_meta"] : {};

        return { ...params, _meta: { ...modernMeta(), ...extra } };
    };

    const server = async (method: string, params: Json = {}, session: string | null = null): Promise<Json> =>
    {
        const sent = withMeta(params);

        log({ direction: "호스트→서버", session, method, payload: sent });

        const answer = await options.server(method, sent);

        log({ direction: "서버→호스트", session, method, payload: answer });

        return answer;
    };

    const hostContext = (session: Session): Json => ({
        theme,
        displayMode: session.mode,
        availableDisplayModes: ["inline", "fullscreen"],
        platform,
        locale: options.locale ?? "ko-KR",
        ...(session.context === null ? {} : { "openai/modelContext": session.context }),
    });

    const notify = (session: string, method: string, params: Json = {}): void =>
        toSession(session, { jsonrpc: "2.0", method, params });

    options.files.onChange((uri) =>
    {
        for (const session of sessions.values())
        {
            if (session.subscriptions.has(uri))
            {
                notify(session.id, "notifications/resources/updated", { uri });
            }
        }
    });

    const toolNamed = (name: string): Tool =>
    {
        const tool = options.tools.find((each) => each.name === name);

        if (tool === undefined)
        {
            throw new HostRefusal("entry-calls-tool", `서버가 내놓지 않은 도구다: ${name}`);
        }

        return tool;
    };

    const fileOf = (uri: string) => options.files.get(uri);

    /** 화면이 청한 것에 답한다. 여기가 가짜 호스트의 몸통이다 */
    const answer = async (session: Session, method: string, params: Json): Promise<Json> =>
    {
        const needed = NEEDS[method];

        if (needed !== undefined && !announced(platform, needed))
        {
            throw new RpcFailure(fail(METHOD_NOT_FOUND, `호스트가 알리지 않은 능력이다: ${method}`));
        }

        switch (method)
        {
            case "ui/initialize":
                return { protocolVersion: APPS_VERSION, hostInfo: { name: "host-playground", version: "0.1.0" }, hostCapabilities: hostCapabilities(platform), hostContext: hostContext(session) };

            case "tools/call":
            {
                const file = session.fileUri === null ? undefined : fileOf(session.fileUri);
                // 파일 진입점에서 나간 호출에는 호스트가 그 파일의 자리를 얹는다(`file-path-meta`). 화면에는 자리를 주지 않는다
                const extra = file !== undefined && platform === "desktop" ? { _meta: { ...(isRecord(params["_meta"]) ? params["_meta"] : {}), "openai/resource": { path: file.path } } } : {};

                return await server("tools/call", { ...params, ...extra }, session.id);
            }

            case "resources/read":
            {
                const uri = String(params["uri"] ?? "");
                const file = fileOf(uri);

                if (file === undefined)
                {
                    return await server("resources/read", { uri }, session.id);
                }

                if (!announced(platform, "openai/resource"))
                {
                    throw new RpcFailure(fail(METHOD_NOT_FOUND, "이 플랫폼의 호스트는 사람의 파일을 내주지 않는다"));
                }

                const wanted = isRecord(params["_meta"]) && isRecord(params["_meta"]["openai/resource"]) ? params["_meta"]["openai/resource"]["representation"] : undefined;
                const meta = { "openai/resource": { etag: file.etag, writable: file.writable } };
                const body = wanted === "blob" ? { blob: toBase64(file.bytes) } : { text: textOf(file.bytes) };

                return { contents: [{ uri, mimeType: file.mimeType, ...body, _meta: meta }] };
            }

            case "resources/subscribe":
                session.subscriptions.add(String(params["uri"] ?? ""));

                return {};

            case "resources/unsubscribe":
                session.subscriptions.delete(String(params["uri"] ?? ""));

                return {};

            case "openai/resources/write":
            {
                const uri = String(params["uri"] ?? "");
                const bytes = typeof params["blob"] === "string" ? fromBase64(params["blob"]) : new TextEncoder().encode(String(params["text"] ?? ""));
                const ifMatch = typeof params["ifMatch"] === "string" ? params["ifMatch"] : undefined;

                try
                {
                    return { ...options.files.write(uri, bytes, ifMatch) };
                }
                catch (error)
                {
                    throw new RpcFailure(fail(INTERNAL_ERROR, error instanceof Error ? error.message : String(error)));
                }
            }

            case "ui/update-model-context":
            {
                const content = Array.isArray(params["content"]) ? params["content"] : [];
                const empty = content.length === 0 && params["structuredContent"] === undefined;

                sequence += 1;
                session.context = empty ? null : { updateId: `update-${sequence}`, ...params };
                options.events?.contextChanged?.(session);

                return empty ? {} : { _meta: { "openai/modelContext": { updateId: `update-${sequence}` } } };
            }

            case "ui/message":
                options.events?.message?.(session, params);

                return {};

            case "ui/request-display-mode":
            {
                const wanted = params["mode"] === "fullscreen" || params["mode"] === "pip" ? params["mode"] : "inline";
                const mode = options.events?.displayMode?.(session, wanted) ?? wanted;

                session.mode = mode;

                return { mode };
            }

            case "ui/open-link":
                options.events?.openLink?.(session, String(params["url"] ?? ""));

                return {};

            case "openai/files/open":
                options.events?.filesOpen?.(session, String(params["path"] ?? ""));

                return {};

            case "ping":
                return {};

            default:
                throw new RpcFailure(fail(METHOD_NOT_FOUND, `호스트가 모르는 메서드다: ${method}`));
        }
    };

    const onNotification = (session: Session, method: string, params: Json): void =>
    {
        if (method === "ui/notifications/initialized" && !session.initialized)
        {
            // 악수가 끝난 뒤에야 도구의 인자와 결과를 넘긴다(`handshake-order`)
            session.initialized = true;
            notify(session.id, "ui/notifications/tool-input", { arguments: session.input });
            notify(session.id, "ui/notifications/tool-result", session.result);
        }
        else if (method === "ui/notifications/size-changed")
        {
            options.events?.sizeChanged?.(session, { width: Number(params["width"] ?? NaN), height: Number(params["height"] ?? NaN) });
        }
    };

    return {
        mount: async (request) =>
        {
            const tool = toolNamed(request.tool);
            const uri = resourceUriOf(tool);

            if (uri === undefined)
            {
                throw new HostRefusal("entry-calls-tool", `${tool.name} 에는 화면이 없다`);
            }

            const result = request.result ?? await server("tools/call", { name: tool.name, arguments: request.input });
            const verdict = acceptUiResource(uri, await server("resources/read", { uri }), modern);

            if (!verdict.ok)
            {
                log({ direction: "서버→호스트", session: null, method: "거절", payload: { rule: verdict.rule, reason: verdict.reason } });

                throw new HostRefusal(verdict.rule, verdict.reason);
            }

            const file = isRecord(request.input["file"]) && typeof request.input["file"]["resourceUri"] === "string" ? request.input["file"]["resourceUri"] : null;

            sequence += 1;

            const session: Session = {
                id: `s${sequence}`,
                tool,
                input: request.input,
                result,
                surface: request.surface,
                frame: verdict.frame,
                mode: request.mode ?? (request.surface === "inline" ? verdict.frame.preferredDisplayMode ?? "inline" : "fullscreen"),
                initialized: false,
                context: null,
                subscriptions: new Set(),
                fileUri: file,
            };

            sessions.set(session.id, session);

            return session;
        },
        receive: async (id, message) =>
        {
            const session = sessions.get(id);

            if (session === undefined || message.jsonrpc !== "2.0")
            {
                return;
            }

            log({ direction: "화면→호스트", session: id, method: message.method ?? "(답)", payload: message });

            if (message.method === undefined)
            {
                if (message.id !== undefined)
                {
                    waiting.get(message.id)?.(message);
                    waiting.delete(message.id);
                }

                return;
            }

            if (message.id === undefined)
            {
                onNotification(session, message.method, message.params ?? {});

                return;
            }

            try
            {
                toSession(id, { jsonrpc: "2.0", id: message.id, result: await answer(session, message.method, message.params ?? {}) });
            }
            catch (error)
            {
                toSession(id, {
                    jsonrpc: "2.0",
                    id: message.id,
                    error: error instanceof RpcFailure ? error.error : fail(INTERNAL_ERROR, error instanceof Error ? error.message : String(error)),
                });
            }
        },
        unmount: async (id) =>
        {
            if (!sessions.has(id))
            {
                return;
            }

            requestSequence += 1;

            const requestId = `teardown-${requestSequence}`;
            const answered = new Promise<void>((resolve) =>
            {
                waiting.set(requestId, () => resolve());
                // 화면이 답하지 않아도 닫는다. 실물이 얼마나 기다리는지는 모른다
                setTimeout(resolve, 3_000);
            });

            toSession(id, { jsonrpc: "2.0", id: requestId, method: "ui/resource-teardown", params: {} });
            await answered;
            waiting.delete(requestId);
            sessions.delete(id);
        },
        session: (id) => sessions.get(id),
        sessions: () => [...sessions.values()],
        modelTools: () => options.tools.filter((tool) => !isAppOnly(tool)),
        tools: () => options.tools,
        callTool: async (name, args = {}, more = {}) => await server("tools/call", { name, arguments: args, ...more }),
        readResource: async (uri) => await server("resources/read", { uri }),
        detachContext: (id) =>
        {
            const session = sessions.get(id);

            if (session === undefined)
            {
                return;
            }

            session.context = null;
            notify(id, "ui/notifications/host-context-changed", { "openai/modelContext": null });
        },
        notify,
        setTheme: (next) =>
        {
            theme = next;
            sessions.forEach((session) => notify(session.id, "ui/notifications/host-context-changed", { theme }));
        },
        setPlatform: (next) =>
        {
            platform = next;
        },
        setMode: (id, mode) =>
        {
            const session = sessions.get(id);

            if (session !== undefined)
            {
                session.mode = mode;
                notify(id, "ui/notifications/host-context-changed", { displayMode: mode });
            }
        },
        deepLink: (id, url) => notify(id, "ui/notifications/host-context-changed", { "openai/deepLink": { url } }),
        platform: () => platform,
        theme: () => theme,
    };
};
