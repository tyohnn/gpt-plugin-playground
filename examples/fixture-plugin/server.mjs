import { createServer } from "node:http";

/**
 * 플레이그라운드가 제 몸을 재는 본보기 MCP 서버. 의존 없이 돈다.
 *
 * | 도구 | 무엇 |
 * |---|---|
 * | `open_board` | 사이드바 앱. 게시판 화면(`ui://fixture/board`)을 연다 |
 * | `open_doc` | 파일 진입점. `.fixdoc` 을 문서 화면(`ui://fixture/doc`)으로 연다 |
 * | `fill_doc` | 모델이 문서의 칸에 넣을 값을 맡긴다 |
 * | `take_fill` | 화면만 부른다. 맡긴 값을 가져간다 |
 * | `say_hello` | 화면 없는 도구 |
 *
 * 환경값: `FIXTURE_PORT`(4390) · `FIXTURE_TOKEN`(주면 Bearer 를 묻는다) · `FIXTURE_NO_CACHE_FIELDS=1`(새 판의 자원 읽기에서
 * ttlMs · cacheScope 를 뺀다. 실물이 화면을 버리는 경우를 재현한다. 주소 `/mcp-no-cache` 도 같다)
 */
const PORT = Number(process.env.FIXTURE_PORT ?? 4390);
const TOKEN = process.env.FIXTURE_TOKEN;
const MIME = "text/html;profile=mcp-app";

/** 화면 둘이 함께 쓰는 postMessage 의 JSON-RPC */
const TRANSPORT = `
const pending = new Map();
const listeners = {};
let sequence = 0;
const send = (message) => window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
window.addEventListener("message", (event) =>
{
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message.method === undefined && pending.has(message.id))
    {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
    else if (message.method !== undefined && message.id !== undefined)
    {
        send({ id: message.id, result: {} });
    }
    else if (message.method !== undefined)
    {
        (listeners[message.method] ?? []).forEach((listener) => listener(message.params ?? {}));
    }
});
const request = (method, params = {}) => new Promise((resolve, reject) =>
{
    sequence += 1;
    pending.set(sequence, { resolve, reject });
    send({ id: sequence, method, params });
});
const notify = (method, params = {}) => send({ method, params });
const on = (method, listener) => (listeners[method] ??= []).push(listener);
const $ = (id) => document.getElementById(id);
const start = async () =>
{
    const init = await request("ui/initialize", { appInfo: { name: "fixture", version: "0.1.0" }, appCapabilities: {}, protocolVersion: "2026-01-26" });
    window.hostInit = init;
    // 호스트의 밝기를 따른다. 실물 ChatGPT 도 hostContext.theme 을 준다
    const paint = (context) => { if (context?.theme) document.documentElement.style.colorScheme = context.theme; };
    paint(init.hostContext);
    on("ui/notifications/host-context-changed", paint);
    notify("ui/notifications/initialized");
    return init;
};
`;

const BOARD = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>게시판</title>
<style>body{font:14px system-ui;margin:16px;color:CanvasText;background:Canvas}li button[aria-pressed=true]{font-weight:700}</style>
<h1>게시판</h1><p id="platform"></p><ul id="items"></ul>
<button id="send">대화에 보내기</button> <button id="reach">밖으로 부르기</button> <button id="parent">창에 닿아 보기</button>
<p id="reach-result"></p><p id="parent-result"></p>
<script>${TRANSPORT}
on("ui/notifications/tool-result", (result) =>
{
    $("items").replaceChildren(...(result.structuredContent?.items ?? []).map((title) =>
    {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.textContent = title;
        button.setAttribute("aria-pressed", "false");
        button.onclick = async () =>
        {
            document.querySelectorAll("#items button").forEach((each) => each.setAttribute("aria-pressed", String(each === button)));
            await request("ui/update-model-context", { content: [{ type: "text", text: title, _meta: { "openai/title": title } }] });
        };
        item.append(button);
        return item;
    }));
});
on("ui/notifications/host-context-changed", (context) =>
{
    if (context["openai/modelContext"] === null) document.querySelectorAll("#items button").forEach((each) => each.setAttribute("aria-pressed", "false"));
});
$("send").onclick = () => request("ui/message", { role: "user", content: [{ type: "text", text: "게시판에서 보냈어요" }] });
$("reach").onclick = async () =>
{
    try { await fetch("https://example.com/"); $("reach-result").textContent = "밖에 닿았어요"; }
    catch { $("reach-result").textContent = "밖으로 나가지 못했어요"; }
};
$("parent").onclick = () =>
{
    try { $("parent-result").textContent = "창의 제목: " + window.parent.document.title; }
    catch { $("parent-result").textContent = "창에 닿지 못했어요"; }
};
start().then((init) => { $("platform").textContent = "플랫폼: " + init.hostContext.platform; });
</script></html>`;

const DOC = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>문서</title>
<style>body{font:14px system-ui;margin:16px;color:CanvasText;background:Canvas}label{display:block;margin:4px 0}</style>
<h1 id="name">문서</h1><form id="fields"></form>
<button id="save" disabled>저장하기</button> <button id="reload" hidden>다시 불러오기</button> <span id="status"></span>
<script>${TRANSPORT}
let file = null;
let etag = null;
let session = null;
const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
const encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const lines = () => [...$("fields").querySelectorAll("input")].map((input) => input.name + ": " + input.value).join("\\n") + "\\n";
const draw = (text) =>
{
    $("fields").replaceChildren(...text.split("\\n").filter((line) => line.includes(":")).map((line) =>
    {
        const [key, ...rest] = line.split(":");
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.name = key.trim();
        input.value = rest.join(":").trim();
        input.setAttribute("aria-label", key.trim());
        input.oninput = () => { $("save").disabled = false; };
        label.append(key.trim() + " ", input);
        return label;
    }));
};
const load = async () =>
{
    const read = await request("resources/read", { uri: file.resourceUri, _meta: { "openai/resource": { representation: "blob" } } });
    const content = read.contents[0];
    etag = content._meta?.["openai/resource"]?.etag ?? null;
    draw(decode(content.blob));
    $("reload").hidden = true;
    const keys = [...$("fields").querySelectorAll("input")].map((input) => input.name);
    await request("ui/update-model-context", { content: [{ type: "text", text: "열린 문서의 칸: " + keys.join(", ") }], structuredContent: { session, fields: keys } });
};
on("ui/notifications/tool-input", (params) => { file = params.arguments.file; $("name").textContent = file.name; });
on("ui/notifications/tool-result", async (result) =>
{
    session = result.structuredContent.session;
    await load();
    request("resources/subscribe", { uri: file.resourceUri });
    setInterval(async () =>
    {
        const taken = await request("tools/call", { name: "take_fill", arguments: { session } });
        for (const { key, value } of taken.structuredContent?.values ?? [])
        {
            const input = $("fields").querySelector("input[name='" + key + "']");
            if (input) { input.value = value; $("save").disabled = false; }
        }
    }, 300);
});
on("notifications/resources/updated", () => { $("status").textContent = "밖에서 파일이 바뀌었어요."; $("reload").hidden = false; });
$("reload").onclick = () => load();
$("save").onclick = async () =>
{
    const saved = await request("openai/resources/write", { uri: file.resourceUri, blob: encode(lines()), ...(etag === null ? {} : { ifMatch: etag }) });
    if (saved.outcome === "conflict") { $("status").textContent = "그사이 파일이 바뀌어 저장하지 않았어요."; $("reload").hidden = false; return; }
    etag = saved.etag;
    $("save").disabled = true;
    $("status").textContent = "저장했어요.";
};
start();
</script></html>`;

const UI = {
    "ui://fixture/board": { html: BOARD, title: "게시판", display: "fullscreen", csp: { connectDomains: ["https://cdn.jsdelivr.net"], resourceDomains: [] } },
    "ui://fixture/doc": { html: DOC, title: "문서", display: "fullscreen", csp: { connectDomains: [], resourceDomains: [] } },
};

const TOOLS = [
    {
        name: "open_board",
        title: "게시판",
        description: "게시판 화면을 연다.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        _meta: { ui: { resourceUri: "ui://fixture/board" }, "openai/ui": { entrypoints: [{ type: "global" }] } },
    },
    {
        name: "open_doc",
        title: "문서 열기",
        description: ".fixdoc 문서를 열어 칸을 보여 준다.",
        inputSchema: { type: "object", properties: { file: { type: "object", properties: { name: { type: "string" }, resourceUri: { type: "string" } }, required: ["name", "resourceUri"] } }, required: ["file"] },
        annotations: { readOnlyHint: true },
        _meta: { ui: { resourceUri: "ui://fixture/doc" }, "openai/ui": { entrypoints: [{ type: "file", extensions: [".fixdoc"] }] } },
    },
    {
        name: "fill_doc",
        title: "문서 칸 채우기",
        description: "열린 문서의 칸에 넣을 값을 보낸다. session 과 칸 이름은 문서 화면이 대화에 알려 준 것을 쓴다.",
        inputSchema: { type: "object", properties: { session: { type: "string" }, values: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } } } } }, required: ["session", "values"] },
    },
    {
        name: "take_fill",
        title: "맡긴 값 가져오기",
        inputSchema: { type: "object", properties: { session: { type: "string" } }, required: ["session"] },
        _meta: { ui: { visibility: ["app"] } },
    },
    {
        name: "say_hello",
        title: "인사",
        description: "인사를 돌려준다.",
        inputSchema: { type: "object", properties: {} },
    },
];

/** 세션마다 모델이 맡긴 값. 화면이 가져가면 비운다 */
const queues = new Map();
let sessions = 0;

const text = (value) => ({ content: [{ type: "text", text: value }], isError: false });

const callTool = (name, args) =>
{
    switch (name)
    {
        case "open_board":
            return { ...text("게시판을 열었어요."), structuredContent: { items: ["첫 글", "둘째 글", "셋째 글"] } };

        case "open_doc":
            sessions += 1;
            queues.set(`doc-${sessions}`, []);

            return { ...text(`${args.file?.name ?? "문서"} 를 열었어요.`), structuredContent: { session: `doc-${sessions}` } };

        case "fill_doc":
        {
            const queue = queues.get(args.session);

            if (queue === undefined)
            {
                return { ...text("열린 문서가 아니에요."), isError: true };
            }

            queue.push(...(args.values ?? []));

            return text(`${(args.values ?? []).length}칸을 보냈어요. 화면이 채워요.`);
        }

        case "take_fill":
        {
            const values = queues.get(args.session) ?? [];

            queues.set(args.session, []);

            return { content: [], structuredContent: { values }, isError: false };
        }

        case "say_hello":
            return text("안녕하세요.");

        default:
            return null;
    }
};

const answer = (message, dropCacheFields) =>
{
    const { id, method, params = {} } = message;
    const modern = typeof params._meta?.["io.modelcontextprotocol/protocolVersion"] === "string";
    const result = (value) => ({ jsonrpc: "2.0", id, result: value });
    const error = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });

    switch (method)
    {
        case "initialize":
            return result({ protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "0.1.0" } });

        case "server/discover":
            return result({ capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "0.1.0" } });

        case "ping":
            return result({});

        case "tools/list":
            return result({ tools: TOOLS });

        case "resources/list":
            return result({ resources: Object.entries(UI).map(([uri, each]) => ({ uri, name: each.title, mimeType: MIME })) });

        case "resources/read":
        {
            const ui = UI[params.uri];

            if (ui === undefined)
            {
                return error(-32602, "Resource not found");
            }

            const contents = [{ uri: params.uri, mimeType: MIME, text: ui.html, _meta: { ui: { csp: ui.csp }, "openai/ui": { preferredDisplayMode: ui.display } } }];

            return result(modern && !dropCacheFields ? { contents, ttlMs: 0, cacheScope: "private" } : { contents });
        }

        case "tools/call":
        {
            const called = callTool(params.name, params.arguments ?? {});

            return called === null ? error(-32602, `Unknown tool: ${params.name}`) : result(called);
        }

        default:
            return id === undefined ? null : error(-32601, `Method not found: ${method}`);
    }
};

createServer((request, response) =>
{
    // `/mcp-no-cache` 는 `FIXTURE_NO_CACHE_FIELDS=1` 과 같다. 한 프로세스로 두 경우를 함께 잰다
    if (request.method !== "POST" || (request.url !== "/mcp" && request.url !== "/mcp-no-cache"))
    {
        response.writeHead(404).end();

        return;
    }

    if (TOKEN !== undefined && request.headers.authorization !== `Bearer ${TOKEN}`)
    {
        response.writeHead(401, { "www-authenticate": "Bearer" }).end();

        return;
    }

    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () =>
    {
        const answered = answer(JSON.parse(Buffer.concat(chunks).toString("utf8")), process.env.FIXTURE_NO_CACHE_FIELDS === "1" || request.url === "/mcp-no-cache");

        if (answered === null)
        {
            response.writeHead(202).end();

            return;
        }

        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answered));
    });
}).listen(PORT, "127.0.0.1", () => console.log(`본보기 MCP: http://127.0.0.1:${PORT}/mcp`));
