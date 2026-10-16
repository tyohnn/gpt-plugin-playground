import { useRef, useState, type KeyboardEvent } from "react";

import { Badge } from "@host-playground/ui/components/badge";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@host-playground/ui/components/input-group";
import { ArrowUp, AtSign, X } from "@host-playground/ui/icons";
import { isRecord } from "@host-playground/core";

import { usePlayground } from "../lib/context";
import { contextTitles, type Mention } from "../lib/store";

/**
 * 글 쓰는 칸. 화면이 붙인 컨텍스트가 첨부로 서고, `@` 를 치면 플러그인의 멘션 검색이 뜬다(데스크톱).
 */
export const Composer = ({ placeholder = "무엇이든 물어보세요" }: { placeholder?: string }) =>
{
    const playground = usePlayground();
    const [text, setText] = useState("");
    const [mentions, setMentions] = useState<ReadonlyArray<Mention>>([]);
    const [found, setFound] = useState<ReadonlyArray<Mention> | null>(null);
    const searching = useRef(0);
    const mentionTool = playground.mentionTool();
    const attached = playground.scope().filter((session) => session.context !== null && contextTitles(session.context).length > 0);

    const search = async (value: string, caret: number): Promise<void> =>
    {
        const match = /@([^\s@]*)$/.exec(value.slice(0, caret));

        if (match === null || mentionTool === undefined)
        {
            setFound(null);

            return;
        }

        searching.current += 1;

        const turn = searching.current;
        const result = await playground.host.callTool(mentionTool.name, { query: match[1] ?? "" });
        const items = isRecord(result["structuredContent"]) && Array.isArray(result["structuredContent"]["items"]) ? result["structuredContent"]["items"].filter(isRecord) : [];

        if (turn === searching.current)
        {
            setFound(items.map((item) => ({ uri: String(item["uri"]), title: String(item["title"] ?? item["name"] ?? item["uri"]) })));
        }
    };

    const submit = (): void =>
    {
        const message = text.trim();

        if (message === "" && mentions.length === 0)
        {
            return;
        }

        setText("");
        setMentions([]);
        setFound(null);
        void playground.send(message, mentions);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void =>
    {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)
        {
            event.preventDefault();
            submit();
        }
        else if (event.key === "Escape")
        {
            setFound(null);
        }
    };

    return (
        <div className="relative">
            {found !== null && (
                <div role="listbox" aria-label="멘션" className="absolute bottom-full mb-2 w-full rounded-xl border bg-popover p-1 shadow-lg">
                    <p className="px-2 py-1 text-xs text-muted-foreground">{playground.pluginName()} · {found.length === 0 ? "찾은 것이 없어요" : "검색어를 이어서 적어요"}</p>
                    {found.map((item) => (
                        <button
                            key={item.uri}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() =>
                            {
                                setText((current) => current.replace(/@([^\s@]*)$/, ""));
                                setMentions((current) => [...current, item]);
                                setFound(null);
                            }}
                        >
                            {item.title}
                        </button>
                    ))}
                </div>
            )}
            <InputGroup>
                {(mentions.length > 0 || attached.length > 0) && (
                    <InputGroupAddon align="block-start" className="flex flex-wrap gap-1.5">
                        {mentions.map((mention) => (
                            <Badge key={mention.uri} variant="secondary">
                                @{mention.title}
                                <button type="button" aria-label="멘션 떼기" onClick={() => setMentions((current) => current.filter((each) => each !== mention))}><X /></button>
                            </Badge>
                        ))}
                        {attached.map((session) => (
                            <Badge key={session.id} variant="secondary" data-testid="context-chip">
                                {contextTitles(session.context ?? {}).join(", ")}
                                <button type="button" aria-label="첨부 떼기" onClick={() => playground.detach(session.id)}><X /></button>
                            </Badge>
                        ))}
                    </InputGroupAddon>
                )}
                <InputGroupTextarea
                    aria-label="보낼 글"
                    rows={1}
                    placeholder={placeholder}
                    value={text}
                    onChange={(event) =>
                    {
                        setText(event.target.value);
                        void search(event.target.value, event.target.selectionStart);
                    }}
                    onKeyDown={onKeyDown}
                />
                <InputGroupAddon align="block-end">
                    {mentionTool !== undefined && <InputGroupText><AtSign /> 로 찾기</InputGroupText>}
                    <InputGroupText className="ml-auto text-xs">모델: {playground.modelName()}</InputGroupText>
                    <InputGroupButton variant="default" size="icon-sm" aria-label="보내기" onClick={submit}><ArrowUp /></InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
        </div>
    );
};
