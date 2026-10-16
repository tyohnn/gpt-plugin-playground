import { Button } from "@host-playground/ui/components/button";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from "@host-playground/ui/components/sidebar";
import { Blocks, MessageSquare, Pencil, Terminal, Zap } from "@host-playground/ui/icons";
import { entrypointsOf, type Tool } from "@host-playground/core";

import { usePlayground } from "./lib/context";
import { AppView } from "./parts/AppView";
import { DevTools } from "./parts/DevTools";
import { PluginView } from "./parts/PluginView";
import { SidePanel } from "./parts/SidePanel";
import { ThreadView } from "./parts/ThreadView";

/** 앱의 작은 그림. 도구의 아이콘이 없으면 플러그인의 아이콘을 쓴다 */
const ToolIcon = ({ tool }: { tool: Tool }) =>
{
    const playground = usePlayground();
    const src = playground.iconOf(tool);

    return src === null ? <Blocks /> : <img src={src} alt="" className="size-4 rounded-sm" />;
};

const AppSidebar = () =>
{
    const playground = usePlayground();
    const view = playground.view;
    const apps = playground.globalTools();

    return (
        <Sidebar variant="inset" aria-label="사이드바">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton onClick={() => playground.show({ kind: "chat", thread: playground.newThread().id })}>
                            <Pencil />
                            <span>새 채팅</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                {apps.length > 0 && (
                    <SidebarGroup>
                        <SidebarGroupLabel>앱</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {apps.map((tool) =>
                                {
                                    const quick = entrypointsOf(tool).find((entry) => entry.type === "global")?.quickAction;

                                    return (
                                        <SidebarMenuItem key={tool.name}>
                                            <SidebarMenuButton
                                                isActive={view.kind === "app" && view.tool === tool.name}
                                                onClick={() => void playground.openGlobal(tool.name)}
                                            >
                                                <ToolIcon tool={tool} />
                                                <span>{tool.title ?? tool.name}</span>
                                            </SidebarMenuButton>
                                            {quick !== undefined && (
                                                <SidebarMenuAction showOnHover aria-label={quick.title} title={quick.title} onClick={() => void playground.quickAction(tool)}>
                                                    <Zap />
                                                </SidebarMenuAction>
                                            )}
                                        </SidebarMenuItem>
                                    );
                                })}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}
                {playground.config.plugin !== null && (
                    <SidebarGroup>
                        <SidebarGroupLabel>플러그인</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton isActive={view.kind === "plugin"} onClick={() => playground.show({ kind: "plugin" })}>
                                        <Blocks />
                                        <span>{playground.pluginName()}</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}
                <SidebarGroup>
                    <SidebarGroupLabel>채팅</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu aria-label="채팅 목록">
                            {playground.threads.map((thread) => (
                                <SidebarMenuItem key={thread.id}>
                                    <SidebarMenuButton
                                        isActive={view.kind === "chat" && view.thread === thread.id}
                                        onClick={() => playground.show({ kind: "chat", thread: thread.id })}
                                    >
                                        <MessageSquare />
                                        <span>{thread.title}</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton isActive={playground.devtools} onClick={() =>
                        {
                            playground.devtools = !playground.devtools;
                            playground.changed();
                        }}>
                            <Terminal />
                            <span>개발 도구</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
};

const Main = () =>
{
    const playground = usePlayground();
    const view = playground.view;
    const thread = playground.currentThread();

    if (view.kind === "app")
    {
        return <AppView tool={view.tool} />;
    }

    if (view.kind === "plugin")
    {
        return <PluginView />;
    }

    if (thread === undefined)
    {
        return null;
    }

    return (
        <div className="flex min-h-0 flex-1">
            <ThreadView thread={thread} />
            {thread.tabs.length > 0 && <SidePanel thread={thread} />}
        </div>
    );
};

export const App = () =>
{
    const playground = usePlayground();
    const title = playground.view.kind === "chat" ? playground.currentThread()?.title : playground.view.kind === "plugin" ? playground.pluginName() : playground.tool(playground.view.tool)?.title;

    return (
        <SidebarProvider className="h-svh">
            <AppSidebar />
            <SidebarInset className="flex min-h-0 flex-col overflow-hidden">
                <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                    <SidebarTrigger aria-label="사이드바 접기" />
                    <span className="truncate text-sm font-medium">{title ?? ""}</span>
                    <span className="ml-auto text-xs text-muted-foreground" data-testid="platform">{playground.host.platform()} · 모델 {playground.modelName()}</span>
                </header>
                <Main />
            </SidebarInset>
            <DevTools />
        </SidebarProvider>
    );
};

/** 창을 띄우지 못했을 때. 연결이 필요하면 연결하러 가는 단추를 세운다 */
export const Failure = ({ message, connect }: { message: string; connect: boolean }) => (
    <main className="flex h-svh items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-3 text-center">
            <h1 className="text-lg font-semibold">{connect ? "앱에 먼저 연결해야 해요" : "플레이그라운드를 띄우지 못했어요"}</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            {connect && <Button render={<a href="/connect" />} nativeButton={false}>연결하기</Button>}
        </div>
    </main>
);
