import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";

// ── Self-heal stale-chunk errors after a deploy ─────────────────────────────
// Vite emits a "vite:preloadError" event when a lazy-loaded chunk 404s because
// the user's tab is holding an old index.html that references chunk hashes
// that no longer exist on the server (typical after a fresh Vercel deploy).
// We reload the tab once per occurrence to pull the new index.html + chunks.
// The sessionStorage guard prevents a refresh loop if the failure is real.
window.addEventListener("vite:preloadError", (event) => {
  if (!sessionStorage.getItem("bestly:chunk-reloaded")) {
    sessionStorage.setItem("bestly:chunk-reloaded", String(Date.now()));
    event.preventDefault();
    window.location.reload();
  }
});
// Also catch the unhandled promise rejection that React Router's lazy() emits.
window.addEventListener("unhandledrejection", (event) => {
  const msg = String(event.reason?.message || event.reason || "");
  if (/Failed to fetch dynamically imported module|Loading chunk \S+ failed|ChunkLoadError/i.test(msg)) {
    if (!sessionStorage.getItem("bestly:chunk-reloaded")) {
      sessionStorage.setItem("bestly:chunk-reloaded", String(Date.now()));
      event.preventDefault();
      window.location.reload();
    }
  }
});
// Self-hosted Plus Jakarta Sans (drops Google Fonts CDN — privacy-aligned + faster).
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <App />
    </ThemeProvider>
  </ErrorBoundary>
);
