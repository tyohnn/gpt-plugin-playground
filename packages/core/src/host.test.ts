import { describe, expect, it } from "vitest";

import { createFileStore } from "./files";
import { createHost, type HostOptions, type Outgoing } from "./host";
import { MODERN_VERSION } from "./protocol";

/**
 * 호스트의 규칙. 화면이 보낸 말에 무엇을 답하고 무엇을 알리는가를 브라우저 없이 잰다.
 * 서버는 가짜이고, 화면에 보낸 말은 `sent` 에 쌓인다.
 */

const FORM = "ui://forms/editor";

const html = "<!doctype html><p>화면</p>";

const tools = [
    { name: "open_form", title: "서식 열기", _meta: { ui: { resourceUri: FORM }, "openai/ui": { entrypoints: [{ type: "file", extensions: [".hwpx"] }] } } },
    { name: "open_library", title: "쪽지", _meta: { ui: { resourceUri: "ui://notes/library" }, "openai/ui": { entrypoints: [{ type: "global" }] } } },
    { name: "take_fill", _meta: { ui: { visibility: ["app"] } } },
    { name: "fill_form" },
];

type Call = { method: string; params: Record<string, unknown> };

const fakeServer = (override: Partial<Record<string, (params: Record<string, unknown>) => Record<string, unknown>>> = {}) =>
{
    const calls: Array<Call> = [];
    const server = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    {
        calls.push({ method, params });

        const handler = override[method];

        if (handler !== undefined)
        {
            return handler(params);
        }

        if (method === "resources/read")
        {
            return {
                contents: [{ uri: params["uri"], mimeType: "text/html;profile=mcp-app", text: html, _meta: { ui: { csp: { connectDomains: ["https://cdn.jsdelivr.net"], resourceDomains: [] } } } }],
                ttlMs: 0,
                cacheScope: "private",
            };
        }

        if (method === "tools/call")
        {
            return { content: [{ type: "text", text: `불렀다 ${String(params["name"])}` }], structuredContent: { called: params["name"] }, isError: false };
        }

        return {};
    };

    return { calls, server };
};

const setup = (options: Partial<HostOptions> = {}, override: Parameters<typeof fakeServer>[0] = {}) =>
{
    const { calls, server } = fakeServer(override);
    const sent: Array<{ session: string; message: Outgoing }> = [];
    const files = createFileStore([{ uri: "host-resource://form", name: "신청서.hwpx", bytes: new Uint8Array([1, 2, 3]), path: "/Users/me/신청서.hwpx", mimeType: "application/hwp+zip" }]);
    const host = createHost({
        server,
        tools,
        files,
        platform: "desktop",
        theme: "light",
        send: (session, message) => sent.push({ session, message }),
        ...options,
    });
    const methods = (): Array<string> => sent.flatMap(({ message }) => ("method" in message && message.method !== undefined ? [message.method] : []));
    const replyTo = (id: number): Outgoing | undefined => sent.find(({ message }) => "id" in message && message.id === id && !("method" in message))?.message;

    return { host, calls, sent, files, methods, replyTo };
};

const initialize = { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { appInfo: { name: "app", version: "1" }, appCapabilities: {}, protocolVersion: "2026-01-26" } } as const;
const initialized = { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} } as const;

describe("화면을 띄우는 차례", () =>
{
    it("화면이 initialized 를 알리기 전에는 tool-input 과 tool-result 를 보내지 않는다", async () =>
    {
        const { host, methods } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, initialize);
        expect(methods()).not.toContain("ui/notifications/tool-input");
        expect(methods()).not.toContain("ui/notifications/tool-result");

        await host.receive(session.id, initialized);
        expect(methods()).toEqual(["ui/notifications/tool-input", "ui/notifications/tool-result"]);
    });

    it("initialized 를 다시 알리거나 다른 알림이 와도 tool-result 는 한 번만 보낸다", async () =>
    {
        const { host, methods } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, initialized);
        await host.receive(session.id, initialized);
        await host.receive(session.id, { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 300 } });
        expect(methods().filter((method) => method === "ui/notifications/tool-result")).toHaveLength(1);
    });

    it("진입점으로 연 화면에는 호스트가 도구를 먼저 부르고 그 결과를 tool-result 로 준다", async () =>
    {
        const { host, calls, sent } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        expect(calls.map((call) => `${call.method} ${String(call.params["name"] ?? call.params["uri"])}`)).toEqual(["tools/call open_library", "resources/read ui://notes/library"]);

        await host.receive(session.id, initialize);
        await host.receive(session.id, initialized);

        const result = sent.find(({ message }) => "method" in message && message.method === "ui/notifications/tool-result")?.message;

        expect(result && "params" in result ? result.params?.["structuredContent"] : undefined).toEqual({ called: "open_library" });
    });

    it("모델이 이미 부른 도구의 화면은 도구를 다시 부르지 않고 받은 결과로 띄운다", async () =>
    {
        const { host, calls } = setup();

        await host.mount({ tool: "open_library", input: {}, surface: "inline", result: { content: [], structuredContent: { given: true } } });
        expect(calls.map((call) => call.method)).toEqual(["resources/read"]);
    });

    it("새 판으로 부르는 호스트는 모든 요청에 판과 능력을 싣는다", async () =>
    {
        const { host, calls } = setup();

        await host.mount({ tool: "open_library", input: {}, surface: "global" });

        for (const call of calls)
        {
            expect((call.params["_meta"] as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"]).toBe(MODERN_VERSION);
        }
    });

    it("화면이 teardown 을 받기 전에 사라지지 않는다. 닫으면 ui/resource-teardown 을 청하고 답을 기다린다", async () =>
    {
        const { host, sent } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });
        const closing = host.unmount(session.id);
        const request = sent.find(({ message }) => "method" in message && message.method === "ui/resource-teardown")?.message;

        expect(request).toBeDefined();
        await host.receive(session.id, { jsonrpc: "2.0", id: request && "id" in request ? request.id : 0, result: {} });
        await closing;
        expect(host.session(session.id)).toBeUndefined();
    });
});

describe("화면 자원을 받는 법", () =>
{
    it("새 판의 resources/read 답에 ttlMs 나 cacheScope 가 없으면 화면을 띄우지 않고 까닭을 남긴다", async () =>
    {
        const { host } = setup({}, {
            "resources/read": (params) => ({ contents: [{ uri: params["uri"], mimeType: "text/html;profile=mcp-app", text: html }] }),
        });

        await expect(host.mount({ tool: "open_library", input: {}, surface: "global" })).rejects.toThrow(/ttlMs/);
    });

    it("mimeType 이 text/html;profile=mcp-app 가 아니면 화면을 띄우지 않는다", async () =>
    {
        const { host } = setup({}, {
            "resources/read": (params) => ({ contents: [{ uri: params["uri"], mimeType: "text/html", text: html }], ttlMs: 0, cacheScope: "private" }),
        });

        await expect(host.mount({ tool: "open_library", input: {}, surface: "global" })).rejects.toThrow(/profile=mcp-app/);
    });

    it("자원의 csp 는 화면의 CSP 로 옮겨지고 밖으로 닿을 곳은 connectDomains 뿐이다", async () =>
    {
        const { host } = setup();
        const session = await host.mount({ tool: "open_form", input: { file: { name: "신청서.hwpx", resourceUri: "host-resource://form" } }, surface: "file" });

        expect(session.frame.csp).toContain("connect-src https://cdn.jsdelivr.net");
        expect(session.frame.csp).toContain("default-src 'none'");
        expect(session.frame.html).toBe(html);
    });
});

describe("파일 진입점", () =>
{
    const openForm = async (options: Partial<HostOptions> = {}) =>
    {
        const context = setup(options);
        const session = await context.host.mount({ tool: "open_form", input: { file: { name: "신청서.hwpx", resourceUri: "host-resource://form" } }, surface: "file" });

        await context.host.receive(session.id, initialize);
        await context.host.receive(session.id, initialized);

        return { ...context, session };
    };

    it("파일 진입점으로 연 화면에는 파일의 이름과 주소만 주고 경로는 주지 않는다", async () =>
    {
        const { sent } = await openForm();
        const input = sent.find(({ message }) => "method" in message && message.method === "ui/notifications/tool-input")?.message;

        expect(JSON.stringify(input)).not.toContain("/Users/me");
        expect(input && "params" in input ? input.params : undefined).toEqual({ arguments: { file: { name: "신청서.hwpx", resourceUri: "host-resource://form" } } });
    });

    it("blob 으로 읽으면 바이트를 base64 로, text 로 읽으면 글로 준다", async () =>
    {
        const { host, session, replyTo } = await openForm();

        await host.receive(session.id, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "host-resource://form", _meta: { "openai/resource": { representation: "blob" } } } });

        const reply = replyTo(2);
        const content = (reply && "result" in reply ? reply.result?.["contents"] : undefined) as Array<Record<string, unknown>>;

        expect(content[0]?.["blob"]).toBe("AQID");
        expect(content[0]?.["text"]).toBeUndefined();
        expect(content[0]?.["_meta"]).toEqual({ "openai/resource": { etag: "v1", writable: true } });
    });

    it("읽을 때의 etag 와 다른 ifMatch 로 쓰면 덮어쓰지 않고 conflict 와 지금의 etag 를 준다", async () =>
    {
        const { host, session, replyTo, files } = await openForm();

        files.touch("host-resource://form", new Uint8Array([9]));
        await host.receive(session.id, { jsonrpc: "2.0", id: 3, method: "openai/resources/write", params: { uri: "host-resource://form", blob: "BAU=", ifMatch: "v1" } });

        const reply = replyTo(3);

        expect(reply && "result" in reply ? reply.result : undefined).toEqual({ outcome: "conflict", etag: "v2" });
        expect([...files.get("host-resource://form")?.bytes ?? []]).toEqual([9]);
    });

    it("맞는 ifMatch 로 쓰면 바이트를 바꾸고 새 etag 를 준다", async () =>
    {
        const { host, session, replyTo, files } = await openForm();

        await host.receive(session.id, { jsonrpc: "2.0", id: 4, method: "openai/resources/write", params: { uri: "host-resource://form", blob: "BAU=", ifMatch: "v1" } });

        const reply = replyTo(4);

        expect(reply && "result" in reply ? reply.result : undefined).toEqual({ outcome: "saved", etag: "v2" });
        expect([...files.get("host-resource://form")?.bytes ?? []]).toEqual([4, 5]);
    });

    it("쓸 수 없는 파일에 쓰면 거절한다", async () =>
    {
        const context = setup();

        context.files.add({ uri: "host-resource://locked", name: "잠긴.hwpx", bytes: new Uint8Array([1]), path: "/x", mimeType: "application/hwp+zip", writable: false });

        const session = await context.host.mount({ tool: "open_form", input: { file: { name: "잠긴.hwpx", resourceUri: "host-resource://locked" } }, surface: "file" });

        await context.host.receive(session.id, { jsonrpc: "2.0", id: 5, method: "openai/resources/write", params: { uri: "host-resource://locked", blob: "AQ==" } });

        const reply = context.replyTo(5);

        expect(reply && "error" in reply ? reply.error?.message : undefined).toMatch(/쓸 수 없/);
    });

    it("구독한 파일이 밖에서 바뀌면 notifications/resources/updated 를 보낸다", async () =>
    {
        const { host, session, files, methods } = await openForm();

        await host.receive(session.id, { jsonrpc: "2.0", id: 6, method: "resources/subscribe", params: { uri: "host-resource://form" } });
        files.touch("host-resource://form", new Uint8Array([7]));
        expect(methods()).toContain("notifications/resources/updated");
    });

    it("파일 진입점에서 나간 도구 호출에는 호스트가 그 파일의 경로를 _meta 로 얹는다", async () =>
    {
        const { host, session, calls } = await openForm();

        await host.receive(session.id, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "take_fill", arguments: { session: "s" } } });

        const call = calls.find((each) => each.params["name"] === "take_fill");

        expect((call?.params["_meta"] as Record<string, unknown>)["openai/resource"]).toEqual({ path: "/Users/me/신청서.hwpx" });
    });
});

describe("플랫폼과 능력", () =>
{
    it("데스크톱이 아니면 파일 능력을 알리지 않는다", async () =>
    {
        const { host, replyTo } = setup({ platform: "web" });
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, initialize);

        const reply = replyTo(1);
        const experimental = (reply && "result" in reply ? (reply.result?.["hostCapabilities"] as Record<string, Record<string, unknown>>)["experimental"] : {}) ?? {};

        expect(Object.keys(experimental)).not.toContain("openai/files");
        expect(Object.keys(experimental)).not.toContain("openai/resource");
    });

    it("호스트가 알리지 않은 능력의 메서드를 화면이 부르면 오류로 답한다", async () =>
    {
        const { host, replyTo } = setup({ platform: "web" });
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, { jsonrpc: "2.0", id: 8, method: "openai/files/open", params: { path: "/x" } });

        const reply = replyTo(8);

        expect(reply && "error" in reply ? reply.error?.code : undefined).toBe(-32601);
    });

    it("모르는 메서드에는 -32601 로 답한다", async () =>
    {
        const { host, replyTo } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, { jsonrpc: "2.0", id: 9, method: "ui/does-not-exist", params: {} });

        const reply = replyTo(9);

        expect(reply && "error" in reply ? reply.error?.code : undefined).toBe(-32601);
    });

    it("visibility 가 app 인 도구는 모델의 목록에 서지 않고 화면만 부를 수 있다", async () =>
    {
        const { host } = setup();

        expect(host.modelTools().map((tool) => tool.name)).toEqual(["open_form", "open_library", "fill_form"]);
    });
});

describe("모델 컨텍스트", () =>
{
    it("ui/update-model-context 의 내용은 그 화면의 첨부가 되고, 빈 내용이면 첨부를 뗀다", async () =>
    {
        const { host } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, { jsonrpc: "2.0", id: 10, method: "ui/update-model-context", params: { content: [{ type: "text", text: "칸 목록" }] } });
        expect(host.session(session.id)?.context?.content).toEqual([{ type: "text", text: "칸 목록" }]);

        await host.receive(session.id, { jsonrpc: "2.0", id: 11, method: "ui/update-model-context", params: { content: [] } });
        expect(host.session(session.id)?.context).toBeNull();
    });

    it("사람이 첨부를 떼면 화면에 openai/modelContext 를 null 로 알린다", async () =>
    {
        const { host, sent } = setup();
        const session = await host.mount({ tool: "open_library", input: {}, surface: "global" });

        await host.receive(session.id, { jsonrpc: "2.0", id: 12, method: "ui/update-model-context", params: { content: [{ type: "text", text: "칸" }] } });
        host.detachContext(session.id);

        const changed = sent.find(({ message }) => "method" in message && message.method === "ui/notifications/host-context-changed")?.message;

        expect(changed && "params" in changed ? changed.params : undefined).toEqual({ "openai/modelContext": null });
    });
});
