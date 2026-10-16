import { expect, test } from "../src/playwright";
import { isRecord, type Turn } from "@host-playground/core";

import { fixture, fixtureServer } from "./fixture";

const FILE = "host-resource://file-1";

/** 문서 화면이 모델 컨텍스트에 붙인 세션 */
const sessionOf = (turn: Turn): string =>
{
    const found = turn.contexts.map((context) => context["structuredContent"]).find((content) => isRecord(content) && typeof content["session"] === "string");

    return isRecord(found) ? String(found["session"]) : "";
};

test.describe("데스크톱", () =>
{
    test.use({ playground: fixture() });

    test("화면이 initialized 를 알리기 전에는 tool-input 과 tool-result 를 보내지 않는다", async ({ host, page }) =>
    {
        await page.getByRole("button", { name: "게시판" }).first().click();
        await expect(host.widget("게시판").getByRole("button", { name: "첫 글" })).toBeVisible();

        const methods = (await host.log()).filter((entry) => entry.direction !== "호스트→서버" && entry.direction !== "서버→호스트").map((entry) => entry.method);
        const initialized = methods.indexOf("ui/notifications/initialized");

        expect(initialized).toBeGreaterThan(methods.indexOf("ui/initialize"));
        expect(methods.indexOf("ui/notifications/tool-input")).toBeGreaterThan(initialized);
        expect(methods.indexOf("ui/notifications/tool-result")).toBeGreaterThan(initialized);
        expect(methods.filter((method) => method === "ui/notifications/tool-result")).toHaveLength(1);
    });

    test("visibility 가 app 인 도구는 모델의 목록에 서지 않고 화면만 부를 수 있다", async ({ host }) =>
    {
        host.script([{ when: /인사/, then: [{ kind: "say", text: "네" }] }]);
        await host.say("인사해 줘");
        await expect.poll(() => host.turns.length).toBe(1);

        const names = host.turns[0]?.tools.map((tool) => tool.name) ?? [];

        expect(names).toContain("fill_doc");
        expect(names).not.toContain("take_fill");
    });

    test("파일 진입점으로 연 화면은 호스트에게서 바이트로 읽어 칸을 그린다", async ({ host }) =>
    {
        await host.openFile(FILE);

        const widget = host.widget("문서 열기");

        await expect(widget.getByRole("textbox", { name: "이름" })).toBeVisible();
        await expect(widget.getByRole("textbox", { name: "연락처" })).toBeVisible();

        const reads = await host.sent("resources/read");
        const read = reads.find((params) => params["uri"] === FILE);

        expect(read?.["_meta"]).toEqual({ "openai/resource": { representation: "blob" } });

        const input = await host.sent("ui/notifications/tool-input");

        expect(input).toEqual([]);
    });

    test("화면이 칸 목록을 모델 컨텍스트로 알리면 대본 모델이 fill_doc 을 부르고, 화면이 take_fill 로 가져가 칸을 채운다", async ({ host }) =>
    {
        await host.openFile(FILE);

        const widget = host.widget("문서 열기");

        await expect(widget.getByRole("textbox", { name: "이름" })).toBeVisible();
        await expect.poll(async () => (await host.sent("ui/update-model-context")).length).toBeGreaterThan(0);
        host.script([{
            when: /채워/,
            then: (turn) => [{ kind: "call", tool: "fill_doc", arguments: { session: sessionOf(turn), values: [{ key: "이름", value: "홍길동" }, { key: "주소", value: "서울" }] } }],
        }]);
        await host.say("이름은 홍길동, 주소는 서울로 채워 줘");

        await expect(widget.getByRole("textbox", { name: "이름" })).toHaveValue("홍길동");
        await expect(widget.getByRole("textbox", { name: "주소" })).toHaveValue("서울");
        expect(sessionOf(host.turns[0] as Turn)).toMatch(/^doc-/);
    });

    test("저장하면 바이트로 덮어쓰고, 그사이 밖에서 바뀌었으면 덮어쓰지 않는다", async ({ host }) =>
    {
        await host.openFile(FILE);

        const widget = host.widget("문서 열기");
        const name = widget.getByRole("textbox", { name: "이름" });

        await name.fill("홍길동");
        await widget.getByRole("button", { name: "저장하기" }).click();
        await expect(widget.getByText("저장했어요.")).toBeVisible();
        expect((await host.fileBytes(FILE))?.toString("utf8")).toContain("이름: 홍길동");

        const writes = await host.sent("openai/resources/write");

        expect(writes[0]?.["ifMatch"]).toBe("v1");
        expect(typeof writes[0]?.["blob"]).toBe("string");

        await host.touchFile(FILE, new TextEncoder().encode("이름: 김철수\n주소: \n연락처: \n"));
        await expect(widget.getByText("밖에서 파일이 바뀌었어요.")).toBeVisible();
        await name.fill("이영희");
        await widget.getByRole("button", { name: "저장하기" }).click();
        await expect(widget.getByText("그사이 파일이 바뀌어 저장하지 않았어요.")).toBeVisible();
        expect((await host.fileBytes(FILE))?.toString("utf8")).toContain("이름: 김철수");

        await widget.getByRole("button", { name: "다시 불러오기" }).click();
        await expect(name).toHaveValue("김철수");
    });
});

test.describe("자원 읽기의 새 판 칸", () =>
{
    test.use({ playground: fixture({ server: fixtureServer("/mcp-no-cache") }) });

    test("화면 자원의 resources/read 답에 ttlMs 나 cacheScope 가 없으면 화면을 띄우지 않고 까닭을 적는다", async ({ host, page }) =>
    {
        await page.getByRole("button", { name: "게시판" }).first().click();

        await expect(page.locator("[data-rule='resource-cache-fields']")).toBeVisible();
        await expect(page.locator(`iframe[src^="${host.frameOrigin}"]`)).toHaveCount(0);
    });
});

test.describe("웹", () =>
{
    test.use({ playground: fixture({ platform: "web" }) });

    test("데스크톱이 아니면 파일 진입점으로 열지 않고 파일 능력을 알리지 않는다", async ({ host, page }) =>
    {
        await page.getByRole("button", { name: "게시판" }).first().click();

        const widget = host.widget("게시판");

        await expect(widget.getByText("플랫폼: web")).toBeVisible();
        await host.openFile(FILE);
        await expect(page.locator("iframe[title='문서 열기']")).toHaveCount(0);

        const answers = (await host.log()).filter((entry) => entry.direction === "호스트→화면" && entry.method === "(답)").map((entry) => entry.payload);
        const init = answers.find((payload) => isRecord(payload) && isRecord(payload["result"]) && "hostCapabilities" in payload["result"]);

        expect(JSON.stringify(init)).not.toContain("openai/files");
    });
});
