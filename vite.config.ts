import { defineConfig } from "vite";
// Swapped from @vitejs/plugin-react-swc → @vitejs/plugin-react (Babel) to fix
// _jsxDEV runtime injection after framer-motion install. Babel plugin is the
// compat-default React plugin and reliably injects the dev runtime.
import react from "@vitejs/plugin-react";
import path from "path";
import { writeFileSync, mkdirSync } from "fs";

// Every build stamps its own id, and drops it at /version.json. The app polls that file and
// reloads itself when a new build is out — otherwise a tab (or the desktop app) left open keeps
// running yesterday's code and a fix looks like it never shipped.
const BUILD_ID = new Date().toISOString();
const stampBuild = () => ({
  name: "stamp-build",
  writeBundle(opts: { dir?: string }) {
    const dir = opts.dir ?? "dist";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/version.json`, JSON.stringify({ build: BUILD_ID }));
  },
});

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), stampBuild()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  optimizeDeps: {
    include: ["framer-motion", "react", "react-dom", "react/jsx-dev-runtime"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
