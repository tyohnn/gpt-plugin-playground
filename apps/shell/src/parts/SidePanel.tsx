import { Button } from "@host-playground/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@host-playground/ui/components/tabs";
import { X } from "@host-playground/ui/icons";

import { usePlayground } from "../lib/context";
import type { Thread } from "../lib/store";
import { WidgetFrame } from "./WidgetFrame";

/** 대화 옆 패널. 플러그인의 `thread` 진입점과 파일 편집기가 탭으로 선다 */
export const SidePanel = ({ thread }: { thread: Thread }) =>
{
    const playground = usePlayground();

    if (thread.tabs.length === 0)
    {
        return null;
    }

    return (
        <aside aria-label="옆 패널" className="flex w-[min(560px,50%)] min-w-80 flex-col border-l">
            <Tabs value={thread.active ?? undefined} onValueChange={(value) =>
            {
                thread.active = String(value);
                playground.changed();
            }}>
                <TabsList className="m-2">
                    {thread.tabs.map((tab) => (
                        <TabsTrigger key={tab.id} value={tab.id}>
                            {tab.title}
                            <Button render={<span />} nativeButton={false} variant="ghost" size="icon-xs" aria-label={`${tab.title} 닫기`} onClick={(event) =>
                            {
                                event.stopPropagation();
                                void playground.closeTab(thread.id, tab.id);
                            }}><X /></Button>
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            {thread.tabs.map((tab) => (
                <div key={tab.id} hidden={tab.id !== thread.active} className="min-h-0 flex-1">
                    <WidgetFrame session={tab.session} className="h-full" />
                </div>
            ))}
        </aside>
    );
};
