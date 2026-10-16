import {
    createFileStore,
    createHost,
    entrypointsOf,
    fileToolFor,
    fromBase64,
    HostRefusal,
    isAppOnly,
    isRecord,
    mentionToolOf,
    resourceUriOf,
    RULES,
    toBase64,
    toolsWith,
    type Action,
    type DisplayMode,
    type FileStore,
    type Host,
    type Json,
    type LogEntry,
    type Model,
    type Session,
    type Theme,
    type Tool,
    type Turn,
} from "@host-playground/core";

import type { Config } from "./config";
import { rpc } from "./rpc";

/**
 * 창의 상태와 그 상태를 바꾸는 일. React 는 `subscribe` 로 바뀐 것을 듣는다.
 *
 * 호스트의 규칙은 `@host-playground/core` 가 갖고, 여기는 그 규칙을 대화 · 사이드바 · 옆 패널 · 개발 도구의 자리에 잇는다.
 * 실물 ChatGPT 의 자리 이름을 따랐다.
 */
export type Block =
    | { readonly kind: "user"; readonly text: string; readonly attached: ReadonlyArray<string> }
    | { readonly kind: "assistant"; readonly text: string; readonly error?: boolean; readonly details?: { readonly summary: string; readonly body: string } }
    | { readonly kind: "note"; readonly text: string }
    | { readonly kind: "widget"; readonly session: string }
    | { readonly kind: "form"; readonly id: string; readonly tool: string; readonly args: Json; readonly result: Json; answered: boolean }
    | { readonly kind: "refused"; readonly rule: string; readonly reason: string };

export interface Tab
{
    readonly id: string;
    readonly title: string;
    readonly session: string;
}

export interface Thread
{
    readonly id: string;
    title: string;
    blocks: Array<Block>;
    tabs: Array<Tab>;
    active: string | null;
}

export type View = { readonly kind: "chat"; readonly thread: string } | { readonly kind: "app"; readonly tool: string } | { readonly kind: "plugin" };

export interface Mention
{
    readonly uri: string;
    readonly title: string;
}

interface Frame
{
    readonly url: string;
    window: Window | null;
    readonly queue: Array<unknown>;
    height: number | null;
}

declare global
{
    interface Window
    {
        /** e2e 가 모델 자리에 앉힌 대본. Playwright 의 `exposeFunction` 이 단다 */
        __playgroundModel?: (turn: Turn) => Promise<ReadonlyArray<Action>>;
        playground?: PlaygroundApi;
    }
}

/** e2e 와 개발 도구가 쓰는 창의 손잡이 */
export interface PlaygroundApi
{
    readonly log: ReadonlyArray<LogEntry>;
    readonly sent: (method: string) => ReadonlyArray<Json>;
    readonly addFile: (name: string, base64: string, mimeType?: string) => string;
    readonly touchFile: (uri: string, base64: string) => void;
    readonly fileBase64: (uri: string) => string | null;
    readonly files: () => ReadonlyArray<{ readonly uri: string; readonly name: string; readonly etag: string }>;
    readonly openFile: (uri: string) => Promise<void>;
    readonly say: (text: string) => Promise<void>;
    readonly rules: typeof RULES;
}

const MODEL_NAME = "규칙";

/** 모델이 없을 때 서는 규칙. 보낸 글에 도구의 이름(title)이 들어 있으면 그 도구를 부른다 */
const titleModel = (): Model => ({
    name: MODEL_NAME,
    respond: async (turn) =>
    {
        const tools = turn.tools as ReadonlyArray<Tool>;
        const squeezed = turn.text.replace(/\s/g, "");
        const named = tools
            .filter((tool) => tool.title !== undefined && squeezed.includes(tool.title.replace(/\s/g, "")))
            .filter((tool) => !Array.isArray(tool.inputSchema?.["required"]) || tool.inputSchema["required"].length === 0)
            .sort((left, right) => (right.title?.length ?? 0) - (left.title?.length ?? 0))[0];

        if (named === undefined)
        {
            const titles = tools.flatMap((tool) => (tool.title === undefined ? [] : [`「${tool.title}」`])).join(" · ");

            return [{ kind: "say", text: `여기에는 모델이 없어요. 도구의 이름을 넣어 말하면 그 도구를 불러요: ${titles}` }];
        }

        return [{ kind: "call", tool: named.name, arguments: {} }];
    },
});

export class Playground
{
    readonly host: Host;
    readonly files: FileStore;
    readonly threads: Array<Thread> = [];
    readonly log: Array<LogEntry> = [];
    readonly frames = new Map<string, Frame>();
    /** 사이드바 앱마다 하나씩 띄워 둔 화면 */
    readonly globals = new Map<string, string>();
    /** 화면이 어느 대화에 딸렸는가. 사이드바 앱의 화면은 대화가 없다 */
    readonly owners = new Map<string, string | null>();
    view: View;
    theme: Theme;
    devtools = false;
    busy = 0;
    private version = 0;
    private readonly listeners = new Set<() => void>();
    private sequence = 0;

    constructor(readonly config: Config, readonly tools: ReadonlyArray<Tool>, files: ReadonlyArray<{ name: string; bytes: Uint8Array; mimeType: string; path: string }>)
    {
        this.theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
        this.files = createFileStore(files.map((file, index) => ({ uri: `host-resource://file-${index + 1}`, name: file.name, bytes: file.bytes, path: file.path, mimeType: file.mimeType })));
        this.files.onChange(() => this.changed());
        this.host = createHost({
            server: rpc,
            tools,
            files: this.files,
            platform: config.platform,
            theme: this.theme,
            modern: config.modern,
            send: (session, message) => this.post(session, message),
            events: {
                log: (entry) =>
                {
                    this.log.push(entry);
                    this.changed();
                },
                message: (session, params) => void this.onWidgetMessage(session, params),
                contextChanged: () => this.changed(),
                displayMode: (session, wanted) => this.onDisplayMode(session, wanted),
                sizeChanged: (session, size) =>
                {
                    const frame = this.frames.get(session.id);

                    if (frame !== undefined && Number.isFinite(size.height))
                    {
                        frame.height = Math.min(640, Math.max(120, Number(size.height)));
                        this.changed();
                    }
                },
                filesOpen: (session, path) => this.note(this.owners.get(session.id) ?? null, `호스트가 기본 뷰어로 파일을 열었어요: ${path}`),
                openLink: (session, url) => this.note(this.owners.get(session.id) ?? null, `호스트가 링크를 열었어요: ${url}`),
            },
        });

        window.addEventListener("message", (event) =>
        {
            if (event.origin !== this.config.frameOrigin)
            {
                return;
            }

            const id = [...this.frames.entries()].find(([, frame]) => frame.window === event.source)?.[0];

            if (id !== undefined && isRecord(event.data))
            {
                void this.host.receive(id, event.data as never);
            }
        });

        this.view = { kind: "chat", thread: this.newThread().id };
        window.playground = this.api();
    }

    // ── 구독 ──────────────────────────────────────────────────────────────

    readonly subscribe = (listener: () => void): (() => void) =>
    {
        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    };

    readonly snapshot = (): number => this.version;

    changed(): void
    {
        this.version += 1;
        this.listeners.forEach((listener) => listener());
    }

    // ── 도구 ──────────────────────────────────────────────────────────────

    tool(name: string): Tool | undefined
    {
        return this.tools.find((tool) => tool.name === name);
    }

    globalTools(): ReadonlyArray<Tool>
    {
        return toolsWith(this.tools, "global", this.host.platform());
    }

    threadTools(): ReadonlyArray<Tool>
    {
        return toolsWith(this.tools, "thread", this.host.platform());
    }

    mentionTool(): Tool | undefined
    {
        // 멘션은 데스크톱 앱의 컴포저에서만 뜬다(`desktop-only`)
        return this.host.platform() === "desktop" ? mentionToolOf(this.tools) : undefined;
    }

    iconOf(tool: Tool | undefined): string | null
    {
        const src = tool?.icons?.[0]?.src;

        if (src !== undefined)
        {
            return src;
        }

        return this.config.plugin?.icon == null ? null : `data:image/svg+xml,${encodeURIComponent(this.config.plugin.icon)}`;
    }

    pluginName(): string
    {
        return this.config.plugin?.displayName ?? "플러그인";
    }

    // ── 화면(iframe) ──────────────────────────────────────────────────────

    private post(session: string, message: unknown): void
    {
        const frame = this.frames.get(session);

        if (frame?.window == null)
        {
            frame?.queue.push(message);

            return;
        }

        frame.window.postMessage(message, this.config.frameOrigin);
    }

    /** iframe 이 떴다. 그사이 보내지 못한 말을 보낸다 */
    attach(session: string, target: Window | null): void
    {
        const frame = this.frames.get(session);

        if (frame === undefined)
        {
            return;
        }

        frame.window = target;
        frame.queue.splice(0).forEach((message) => target?.postMessage(message, this.config.frameOrigin));
    }

    /** 화면 하나를 띄운다. 화면 HTML 은 다른 origin 에서 자원의 CSP 와 함께 나간다 */
    async mount(tool: string, input: Json, surface: Session["surface"], owner: string | null, result?: Json): Promise<Session>
    {
        const session = await this.host.mount({ tool, input, surface, ...(result === undefined ? {} : { result }) });
        const registered = await (await fetch("/api/frames", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ html: session.frame.html, csp: session.frame.csp }),
        })).json() as { url: string };

        this.frames.set(session.id, { url: registered.url, window: null, queue: [], height: null });
        this.owners.set(session.id, owner);
        this.changed();

        return session;
    }

    async unmount(session: string): Promise<void>
    {
        await this.host.unmount(session);
        this.frames.delete(session);
        this.owners.delete(session);
        this.changed();
    }

    private onDisplayMode(session: Session, wanted: DisplayMode): DisplayMode
    {
        // 사이드바와 옆 패널의 화면은 늘 전체 화면이다. 대화 안의 화면만 크기를 바꾼다
        const mode = session.surface === "inline" ? (wanted === "pip" ? "fullscreen" : wanted) : "fullscreen";

        queueMicrotask(() => this.changed());

        return mode;
    }

    setMode(session: string, mode: DisplayMode): void
    {
        this.host.setMode(session, mode);
        this.changed();
    }

    // ── 대화 ──────────────────────────────────────────────────────────────

    newThread(title = "새 채팅"): Thread
    {
        this.sequence += 1;

        const thread: Thread = { id: `t${this.sequence}`, title, blocks: [], tabs: [], active: null };

        this.threads.unshift(thread);
        this.changed();

        return thread;
    }

    thread(id: string): Thread | undefined
    {
        return this.threads.find((thread) => thread.id === id);
    }

    currentThread(): Thread | undefined
    {
        return this.view.kind === "chat" ? this.thread(this.view.thread) : undefined;
    }

    show(view: View): void
    {
        this.view = view;
        this.changed();
    }

    private add(thread: string | null, block: Block): void
    {
        const target = thread === null ? undefined : this.thread(thread);

        target?.blocks.push(block);
        this.changed();
    }

    note(thread: string | null, text: string): void
    {
        this.add(thread, { kind: "note", text });
    }

    /** 이 컴포저가 보는 화면들. 대화의 컴포저는 그 대화의 화면을, 사이드바 앱의 컴포저는 그 앱의 화면을 본다 */
    scope(): ReadonlyArray<Session>
    {
        if (this.view.kind === "app")
        {
            const id = this.globals.get(this.view.tool);
            const session = id === undefined ? undefined : this.host.session(id);

            return session === undefined ? [] : [session];
        }

        const thread = this.currentThread()?.id;

        return this.host.sessions().filter((session) => thread !== undefined && this.owners.get(session.id) === thread);
    }

    private model(): Model
    {
        const scripted = window.__playgroundModel;

        return scripted === undefined ? titleModel() : { name: "e2e", respond: async (turn) => await scripted(turn) };
    }

    modelName(): string
    {
        return window.__playgroundModel === undefined ? MODEL_NAME : "e2e 대본";
    }

    async send(text: string, mentions: ReadonlyArray<Mention>, skill?: Turn["skill"]): Promise<void>
    {
        let thread = this.currentThread();
        const contexts = this.scope().flatMap((session) => (session.context === null ? [] : [session.context]));

        if (thread === undefined)
        {
            // 사이드바 앱의 컴포저에서 보내면 새 대화가 선다. 앱의 컨텍스트를 함께 가져간다
            thread = this.newThread();
            this.show({ kind: "chat", thread: thread.id });
        }

        await this.converse(thread, { text, mentions, contexts, tools: this.host.modelTools(), ...(skill === undefined ? {} : { skill }) });
    }

    private async converse(thread: Thread, turn: Turn): Promise<void>
    {
        const attached = [...turn.mentions.map((mention) => `@${mention.title}`), ...turn.contexts.flatMap(contextTitles)];

        if (thread.title === "새 채팅" && turn.text !== "")
        {
            thread.title = turn.text.slice(0, 24);
        }

        this.add(thread.id, { kind: "user", text: turn.text, attached });
        this.busy += 1;
        this.changed();

        try
        {
            if (turn.mentions.length > 0)
            {
                const read = await Promise.all(turn.mentions.map(async (mention) =>
                {
                    const result = await this.host.readResource(mention.uri).catch(() => null);
                    const content = Array.isArray(result?.["contents"]) ? result["contents"][0] : undefined;

                    return isRecord(content) && typeof content["text"] === "string" ? content["text"] : "(읽지 못했어요)";
                }));

                this.add(thread.id, { kind: "assistant", text: `붙인 것 ${read.length}개를 읽었어요.`, details: { summary: "모델이 읽은 글", body: read.join("\n\n") } });
            }

            for (const action of await this.model().respond(turn))
            {
                if (action.kind === "say")
                {
                    this.add(thread.id, { kind: "assistant", text: action.text });
                }
                else
                {
                    await this.invoke(thread.id, action.tool, action.arguments);
                }
            }
        }
        catch (error)
        {
            this.add(thread.id, { kind: "assistant", text: error instanceof Error ? error.message : String(error), error: true });
        }
        finally
        {
            this.busy -= 1;
            this.changed();
        }
    }

    /** 모델이 도구를 부른 것처럼 부른다. 화면이 딸렸으면 대화 안에 서고, 폼이 필요하면 폼 카드가 선다 */
    async invoke(thread: string, name: string, args: Json, more: Json = {}): Promise<void>
    {
        const tool = this.tool(name);

        if (tool === undefined || isAppOnly(tool))
        {
            this.add(thread, { kind: "assistant", text: `모델은 ${name} 를 부를 수 없어요.`, error: true });

            return;
        }

        if (more["inputResponses"] === undefined)
        {
            this.note(thread, `${this.pluginName()} · ${tool.title ?? tool.name}`);
        }

        if (entrypointsOf(tool).some((entry) => entry.type === "thread"))
        {
            await this.openTab(thread, tool.name, args);

            return;
        }

        const result = await this.host.callTool(tool.name, args, more);

        if (result["resultType"] === "input_required")
        {
            this.sequence += 1;
            this.add(thread, { kind: "form", id: `f${this.sequence}`, tool: tool.name, args, result, answered: false });

            return;
        }

        if (resourceUriOf(tool) !== undefined && result["isError"] !== true)
        {
            try
            {
                const session = await this.mount(tool.name, args, "inline", thread, result);

                this.add(thread, { kind: "widget", session: session.id });
            }
            catch (error)
            {
                this.refused(thread, error);
            }

            return;
        }

        const content = Array.isArray(result["content"]) ? result["content"].filter(isRecord) : [];
        const texts = content.filter((block) => block["type"] === "text").map((block) => String(block["text"]));
        const resources = content.filter((block) => block["type"] === "resource" && isRecord(block["resource"])).map((block) => String((block["resource"] as Json)["text"] ?? ""));

        this.add(thread, {
            kind: "assistant",
            text: texts.join("\n"),
            error: result["isError"] === true,
            ...(resources.length > 0 ? { details: { summary: `모델이 읽은 자원 ${resources.length}개`, body: resources.join("\n\n") } } : {}),
        });
    }

    private refused(thread: string | null, error: unknown): void
    {
        if (error instanceof HostRefusal)
        {
            this.add(thread, { kind: "refused", rule: error.rule, reason: error.message });

            return;
        }

        this.add(thread, { kind: "assistant", text: error instanceof Error ? error.message : String(error), error: true });
    }

    async answerForm(thread: string, form: Extract<Block, { kind: "form" }>, key: string, response: Json): Promise<void>
    {
        form.answered = true;
        this.changed();

        try
        {
            // 답과 함께 서버가 맡긴 상태를 그대로 돌려보낸다. 호스트는 그 속을 읽지 않는다
            await this.invoke(thread, form.tool, form.args, { inputResponses: { [key]: response }, requestState: form.result["requestState"] });
        }
        catch (error)
        {
            this.refused(thread, error);
        }
    }

    private async onWidgetMessage(session: Session, params: Json): Promise<void>
    {
        const blocks = Array.isArray(params["content"]) ? params["content"].filter(isRecord) : [];
        const meta = isRecord(params["_meta"]) && isRecord(params["_meta"]["openai/message"]) ? params["_meta"]["openai/message"] : {};
        const owner = this.owners.get(session.id) ?? null;
        // 새 대화로 보내라고 했거나 화면이 대화에 딸려 있지 않으면 새 대화를 연다
        const thread = meta["target"] === "new" || owner === null ? this.newThread() : this.thread(owner) ?? this.newThread();
        const contexts = this.host.sessions().filter((each) => each.context !== null && (each.id === session.id || this.owners.get(each.id) === thread.id)).map((each) => each.context as Json);

        this.show({ kind: "chat", thread: thread.id });
        await this.converse(thread, {
            text: blocks.filter((block) => block["type"] === "text").map((block) => String(block["text"])).join("\n"),
            mentions: blocks.filter((block) => block["type"] === "resource_link").map((block) => ({ uri: String(block["uri"]), title: String(block["name"] ?? block["uri"]) })),
            contexts,
            tools: this.host.modelTools(),
        });
    }

    detach(session: string): void
    {
        this.host.detachContext(session);
        this.changed();
    }

    // ── 옆 패널 ───────────────────────────────────────────────────────────

    async openTab(thread: string, tool: string, input: Json, title?: string): Promise<void>
    {
        const target = this.thread(thread);
        const named = title ?? this.tool(tool)?.title ?? tool;

        if (target === undefined)
        {
            return;
        }

        const existing = target.tabs.find((tab) => tab.title === named);

        if (existing !== undefined)
        {
            target.active = existing.id;
            this.changed();

            return;
        }

        try
        {
            const surface = isRecord(input["file"]) ? "file" : "thread";
            const session = await this.mount(tool, input, surface, thread);
            const tab = { id: session.id, title: named, session: session.id };

            target.tabs.push(tab);
            target.active = tab.id;
            this.changed();
        }
        catch (error)
        {
            this.refused(thread, error);
        }
    }

    async closeTab(thread: string, tab: string): Promise<void>
    {
        const target = this.thread(thread);
        const found = target?.tabs.find((each) => each.id === tab);

        if (target === undefined || found === undefined)
        {
            return;
        }

        await this.unmount(found.session);
        target.tabs = target.tabs.filter((each) => each.id !== tab);
        target.active = target.tabs[0]?.id ?? null;
        this.changed();
    }

    /** 사람의 파일을 그 확장자를 여는 플러그인 화면으로 연다. 데스크톱에서만 된다 */
    async openFile(uri: string): Promise<void>
    {
        const file = this.files.get(uri);
        const tool = file === undefined ? undefined : fileToolFor(this.tools, file.name, this.host.platform());
        let thread = this.currentThread();

        if (file === undefined || tool === undefined)
        {
            return;
        }

        if (thread === undefined)
        {
            thread = this.newThread();
            this.show({ kind: "chat", thread: thread.id });
        }

        await this.openTab(thread.id, tool.name, { file: { name: file.name, resourceUri: file.uri } }, file.name);
    }

    // ── 사이드바 앱 ───────────────────────────────────────────────────────

    async openGlobal(tool: string): Promise<void>
    {
        this.show({ kind: "app", tool });

        if (this.globals.has(tool))
        {
            return;
        }

        try
        {
            const session = await this.mount(tool, {}, "global", null);

            this.globals.set(tool, session.id);
            this.changed();
        }
        catch (error)
        {
            const thread = this.newThread(this.tool(tool)?.title ?? tool);

            this.refused(thread.id, error);
            this.show({ kind: "chat", thread: thread.id });
        }
    }

    async quickAction(tool: Tool): Promise<void>
    {
        const quick = entrypointsOf(tool).find((entry) => entry.type === "global")?.quickAction;

        if (quick === undefined)
        {
            return;
        }

        // 바로 가기는 화면을 띄우지 않고 도구를 곧바로 부른다
        const thread = this.newThread(quick.title);

        this.show({ kind: "chat", thread: thread.id });
        await this.invoke(thread.id, quick.target.name, quick.target.arguments ?? {});
    }

    // ── 호스트 설정 ───────────────────────────────────────────────────────

    setTheme(theme: Theme): void
    {
        this.theme = theme;
        document.documentElement.classList.toggle("dark", theme === "dark");
        this.host.setTheme(theme);
        this.changed();
    }

    deepLink(url: string): void
    {
        const first = this.globalTools()[0];
        const session = first === undefined ? undefined : this.globals.get(first.name);

        if (first !== undefined && session === undefined)
        {
            void this.openGlobal(first.name).then(() =>
            {
                const opened = this.globals.get(first.name);

                if (opened !== undefined)
                {
                    setTimeout(() => this.host.deepLink(opened, url), 600);
                }
            });

            return;
        }

        if (first !== undefined && session !== undefined)
        {
            this.show({ kind: "app", tool: first.name });
            this.host.deepLink(session, url);
        }
    }

    addFile(name: string, bytes: Uint8Array, mimeType = "application/octet-stream"): string
    {
        this.sequence += 1;

        const file = this.files.add({ uri: `host-resource://added-${this.sequence}`, name, bytes, mimeType, path: `/Users/me/Documents/${name}` });

        this.changed();

        return file.uri;
    }

    private api(): PlaygroundApi
    {
        return {
            log: this.log,
            sent: (method) => this.log
                .filter((entry) => entry.direction === "화면→호스트" && isRecord(entry.payload) && entry.payload["method"] === method)
                .map((entry) => (isRecord(entry.payload) && isRecord(entry.payload["params"]) ? entry.payload["params"] : {})),
            addFile: (name, base64, mimeType) => this.addFile(name, fromBase64(base64), mimeType),
            touchFile: (uri, base64) => this.files.touch(uri, fromBase64(base64)),
            fileBase64: (uri) =>
            {
                const file = this.files.get(uri);

                return file === undefined ? null : toBase64(file.bytes);
            },
            files: () => this.files.list().map((file) => ({ uri: file.uri, name: file.name, etag: file.etag })),
            openFile: async (uri) => await this.openFile(uri),
            say: async (text) => await this.send(text, []),
            rules: RULES,
        };
    }
}

/** 컨텍스트에서 사람에게 보이는 조각의 이름. 모델만 읽는 조각(`audience: assistant`)은 첨부로 서지 않는다 */
export const contextTitles = (context: Json): ReadonlyArray<string> =>
    (Array.isArray(context["content"]) ? context["content"].filter(isRecord) : [])
        .filter((block) =>
        {
            const audience = isRecord(block["annotations"]) && Array.isArray(block["annotations"]["audience"]) ? block["annotations"]["audience"] : ["user"];

            return !audience.every((who) => who === "assistant");
        })
        .map((block) =>
        {
            const title = isRecord(block["_meta"]) ? block["_meta"]["openai/title"] : undefined;

            return typeof title === "string" ? title : String(block["text"] ?? block["name"] ?? block["type"]).slice(0, 40);
        });

export const startPlayground = async (config: Config): Promise<Playground> =>
{
    const listed = await rpc("tools/list", config.modern ? { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } : {});
    const tools = (Array.isArray(listed["tools"]) ? listed["tools"] : []) as ReadonlyArray<Tool>;
    const files = await Promise.all(config.files.map(async (file) => ({
        name: file.name,
        mimeType: file.mimeType,
        path: file.path,
        bytes: new Uint8Array(await (await fetch(`/api/files/${file.index}`)).arrayBuffer()),
    })));

    return new Playground(config, tools, files);
};
