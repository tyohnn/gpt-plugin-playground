import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { beginAuthorization, discover, finishAuthorization, type Discovered, type PendingAuthorization } from "./auth";
import { readPlugin } from "./plugin";

/**
 * 플레이그라운드의 서버. 두 origin 에 선다.
 *
 * | origin | 하는 일 |
 * |---|---|
 * | 창(`port`) | 창의 정적 파일, MCP 로 넘기는 `/rpc`, 로그인 사슬, 설정과 호스트 파일 |
 * | 화면(`port + 1`) | 화면 HTML 을 자원의 CSP 머리와 함께 낸다. 창과 origin 이 달라 화면이 창에 닿지 못한다(`frame-origin`) |
 *
 * 토큰은 이 프로세스의 메모리에만 있고 127.0.0.1 에만 선다. 창은 토큰을 모른다.
 */
export interface PlaygroundOptions
{
    /** 붙일 MCP 서버의 주소. 예: http://127.0.0.1:4200/api/mcp */
    readonly server: string;
    readonly port?: number;
    /** 정해 둔 토큰. 주면 로그인 사슬을 밟지 않는다 */
    readonly token?: string;
    /** 플러그인 묶음의 폴더(plugin.json 이 있는 곳) */
    readonly plugin?: string;
    /** 호스트가 쥘 사람의 파일 */
    readonly files?: ReadonlyArray<string>;
    readonly platform?: "desktop" | "web" | "mobile";
    /** 창의 빌드 폴더. 주지 않으면 이 패키지에 실린 것을 쓴다 */
    readonly shellDir?: string;
    /** 서버와 옛 판으로 말한다 */
    readonly legacy?: boolean;
    readonly quiet?: boolean;
}

export interface Playground
{
    readonly url: string;
    readonly frameOrigin: string;
    readonly close: () => Promise<void>;
}

const MIME: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".json": "application/json",
    ".hwp": "application/x-hwp",
    ".hwpx": "application/hwp+zip",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
};

const here = (): string => fileURLToPath(new URL(".", import.meta.url));

const defaultShell = (): string =>
{
    const bundled = join(here(), "shell");

    return existsSync(bundled) ? bundled : join(here(), "../../../apps/shell/dist");
};

const send = (response: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void =>
{
    response.writeHead(status, { "cache-control": "no-store", ...headers });
    response.end(body);
};

const json = (response: ServerResponse, status: number, body: unknown): void =>
    send(response, status, JSON.stringify(body), { "content-type": "application/json" });

const bodyOf = (request: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) =>
    {
        const chunks: Array<Buffer> = [];

        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });

/** Streamable HTTP 의 답은 JSON 이거나 SSE 다. SSE 면 마지막 `data:` 의 JSON 을 꺼낸다 */
const rpcBody = async (answered: Response): Promise<string> =>
{
    const text = await answered.text();

    if (!String(answered.headers.get("content-type") ?? "").includes("text/event-stream"))
    {
        return text;
    }

    const data = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());

    return data.at(-1) ?? "{}";
};

const listen = (server: Server, port: number): Promise<number> =>
    new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () =>
        {
            const address = server.address();

            resolve(typeof address === "object" && address !== null ? address.port : port);
        });
    });

export const createPlayground = async (options: PlaygroundOptions): Promise<Playground> =>
{
    const shellDir = options.shellDir ?? defaultShell();
    const frames = new Map<string, { readonly html: string; readonly csp: string }>();
    const plugin = readPlugin(options.plugin);
    const files = (options.files ?? []).map((path, index) => ({ index, path, name: basename(path), mimeType: MIME[extname(path).toLowerCase()] ?? "application/octet-stream", size: statSync(path).size }));
    let token: string | null = options.token ?? null;
    let found: Discovered | null = options.token === undefined ? null : { kind: "none" };
    let pending: PendingAuthorization | null = null;
    let self = "";
    let frameOrigin = "";

    const authorization = async (): Promise<Discovered> =>
    {
        found ??= await discover(options.server);

        return found;
    };

    const shell = createServer((request, response) =>
    {
        const url = new URL(request.url ?? "/", self);
        const route = `${request.method ?? "GET"} ${url.pathname}`;

        const handled = (async () =>
        {
            if (route === "GET /connect")
            {
                const auth = await authorization();

                if (auth.kind === "none")
                {
                    return send(response, 302, "", { location: "/" });
                }

                const begun = await beginAuthorization(auth, `${self}/callback`);

                pending = begun.pending;

                return send(response, 302, "", { location: begun.url });
            }

            if (route === "GET /callback")
            {
                const auth = await authorization();

                if (auth.kind === "none" || pending === null || url.searchParams.get("state") !== pending.state)
                {
                    return send(response, 400, "기다리던 인가가 아니다. /connect 로 다시 연결한다.", { "content-type": "text/plain; charset=utf-8" });
                }

                token = await finishAuthorization(auth, pending, url.searchParams.get("code") ?? "");
                pending = null;

                return send(response, 302, "", { location: "/" });
            }

            if (route === "GET /api/config")
            {
                const auth = await authorization();

                return json(response, 200, {
                    server: options.server,
                    platform: options.platform ?? "desktop",
                    modern: options.legacy !== true,
                    frameOrigin,
                    auth: auth.kind,
                    connected: auth.kind === "none" || token !== null,
                    plugin,
                    files: files.map(({ index, name, mimeType, size }) => ({ index, name, mimeType, size, path: `/Users/me/Documents/${name}` })),
                });
            }

            if (request.method === "GET" && url.pathname.startsWith("/api/files/"))
            {
                const file = files[Number(url.pathname.slice("/api/files/".length))];

                return file === undefined ? send(response, 404, "") : send(response, 200, readFileSync(file.path), { "content-type": file.mimeType });
            }

            if (request.method === "POST" && (route === "POST /rpc" || route === "POST /api/frames"))
            {
                // 이 창에서 온 청만 받는다. 브라우저의 다른 탭이 쥐고 있는 토큰으로 도구를 부르게 두지 않는다
                if (request.headers.origin !== self || !String(request.headers["content-type"] ?? "").startsWith("application/json"))
                {
                    return json(response, 403, {});
                }
            }

            if (route === "POST /api/frames")
            {
                const frame = JSON.parse(await bodyOf(request)) as { html: string; csp: string };
                const id = randomBytes(9).toString("base64url");

                frames.set(id, { html: String(frame.html), csp: String(frame.csp) });

                return json(response, 200, { url: `${frameOrigin}/frame/${id}` });
            }

            if (route === "POST /rpc")
            {
                const auth = await authorization();

                if (auth.kind === "oauth" && token === null)
                {
                    return json(response, 401, {});
                }

                const body = await bodyOf(request);
                const parsed = JSON.parse(body) as { params?: { _meta?: Record<string, unknown> } };
                const version = parsed.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
                const answered = await fetch(options.server, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        accept: "application/json, text/event-stream",
                        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
                        ...(typeof version === "string" ? { "mcp-protocol-version": version } : {}),
                    },
                    body,
                });

                if (answered.status === 401 && options.token === undefined)
                {
                    token = null;
                }

                return send(response, answered.status, await rpcBody(answered), { "content-type": "application/json" });
            }

            if (request.method !== "GET")
            {
                return send(response, 404, "");
            }

            if (url.pathname === "/" && found?.kind === "oauth" && token === null)
            {
                return send(response, 302, "", { location: "/connect" });
            }

            const path = normalize(join(shellDir, url.pathname === "/" ? "index.html" : url.pathname));

            if (!path.startsWith(shellDir) || !existsSync(path) || statSync(path).isDirectory())
            {
                return send(response, 200, readFileSync(join(shellDir, "index.html")), { "content-type": MIME[".html"] ?? "text/html" });
            }

            return send(response, 200, readFileSync(path), { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
        })();

        handled.catch((cause: unknown) => send(response, 502, `플레이그라운드가 서버에 닿지 못했다(${options.server}). ${String(cause)}`, { "content-type": "text/plain; charset=utf-8" }));
    });

    const sandbox = createServer((request, response) =>
    {
        const url = new URL(request.url ?? "/", frameOrigin);
        const frame = url.pathname.startsWith("/frame/") ? frames.get(url.pathname.slice("/frame/".length)) : undefined;

        if (frame === undefined)
        {
            return send(response, 404, "");
        }

        // 화면의 CSP 는 자원의 `_meta.ui.csp` 로 지은 것이다(`csp-from-resource`)
        return send(response, 200, frame.html, { "content-type": "text/html; charset=utf-8", "content-security-policy": frame.csp });
    });

    const port = await listen(shell, options.port ?? 0);

    self = `http://127.0.0.1:${port}`;

    const framePort = await listen(sandbox, options.port === undefined || options.port === 0 ? 0 : options.port + 1);

    frameOrigin = `http://127.0.0.1:${framePort}`;

    if (options.quiet !== true)
    {
        console.log(`호스트 플레이그라운드: ${self}`);
        console.log(`  서버 ${options.server} · 화면 ${frameOrigin}`);
    }

    return {
        url: self,
        frameOrigin,
        close: async () =>
        {
            await Promise.all([shell, sandbox].map((each) => new Promise<void>((resolve) =>
            {
                each.closeAllConnections();
                each.close(() => resolve());
            })));
        },
    };
};
