import { cn } from "@/lib/utils";

/**
 * Bestly mark shown while a route chunk or the admin session loads — never a blank screen.
 * The same look is inlined in index.html (#boot-splash) so it's already on screen before any JS runs.
 *
 * tone="dark" puts the navy mark on a light tile so it stays visible on the black admin shell.
 */
export function BrandLoader({
  tone = "light",
  fullScreen = false,
  label = "Loading",
}: {
  tone?: "light" | "dark";
  fullScreen?: boolean;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-center justify-center",
        fullScreen ? "min-h-dvh" : "min-h-[60vh]",
        fullScreen && (tone === "dark" ? "bg-black" : "bg-background"),
      )}
    >
      <div
        className={cn(
          "brand-loader-mark flex items-center justify-center",
          tone === "dark"
            ? "h-24 w-24 rounded-[24px] bg-white shadow-[0_8px_32px_rgba(99,102,241,0.25)]"
            : "h-24 w-24",
        )}
      >
        <img
          src="/bestly-mark.webp"
          alt=""
          width={tone === "dark" ? 64 : 84}
          height={tone === "dark" ? 64 : 84}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
