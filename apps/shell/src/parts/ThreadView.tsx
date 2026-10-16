import { Alert, AlertDescription, AlertTitle } from "@host-playground/ui/components/alert";
import { Button } from "@host-playground/ui/components/button";
import { Card } from "@host-playground/ui/components/card";
import { ChatPrompt } from "@host-playground/ui/blocks/chat-prompt";
import { ChatReply } from "@host-playground/ui/blocks/chat-reply";
import { Bot, TriangleAlert } from "@host-playground/ui/icons";
import { ruleOf } from "@host-playground/core";

import { usePlayground } from "../lib/context";
import type { Block, Thread } from "../lib/store";
import { Composer } from "./Composer";
import { FormCard } from "./FormCard";
import { WidgetFrame } from "./WidgetFrame";

/** 대화 안에 선 화면. 화면이 「크게 보기」를 청하면 대화 위를 덮는다 */
const InlineWidget = ({ session }: { session: string }) =>
{
    const playground = usePlayground();
    const opened = playground.host.session(session);

    if (opened === undefined)
    {
        return null;
    }

    const full = opened.mode === "fullscreen";

    return (
        <Card data-mode={opened.mode} className={full ? "fixed inset-4 z-40 flex flex-col overflow-hidden p-0" : "overflow-hidden p-0"}>
            <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                <strong>{opened.tool.title ?? opened.tool.name}</strong>
                <span className="ml-auto" />
                {full && <Button variant="ghost" size="sm" onClick={() => playground.setMode(session, "inline")}>대화로 돌아가기</Button>}
            </div>
            <WidgetFrame session={session} fit={!full} className={full ? "h-full flex-1" : "h-80"} />
        </Card>
    );
};

const Refused = ({ rule, reason }: { rule: string; reason: string }) => (
    <Alert variant="destructive" data-rule={rule}>
        <TriangleAlert />
        <AlertTitle>실물 호스트라면 이 화면을 띄우지 않아요</AlertTitle>
        <AlertDescription>
            {reason}
            <span className="mt-1 block text-xs">규칙 {rule} · 근거 {ruleOf(rule)?.basis ?? "?"}</span>
        </AlertDescription>
    </Alert>
);

const BlockView = ({ thread, block }: { thread: Thread; block: Block }) =>
{
    const playground = usePlayground();

    switch (block.kind)
    {
        case "user":
            return (
                <ChatPrompt avatar="나" meta={block.attached.length > 0 ? `붙인 것: ${block.attached.join(", ")}` : undefined}>
                    {block.text}
                </ChatPrompt>
            );

        case "assistant":
            return (
                <ChatReply avatar={<Bot />} name="ChatGPT">
                    <p className={block.error === true ? "text-destructive" : undefined} data-error={block.error === true}>{block.text}</p>
                    {block.details !== undefined && (
                        <details>
                            <summary>{block.details.summary}</summary>
                            <pre className="whitespace-pre-wrap text-xs">{block.details.body}</pre>
                        </details>
                    )}
                </ChatReply>
            );

        case "note":
            return <p className="text-xs text-muted-foreground" data-kind="note">{block.text}</p>;

        case "widget":
            return <InlineWidget session={block.session} />;

        case "form":
            return <FormCard thread={thread.id} form={block} />;

        case "refused":
            return <Refused rule={block.rule} reason={block.reason} />;

        default:
            return playground.busy > 0 ? null : null;
    }
};

export const ThreadView = ({ thread }: { thread: Thread }) =>
{
    const playground = usePlayground();
    const starters = [...(playground.config.plugin?.defaultPrompt ?? []), ...playground.globalTools().map((tool) => `${tool.title ?? tool.name} 열어 줘`)].slice(0, 4);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="messages">
                    {thread.blocks.length === 0 && (
                        <div className="flex flex-col items-center gap-4 py-24 text-center">
                            <h1 className="text-2xl font-medium">무엇을 도와드릴까요?</h1>
                            <div className="flex flex-wrap justify-center gap-2">
                                {starters.map((prompt) => <Button key={prompt} variant="outline" size="sm" onClick={() => void playground.send(prompt, [])}>{prompt}</Button>)}
                            </div>
                        </div>
                    )}
                    {thread.blocks.map((block, index) => <BlockView key={index} thread={thread} block={block} />)}
                    {playground.busy > 0 && <ChatReply loading lines={1} />}
                </div>
            </div>
            <div className="mx-auto w-full max-w-3xl px-4 pb-4">
                <Composer />
            </div>
        </div>
    );
};
