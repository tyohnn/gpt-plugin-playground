import { cn } from "@host-playground/ui/lib/utils";

import { usePlayground } from "../lib/context";

/**
 * 화면 하나. 창과 다른 origin 의 주소를 띄우고, 그 주소는 자원의 CSP 머리와 함께 나간다(`frame-origin` · `csp-from-resource`).
 *
 * ⚠ `sandbox` 의 값은 추측이다(`frame-sandbox`). 실물의 속성을 녹취하면 바꾼다.
 */
export const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export const WidgetFrame = ({ session, className, fit }: { session: string; className?: string; fit?: boolean }) =>
{
    const playground = usePlayground();
    const frame = playground.frames.get(session);
    const title = playground.host.session(session)?.tool.title ?? "화면";

    if (frame === undefined)
    {
        return null;
    }

    return (
        <iframe
            title={title}
            data-session={session}
            src={frame.url}
            sandbox={SANDBOX}
            // 화면의 첫 말은 load 보다 먼저 올 수 있다. 창은 iframe 의 창 객체를 먼저 쥐어 둔다
            ref={(element) => playground.attach(session, element?.contentWindow ?? null)}
            className={cn("w-full border-0 bg-transparent", className)}
            style={fit === true && frame.height !== null ? { height: frame.height } : undefined}
        />
    );
};
