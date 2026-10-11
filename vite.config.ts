import { defineConfig, type Plugin } from "vite";
// Swapped from @vitejs/plugin-react-swc → @vitejs/plugin-react (Babel) to fix
// _jsxDEV runtime injection after framer-motion install. Babel plugin is the
// compat-default React plugin and reliably injects the dev runtime.
import react from "@vitejs/plugin-react";
import path from "path";
import fs, { writeFileSync, mkdirSync } from "fs";

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

// Per-route link previews (2026-10-11). Link-preview bots (iMessage, Slack, LinkedIn) don't run JS, so
// Helmet's tags never reach them: every SPA route used to share the homepage card. For each route here we
// write dist/<file> = dist/index.html with that route's tags swapped in, and vercel.json rewrites the route
// to it. Same app bundle, so the page itself is identical. The build FAILS if a tag can't be swapped, so a
// broken preview can never ship (the last good deploy stays live).
const SHARE_ROUTES = [
  {
    file: "agent.html",
    path: "/agent",
    title: "Bestly Agent: an AI that answers your business phone",
    description:
      "Bestly Agent picks up every call, day or night, talks like a real person, and does the work while it talks: books the appointment, updates your software, and texts the confirmation.",
    image: "/og-agent.png",
  },
];

function routeShareTags(): Plugin {
  let outDir = "dist";
  return {
    name: "route-share-tags",
    apply: "build",
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const base = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
      const SITE = "https://www.bestly.tech";
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      for (const r of SHARE_ROUTES) {
        const url = SITE + r.path;
        const img = SITE + r.image;
        const swaps: [RegExp, string][] = [
          [/<title>[^<]*<\/title>/, `<title>${esc(r.title)}</title>`],
          [/(<meta name="description" content=")[^"]*"/, `$1${esc(r.description)}"`],
          [/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`],
          [/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`],
          [/(<meta property="og:title" content=")[^"]*"/, `$1${esc(r.title)}"`],
          [/(<meta property="og:description" content=")[^"]*"/, `$1${esc(r.description)}"`],
          [/(<meta property="og:image" content=")[^"]*"/, `$1${img}"`],
          [/(<meta name="twitter:url" content=")[^"]*"/, `$1${url}"`],
          [/(<meta name="twitter:title" content=")[^"]*"/, `$1${esc(r.title)}"`],
          [/(<meta name="twitter:description" content=")[^"]*"/, `$1${esc(r.description)}"`],
          [/(<meta name="twitter:image" content=")[^"]*"/, `$1${img}"`],
        ];
        let html = base;
        for (const [re, to] of swaps) {
          if (!re.test(html)) throw new Error(`route-share-tags: ${r.file} could not find ${re} in index.html`);
          html = html.replace(re, to);
        }
        if (!fs.existsSync(path.join(outDir, r.image.slice(1)))) {
          throw new Error(`route-share-tags: ${r.image} missing from public/`);
        }
        fs.writeFileSync(path.join(outDir, r.file), html);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), stampBuild(), routeShareTags()],
  build: {
    rollupOptions: {
      // Two entries. /admin is served by its own HTML so that its manifest, icons and
      // title are in the document when the OS reads them at install time - see the
      // comment at the top of admin.html.
      input: {
        main: path.resolve(__dirname, "index.html"),
        admin: path.resolve(__dirname, "admin.html"),
        // Turo guest page: its own link preview + share-sheet identity (see lax.html).
        lax: path.resolve(__dirname, "lax.html"),
        // Personal trip pages /t/:token (LAX or home pickup), see trip.html.
        trip: path.resolve(__dirname, "trip.html"),
      },
    },
  },
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
