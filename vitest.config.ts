import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "supabase/functions/_shared/email-render.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
