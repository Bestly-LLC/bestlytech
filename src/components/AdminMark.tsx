import { cn } from "@/lib/utils";

/**
 * The admin mark: binoculars giving side-eye. The animation lives inside the SVG
 * itself (and respects prefers-reduced-motion there), so an <img> is all it needs.
 */
export function AdminMark({ className, label }: { className?: string; label?: string }) {
  return (
    <img
      src="/admin-mark.svg"
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      width={72}
      height={72}
      decoding="async"
      draggable={false}
      className={cn("select-none", className)}
    />
  );
}
