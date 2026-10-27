import { test as base, type FrameLocator, type Page } from "@playwright/test";
import { scriptedModel, type Action, type Json, type LogEntry, type Model, type ScriptLine, type Turn } from "@host-playground/core";

import { createPlayground, type PlaygroundOptions } from "./server";

/**
 * Playwright 고정 장치. 플레이그라운드를 띄우고, 모델 자리에 시나리오의 대본을 앉힌다.
 *
 * ```ts
 * import { test, expect } from "gpt-plugin-playground/playwright";
 *
 * test.use({ playground: { server: "http://127.0.0.1:4200/api/mcp", files: ["fixtures/신청서.hwpx"] } });
 *
 * test("모델이 칸을 채운다", async ({ host }) =>
 * {
 *     host.script([{ when: /채워/, then: [{ kind: "call", tool: "fill_form", arguments: { … } }] }]);
 *     await host.say("이름에 홍길동을 채워 줘");
 * });
 * ```
 *
 * 대본은 Node 쪽에서 돈다. 창은 차례(`Turn`)를 넘기고 할 일(`Action`)을 받는다.
 */
/** 창이 `window.playground` 로 내놓는 손잡이. 정본은 `apps/shell/src/lib/store.ts` 의 `PlaygroundApi` 다 */
interface WindowApi
{
    readonly log: ReadonlyArray<LogEntry>;
    readonly sent: (method: string) => ReadonlyArray<Json>;
    readonly addFile: (name: string, base64: string, mimeType?: string) => string;
    readonly touchFile: (uri: string, base64: string) => void;
    readonly fileBase64: (uri: string) => string | null;
    readonly files: () => ReadonlyArray<{ readonly uri: string; readonly name: string; readonly etag: string }>;
    readonly openFile: (uri: string) => Promise<void>;
}

declare global
{
    interface Window
    {
        playground?: WindowApi;
    }
}

export interface HostPage
{
    readonly page: Page;
    readonly url: string;
    readonly frameOrigin: string;
    /** 모델 자리에 앉힐 대본. 다시 부르면 갈아 끼운다 */
    readonly script: (lines: ReadonlyArray<ScriptLine> | Model) => void;
    /** 지금까지 모델이 받은 차례 */
    readonly turns: ReadonlyArray<Turn>;
    /** 화면 · 호스트 · 서버 사이에 오간 말 전부. 개발 도구의 「오간 말」과 같다 */
    readonly log: () => Promise<ReadonlyArray<LogEntry>>;
    /** 화면이 호스트에게 보낸 그 이름의 요청 · 알림의 params */
    readonly sent: (method: string) => Promise<ReadonlyArray<Json>>;
    /** 컴포저에 적어 보낸다 */
    readonly say: (text: string) => Promise<void>;
    /** 호스트가 쥔 파일을 더한다. 돌려준 uri 로 연다 */
    readonly addFile: (name: string, bytes: Uint8Array, mimeType?: string) => Promise<string>;
    /** 밖에서 파일이 바뀐 것처럼 바이트를 갈고 구독한 화면에 알린다 */
    readonly touchFile: (uri: string, bytes: Uint8Array) => Promise<void>;
    readonly fileBytes: (uri: string) => Promise<Buffer | null>;
    readonly files: () => Promise<ReadonlyArray<{ readonly uri: string; readonly name: string; readonly etag: string }>>;
    /** 파일 진입점으로 연다(데스크톱) */
    readonly openFile: (uri: string) => Promise<void>;
    /** 그 도구가 띄운 화면. 여럿이면 마지막 것 */
    readonly widget: (title: string) => FrameLocator;
}

export interface StartedHost extends HostPage
{
    readonly close: () => Promise<void>;
}

const quiet: Model = scriptedModel([]);

export const openPlayground = async (page: Page, options: PlaygroundOptions): Promise<StartedHost> =>
{
    const playground = await createPlayground({ quiet: true, ...options, port: options.port ?? 0 });
    const turns: Array<Turn> = [];
    let model = quiet;

    await page.exposeFunction("__playgroundModel", async (turn: Turn): Promise<ReadonlyArray<Action>> =>
    {
        turns.push(turn);

        return await model.respond(turn);
    });

    const search = options.platform === undefined ? "" : `?platform=${options.platform}`;

    await page.goto(`${playground.url}/${search}`);
    await page.waitForFunction(() => window.playground !== undefined);

    return {
        page,
        url: playground.url,
        frameOrigin: playground.frameOrigin,
        turns,
        script: (lines) =>
        {
            model = "respond" in lines ? lines : scriptedModel(lines);
        },
        log: async () => await page.evaluate(() => JSON.parse(JSON.stringify(window.playground?.log ?? [])) as ReadonlyArray<LogEntry>),
        sent: async (method) => await page.evaluate((name) => window.playground?.sent(name) ?? [], method) as ReadonlyArray<Json>,
        say: async (text) =>
        {
            const box = page.getByRole("textbox", { name: "보낼 글" }).last();

            await box.fill(text);
            await box.press("Enter");
        },
        addFile: async (name, bytes, mimeType) =>
            await page.evaluate(([fileName, base64, type]) => window.playground?.addFile(fileName, base64, type) ?? "", [name, Buffer.from(bytes).toString("base64"), mimeType ?? "application/octet-stream"] as const),
        touchFile: async (uri, bytes) => await page.evaluate(([target, base64]) => window.playground?.touchFile(target, base64), [uri, Buffer.from(bytes).toString("base64")] as const),
        fileBytes: async (uri) =>
        {
            const base64 = await page.evaluate((target) => window.playground?.fileBase64(target) ?? null, uri);

            return base64 === null ? null : Buffer.from(base64, "base64");
        },
        files: async () => await page.evaluate(() => window.playground?.files() ?? []),
        openFile: async (uri) => await page.evaluate(async (target) => await window.playground?.openFile(target), uri),
        widget: (title) => page.frameLocator(`iframe[title="${title}"] >> nth=-1`),
        close: playground.close,
    };
};

/** `test.use({ playground: { … } })` 로 서버를 정하고 `host` 를 받는다 */
export const test = base.extend<{ playground: PlaygroundOptions; host: HostPage }>({
    playground: [{ server: "" }, { option: true }],
    host: async ({ page, playground }, use) =>
    {
        const started = await openPlayground(page, playground);

        await use(started);
        await started.close();
    },
});

export { expect } from "@playwright/test";
export type { Action, LogEntry, ScriptLine, Turn } from "@host-playground/core";
