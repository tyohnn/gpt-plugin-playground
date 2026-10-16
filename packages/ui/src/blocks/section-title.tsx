import type { ReactNode } from "react";

import { NOTE } from "@host-playground/ui/blocks/lib/copy";
import { PendingText, pendingFrame } from "@host-playground/ui/blocks/pending";
import { TITLE } from "@host-playground/ui/blocks/lib/text";
import { cn } from "@host-playground/ui/lib/utils";

/**
 * A section's title in a page of notes or a document, with a short meta at the end of the line: how long it
 * takes, how much is done. For a title over a sentence of description use SectionHeading. `loading` draws bars
 * for the title and the meta.
 */
export const SectionTitle = ({ title, meta, loading, className }: { title?: ReactNode; meta?: ReactNode; loading?: boolean; className?: string }) => (
    <div {...pendingFrame(loading)} className={cn("flex items-baseline justify-between gap-3", className)}>
        <h2 className={TITLE}>{loading ? <PendingText length={14} /> : title}</h2>
        {meta !== undefined && <span className={NOTE}>{loading ? <PendingText length={8} /> : meta}</span>}
    </div>
);
