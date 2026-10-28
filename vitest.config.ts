import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "supabase/functions/_shared/email-render.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "./src"), "npm:pdf-lib@1.17.1": path.resolve(__dirname, "./src/test/claims-closer/pdf-lib-stub.ts") } },
});
