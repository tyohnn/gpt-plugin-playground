import { describe, expect, it } from "vitest";

import { ruleModel, scriptedModel, type Turn } from "./model";

const tools = [{ name: "open_library" }, { name: "fill_form" }, { name: "pick_note" }];

const turn = (text: string, contexts: Turn["contexts"] = []): Turn => ({ text, mentions: [], contexts, tools });

describe("모델 자리", () =>
{
    it("대본 모델은 위에서부터 처음 맞는 줄을 따른다", async () =>
    {
        const model = scriptedModel([
            { when: /골라/, then: [{ kind: "call", tool: "pick_note", arguments: {} }] },
            { when: /쪽지/, then: [{ kind: "call", tool: "open_library", arguments: {} }] },
        ]);

        expect(await model.respond(turn("쪽지 하나 골라 줘"))).toEqual([{ kind: "call", tool: "pick_note", arguments: {} }]);
    });

    it("대본 모델은 화면이 붙인 컨텍스트를 읽어 도구의 인자를 지을 수 있다", async () =>
    {
        const model = scriptedModel([{
            when: /채워/,
            then: (given) =>
            {
                const fields = JSON.parse(String(given.contexts[0]?.["structuredContent"] ? JSON.stringify(given.contexts[0]["structuredContent"]) : "{}")) as { session: string };

                return [{ kind: "call", tool: "fill_form", arguments: { session: fields.session, values: [{ key: "1", value: "홍길동" }] } }];
            },
        }]);
        const actions = await model.respond(turn("이름 칸 채워 줘", [{ content: [], structuredContent: { session: "abc" } }]));

        expect(actions).toEqual([{ kind: "call", tool: "fill_form", arguments: { session: "abc", values: [{ key: "1", value: "홍길동" }] } }]);
    });

    it("대본에 없는 말에는 도구를 부르지 않고 그렇다고 말한다", async () =>
    {
        const actions = await scriptedModel([]).respond(turn("안녕"));

        expect(actions).toHaveLength(1);
        expect(actions[0]?.kind).toBe("say");
    });

    it("모델은 목록에 없는 도구를 부르지 못한다. 화면 전용 도구도 목록에 없다", async () =>
    {
        const model = scriptedModel([{ when: /가져/, then: [{ kind: "call", tool: "take_fill", arguments: {} }] }]);
        const actions = await model.respond(turn("값 가져와"));

        expect(actions[0]).toEqual({ kind: "say", text: expect.stringContaining("take_fill") });
    });

    it("규칙 모델은 낱말로 도구를 고른다", async () =>
    {
        const model = ruleModel([[/서랍/, "pick_note"], [/쪽지/, "open_library"]]);

        expect(await model.respond(turn("쪽지 보여 줘"))).toEqual([{ kind: "call", tool: "open_library", arguments: {} }]);
    });
});
