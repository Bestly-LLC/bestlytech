import { useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

/**
 * Where toasts appear.
 *
 * Sonner defaults to bottom-right, which on the admin is the worst possible corner: it is
 * exactly where the Scout launcher sits, and on a phone the bottom nav covers it outright,
 * so a toast could be announced and never actually seen. On the admin both toasters go to
 * the top instead. The public site keeps the conventional bottom-right, where nothing is
 * in the way.
 *
 * This has to live inside the Router - the toasters used to render above it and could not
 * tell which section they were in.
 */
export function AppToasts() {
  const { pathname } = useLocation();
  const admin = pathname.startsWith("/admin") || pathname.startsWith("/partner");

  return (
    <>
      <Toaster viewportClassName={admin ? "sm:top-0 sm:bottom-auto sm:flex-col-reverse" : undefined} />
      <Sonner position={admin ? "top-center" : "bottom-right"} />
    </>
  );
}
