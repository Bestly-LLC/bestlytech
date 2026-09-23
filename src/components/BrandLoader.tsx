import { cn } from "@/lib/utils";
import { AdminMark } from "@/components/AdminMark";
import { useAdminTheme } from "@/hooks/useAdminTheme";

/**
 * Bestly mark shown while a route chunk or the admin session loads — never a blank screen.
 * The same look is inlined in index.html (#boot-splash) so it's already on screen before any JS runs.
 *
 * tone="dark" is the admin and partner loader: the binoculars, white on the black shell.
 *
 * The mark is deliberately STILL here. Everywhere else it glances, blinks and follows the
 * cursor, and that is the point of it - but a loading screen is the one place the eyes have
 * nothing to react to, so the motion reads as a glitch rather than as character. It holds
 * still until there is something to look at.
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
  const { bento } = useAdminTheme();
  const lightAdmin = tone === "dark" && bento;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-center justify-center",
        fullScreen ? "min-h-dvh" : "min-h-[60vh]",
        fullScreen && (tone === "dark" ? "bg-black" : "bg-background"),
        lightAdmin && "admin-bento",
        lightAdmin && fullScreen && "bg-[#F3F2EE]",
      )}
    >
      {tone === "dark" ? (
        <AdminMark animated={false} watchCursor={false} className="h-28 w-28" />
      ) : (
        <div className="brand-loader-mark flex h-24 w-24 items-center justify-center">
          <img src="/bestly-mark.webp" alt="" width={84} height={84} decoding="async" fetchPriority="high" />
        </div>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
