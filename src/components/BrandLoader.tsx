import { cn } from "@/lib/utils";
import { AdminMark } from "@/components/AdminMark";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { LoaderCard } from "@/components/loader/LoaderCard";

/**
 * Bestly mark shown while a route chunk or the admin session loads — never a blank screen.
 * The same look is inlined in index.html (#boot-splash) so it's already on screen before any JS runs.
 *
 * tone="dark" is the admin and partner loader: the binoculars, white on the black shell.
 *
 * The mark MOVES here: the side-eye glance and blink, phase-locked with the boot splash so it
 * never restarts mid-look. A still version shipped once (c29f26a) and Jared asked for the
 * motion back - don't pass animated={false} on a loader.
 *
 * cards (dark tone only): one short card under the mark after 400 ms, so a wait is worth reading
 * (docs/loader-cards-opusplan.md). "full" = facts, tips and quotes (admin, signed in); "quotes" = tips and
 * quotes only (session check, login, partner portal - the deck itself drops tips and facts on /partner).
 * The card is absolutely positioned, so the mark never moves. Default "none": the public site is unchanged.
 */
export function BrandLoader({
  tone = "light",
  fullScreen = false,
  label = "Loading",
  cards = "none",
}: {
  tone?: "light" | "dark";
  fullScreen?: boolean;
  label?: string;
  cards?: "full" | "quotes" | "none";
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
        <div className="relative flex h-28 w-28 items-center justify-center">
          <AdminMark className="h-28 w-28" />
          {cards !== "none" && <LoaderCard mode={cards} />}
        </div>
      ) : (
        <div className="brand-loader-mark flex h-24 w-24 items-center justify-center">
          <img src="/bestly-mark.webp" alt="" width={84} height={84} decoding="async" fetchPriority="high" />
        </div>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
