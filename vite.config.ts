import { defineConfig } from "vite";
// Swapped from @vitejs/plugin-react-swc → @vitejs/plugin-react (Babel) to fix
// _jsxDEV runtime injection after framer-motion install. Babel plugin is the
// compat-default React plugin and reliably injects the dev runtime.
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  optimizeDeps: {
    include: ["framer-motion", "react", "react-dom", "react/jsx-dev-runtime"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
