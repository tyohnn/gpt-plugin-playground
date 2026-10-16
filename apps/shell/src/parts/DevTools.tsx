import { useRef, useState } from "react";

import { Badge } from "@host-playground/ui/components/badge";
import { Button } from "@host-playground/ui/components/button";
import { Input } from "@host-playground/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@host-playground/ui/components/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@host-playground/ui/components/sheet";
import { Switch } from "@host-playground/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@host-playground/ui/components/tabs";
import { bytesOf, fileToolFor, guessCount, RULES, textOf } from "@host-playground/core";

import { usePlayground } from "../lib/context";

/**
 * 개발 도구. 진짜 호스트에는 없는 자리다. 오간 말과, 이 호스트가 지키는 규칙의 근거와, 호스트가 쥔 파일과, 호스트의 설정을 본다.
 */
const Log = () =>
{
    const playground = usePlayground();
    const [filter, setFilter] = useState("");
    const entries = playground.log.filter((entry) => filter === "" || `${entry.direction} ${entry.method}`.includes(filter)).slice(-300).reverse();

    return (
        <div className="flex min-h-0 flex-col gap-2">
            <Input aria-label="오간 말 거르기" placeholder="메서드나 방향으로 걸러요" value={filter} onChange={(event) => setFilter(event.target.value)} />
            <div className="flex flex-col gap-1 overflow-y-auto font-mono text-xs" data-testid="log">
                {entries.map((entry, index) => (
                    <details key={`${playground.log.length - index}`} className="rounded-md border px-2 py-1">
                        <summary><span className="text-muted-foreground">{entry.direction}</span> {entry.method}{entry.session === null ? "" : ` · ${entry.session}`}</summary>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(entry.payload, null, 2).slice(0, 4000)}</pre>
                    </details>
                ))}
            </div>
        </div>
    );
};

const Rules = () => (
    <div className="flex flex-col gap-2 overflow-y-auto text-sm">
        <p className="text-muted-foreground">추측 {guessCount()}줄 · 전체 {RULES.length}줄. 실물의 녹취로 추측을 줄여 가요.</p>
        {RULES.map((rule) => (
            <div key={rule.id} className="rounded-md border px-2 py-1.5" data-rule={rule.id} data-basis={rule.basis}>
                <div className="flex items-center gap-2">
                    <Badge variant={rule.basis === "추측" ? "destructive" : rule.basis === "녹취" ? "default" : "secondary"}>{rule.basis}</Badge>
                    <code className="text-xs">{rule.id}</code>
                </div>
                <p>{rule.summary}</p>
                <p className="text-xs break-all text-muted-foreground">{rule.source}</p>
            </div>
        ))}
    </div>
);

const Files = () =>
{
    const playground = usePlayground();
    const input = useRef<HTMLInputElement>(null);
    const desktop = playground.host.platform() === "desktop";

    return (
        <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">호스트가 쥔 사람의 파일이에요. 화면은 주소만 알고 읽고 쓰기는 호스트가 해요.{desktop ? "" : " 파일 진입점은 데스크톱에서만 열려요."}</p>
            {playground.files.list().map((file) =>
            {
                const tool = fileToolFor(playground.tools, file.name, playground.host.platform());

                return (
                    <div key={file.uri} className="flex items-center gap-2 rounded-md border px-2 py-1.5" data-file={file.uri}>
                        <span className="flex-1 truncate">{file.name} <span className="text-xs text-muted-foreground">{file.bytes.length}B · {file.etag}</span></span>
                        <Button size="sm" variant="outline" disabled={tool === undefined} onClick={() => void playground.openFile(file.uri)}>
                            {tool === undefined ? "열 화면 없음" : `${tool.title ?? tool.name}(으)로 열기`}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() =>
                        {
                            // 글 파일이면 줄을 더하고, 아니면 바이트를 그대로 둔 채 판만 올린다
                            const text = file.mimeType.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".fixdoc");

                            playground.files.touch(file.uri, text ? bytesOf(`${textOf(file.bytes)}밖에서 더한 줄: \n`) : file.bytes);
                        }}>밖에서 바꾸기</Button>
                    </div>
                );
            })}
            <input ref={input} type="file" hidden onChange={async (event) =>
            {
                for (const file of [...(event.target.files ?? [])])
                {
                    playground.addFile(file.name, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream");
                }
            }} />
            <Button variant="outline" onClick={() => input.current?.click()}>파일 더하기</Button>
        </div>
    );
};

const HostSettings = () =>
{
    const playground = usePlayground();
    const [link, setLink] = useState("/");

    return (
        <div className="flex flex-col gap-4 text-sm">
            <label className="flex items-center justify-between gap-4">
                플랫폼
                <NativeSelect aria-label="플랫폼" value={playground.host.platform()} onChange={(event) =>
                {
                    // 능력은 악수할 때 알린다. 창을 새로 띄워 화면들이 새 능력으로 악수하게 한다
                    const url = new URL(location.href);

                    url.searchParams.set("platform", event.target.value);
                    location.href = url.toString();
                }}>
                    <NativeSelectOption value="desktop">데스크톱 앱</NativeSelectOption>
                    <NativeSelectOption value="web">웹</NativeSelectOption>
                    <NativeSelectOption value="mobile">모바일</NativeSelectOption>
                </NativeSelect>
            </label>
            <label className="flex items-center justify-between gap-4">
                어두운 테마
                <Switch aria-label="어두운 테마" checked={playground.theme === "dark"} onCheckedChange={(checked) => playground.setTheme(checked ? "dark" : "light")} />
            </label>
            <div className="flex flex-col gap-1">
                딥링크
                <div className="flex gap-2">
                    <Input aria-label="딥링크의 길" value={link} onChange={(event) => setLink(event.target.value)} />
                    <Button variant="outline" onClick={() => playground.deepLink(link)}>보내기</Button>
                </div>
            </div>
            <p className="text-muted-foreground">서버 {playground.config.server} · {playground.config.modern ? "새 판(2026-07-28)" : "옛 판"} · 화면 {playground.config.frameOrigin}</p>
        </div>
    );
};

export const DevTools = () =>
{
    const playground = usePlayground();

    return (
        <Sheet open={playground.devtools} onOpenChange={(open) =>
        {
            playground.devtools = open;
            playground.changed();
        }}>
            <SheetContent side="right" className="w-[min(560px,100vw)] sm:max-w-none">
                <SheetHeader>
                    <SheetTitle>개발 도구</SheetTitle>
                    <SheetDescription>진짜 호스트에는 없는 자리예요. 서버 · DB · 화면은 진짜이고 호스트만 흉내예요.</SheetDescription>
                </SheetHeader>
                <Tabs defaultValue="log" className="min-h-0 flex-1 px-4 pb-4">
                    <TabsList>
                        <TabsTrigger value="log">오간 말</TabsTrigger>
                        <TabsTrigger value="rules">규칙</TabsTrigger>
                        <TabsTrigger value="files">파일</TabsTrigger>
                        <TabsTrigger value="host">호스트</TabsTrigger>
                    </TabsList>
                    <TabsContent value="log" className="min-h-0 overflow-hidden"><Log /></TabsContent>
                    <TabsContent value="rules" className="min-h-0 overflow-y-auto"><Rules /></TabsContent>
                    <TabsContent value="files"><Files /></TabsContent>
                    <TabsContent value="host"><HostSettings /></TabsContent>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
};
