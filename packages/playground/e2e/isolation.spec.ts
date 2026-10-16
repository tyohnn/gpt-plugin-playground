import type { Frame, Page } from "@playwright/test";

import { expect, test } from "../src/playwright";
import { fixture } from "./fixture";

test.use({ playground: fixture() });

/** 화면 origin 에서 뜬 iframe 의 문서. 여럿이면 마지막 것 */
const widgetFrame = async (page: Page, origin: string): Promise<Frame> =>
{
    await expect.poll(() => page.frames().filter((frame) => frame.url().startsWith(origin)).length).toBeGreaterThan(0);

    return page.frames().filter((frame) => frame.url().startsWith(origin)).at(-1) as Frame;
};

/** 화면 안에서 주소 하나를 불러 본다. CSP 가 막으면 위반 사건이 남는다 */
const reach = async (frame: Frame, url: string): Promise<{ readonly blocked: boolean }> =>
    await frame.evaluate(async (target) =>
    {
        let blocked = false;

        document.addEventListener("securitypolicyviolation", (event) =>
        {
            if (event.blockedURI.startsWith(new URL(target).origin))
            {
                blocked = true;
            }
        });

        await fetch(target, { mode: "no-cors" }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 100));

        return { blocked };
    }, url);

test("화면은 호스트와 다른 origin 에서 뜨고 부모의 DOM 에 닿지 못한다", async ({ host, page }) =>
{
    await page.getByRole("button", { name: "게시판" }).first().click();

    const widget = host.widget("게시판");
    const frame = await widgetFrame(page, host.frameOrigin);

    expect(new URL(frame.url()).origin).not.toBe(new URL(host.url).origin);
    await widget.getByRole("button", { name: "창에 닿아 보기" }).click();
    await expect(widget.getByText("창에 닿지 못했어요")).toBeVisible();
});

test("화면이 csp.connectDomains 밖의 주소를 부르면 막힌다", async ({ host, page }) =>
{
    await page.getByRole("button", { name: "게시판" }).first().click();

    const widget = host.widget("게시판");
    const frame = await widgetFrame(page, host.frameOrigin);

    await widget.getByRole("button", { name: "밖으로 부르기" }).click();
    await expect(widget.getByText("밖으로 나가지 못했어요")).toBeVisible();
    expect(await reach(frame, "https://example.com/")).toEqual({ blocked: true });
    // 목록에 든 곳은 CSP 가 막지 않는다. 닿았는지는 망에 달렸으므로 위반이 없는 것만 잰다
    expect(await reach(frame, "https://cdn.jsdelivr.net/npm/")).toEqual({ blocked: false });
});

test("connectDomains 가 비어 있는 화면은 밖의 주소를 하나도 부르지 못한다", async ({ host, page }) =>
{
    await host.openFile("host-resource://file-1");
    await expect(host.widget("문서 열기").getByRole("textbox", { name: "이름" })).toBeVisible();

    const frame = await widgetFrame(page, host.frameOrigin);

    expect(await reach(frame, "https://cdn.jsdelivr.net/npm/")).toEqual({ blocked: true });
    expect(await reach(frame, "https://example.com/")).toEqual({ blocked: true });
});
