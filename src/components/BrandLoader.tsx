import { cn } from "@/lib/utils";
import { AdminMark } from "@/components/AdminMark";
import { useAdminTheme } from "@/hooks/useAdminTheme";

/**
 * Bestly mark shown while a route chunk or the admin session loads — never a blank screen.
 * The same look is inlined in index.html (#boot-splash) so it's already on screen before any JS runs.
 *
 * tone="dark" is the admin loader: the side-eye binoculars, white on the black admin shell.
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
        <AdminMark className="h-28 w-28" />
      ) : (
        <div className="brand-loader-mark flex h-24 w-24 items-center justify-center">
          <img src="/bestly-mark.webp" alt="" width={84} height={84} decoding="async" fetchPriority="high" />
        </div>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
