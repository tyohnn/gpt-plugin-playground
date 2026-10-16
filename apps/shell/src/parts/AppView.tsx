import { usePlayground } from "../lib/context";
import { Composer } from "./Composer";
import { WidgetFrame } from "./WidgetFrame";

/** 사이드바의 앱. 가운데가 그 앱의 화면이 되고 아래에 컴포저가 뜬다. 컴포저가 그 화면의 컨텍스트를 받는다 */
export const AppView = ({ tool }: { tool: string }) =>
{
    const playground = usePlayground();

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            {[...playground.globals.entries()].map(([name, session]) => (
                <div key={session} hidden={name !== tool} className="min-h-0 flex-1">
                    <WidgetFrame session={session} className="h-full" />
                </div>
            ))}
            <div className="absolute right-6 bottom-6 w-[min(420px,calc(100%-3rem))]">
                <Composer />
            </div>
        </div>
    );
};
