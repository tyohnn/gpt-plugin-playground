import type { Json } from "./protocol";
import type { Tool } from "./tools";

/**
 * 모델이 서는 자리. 실물 호스트에서는 모델이 도구의 설명과 스킬을 읽고 도구를 고른다.
 * 여기에는 세 방식이 선다.
 *
 * | 방식 | 쓰는 곳 |
 * |---|---|
 * | 대본(`scriptedModel`) | e2e. 시나리오가 「이 말에는 이 도구를 이 인자로」를 적는다. 늘 같다 |
 * | 규칙(`ruleModel`) | 눈으로 볼 때. 낱말로 도구를 고른다 |
 * | 실물 모델 | 손으로 돌리는 확인. 아직 없다 |
 *
 * ⚠ 모델이 볼 수 있는 도구만 `turn.tools` 에 든다. 화면 전용 도구는 호스트가 미리 걸렀다(`app-only-tools`).
 */
export interface Turn
{
    readonly text: string;
    readonly mentions: ReadonlyArray<{ readonly uri: string; readonly title: string }>;
    /** 화면들이 `ui/update-model-context` 로 붙여 둔 것 */
    readonly contexts: ReadonlyArray<Json>;
    readonly tools: ReadonlyArray<Pick<Tool, "name">>;
    /** 온보딩처럼 호스트가 스킬을 모델에게 건넨 차례면 그 스킬 */
    readonly skill?: { readonly name: string; readonly body: string };
}

export type Action =
    | { readonly kind: "call"; readonly tool: string; readonly arguments: Json }
    | { readonly kind: "say"; readonly text: string };

export interface Model
{
    readonly name: string;
    readonly respond: (turn: Turn) => Promise<ReadonlyArray<Action>>;
}

export interface ScriptLine
{
    readonly when: RegExp | ((turn: Turn) => boolean);
    readonly then: ReadonlyArray<Action> | ((turn: Turn) => ReadonlyArray<Action>);
}

const matches = (line: ScriptLine, turn: Turn): boolean =>
    typeof line.when === "function" ? line.when(turn) : line.when.test(turn.text);

/** 목록에 없는 도구를 부르려 하면 부르지 않고 말로 바꾼다 */
const guard = (turn: Turn, actions: ReadonlyArray<Action>): ReadonlyArray<Action> =>
    actions.map((action) =>
        action.kind === "call" && !turn.tools.some((tool) => tool.name === action.tool)
            ? { kind: "say", text: `모델은 ${action.tool} 를 부를 수 없어요. 모델에게 보이는 도구가 아니에요.` }
            : action);

export const scriptedModel = (lines: ReadonlyArray<ScriptLine>, name = "대본"): Model => ({
    name,
    respond: async (turn) =>
    {
        const line = lines.find((each) => matches(each, turn));

        if (line === undefined)
        {
            return [{ kind: "say", text: "대본에 없는 말이에요. 시나리오에 줄을 더하면 그 도구를 불러요." }];
        }

        return guard(turn, typeof line.then === "function" ? line.then(turn) : line.then);
    },
});

export const ruleModel = (routes: ReadonlyArray<readonly [RegExp, string]>): Model =>
    scriptedModel(routes.map(([pattern, tool]) => ({ when: pattern, then: [{ kind: "call", tool, arguments: {} }] })), "규칙");

/** 화면들이 붙인 컨텍스트의 글. 대본이 칸 목록 같은 것을 읽을 때 쓴다 */
export const contextText = (turn: Turn): string =>
    turn.contexts
        .flatMap((context) => (Array.isArray(context["content"]) ? context["content"] : []))
        .flatMap((block) => (typeof block === "object" && block !== null && typeof (block as Json)["text"] === "string" ? [String((block as Json)["text"])] : []))
        .join("\n");
