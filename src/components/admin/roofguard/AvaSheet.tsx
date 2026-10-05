/**
 * One scroll surface per sheet (shared by both Avas: call sheets, message sheets, spam sheets, the in-call screen).
 *
 * Why this exists: the call sheets used to be SheetContent (overflow-y-auto) holding a LiveTranscript that was ALSO
 * overflow-y-auto + overscroll-contain, with no height cap. The transcript was a second, non-scrolling scroll container
 * that sat over most of the sheet and had scroll chaining switched off, so a touch drag that started on the transcript
 * had nowhere to go. Now the frame is a fixed-height flex column: the header never moves and exactly one body div
 * (min-h-0 flex-1 overflow-y-auto) scrolls. Transcripts inside it render inline (no scroller of their own).
 */
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function ScrollSheet({ open, onClose, title, description, children, className, bodyClassName }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right"
        className={cn("admin-shell flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-white/10 bg-[#0b0b0d] p-0 text-white sm:max-w-xl", className)}>
        <div className="shrink-0 space-y-1.5 px-6 pb-3 pr-12 pt-6 text-left">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold text-white">{title}</SheetTitle>
          {description ? <SheetDescription className="text-sm text-white/55">{description}</SheetDescription> : <SheetDescription className="sr-only">Details</SheetDescription>}
        </div>
        <div data-sheet-scroll className={cn("min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]", bodyClassName)}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
