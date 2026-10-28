// Lets `tsc -p tsconfig.app.json` read the edge modules that vitest imports (they are written for Deno).
declare module "npm:pdf-lib@1.17.1" { export const PDFDocument: any; export const StandardFonts: any; export const rgb: any; }
declare const Deno: { env: { get(k: string): string | undefined } };
