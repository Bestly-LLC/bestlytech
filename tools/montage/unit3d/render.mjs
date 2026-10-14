import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const [clip, frames, outDir, startArg, endArg] = process.argv.slice(2);
const N = +frames; fs.mkdirSync(outDir, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
const srv = http.createServer((q, r) => { const f = path.join('www', decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'index.html'); fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 1200 } });
pg.on('console', (m) => console.log('[page]', m.text())); pg.on('pageerror', (e) => console.log('[err]', e.message));
await pg.goto(`http://localhost:${port}/index.html`); await pg.waitForFunction('window.ready === true', null, { timeout: 120000 });
const s = +(startArg || 0), e = +(endArg || N);
const t0 = Date.now();
for (let i = s; i < e; i++) {
  const t = clip === 'turn' ? i / N : i / (N - 1);
  const url = await pg.evaluate(([c, t]) => window.renderFrame(c, t), [clip, t]);
  fs.writeFileSync(path.join(outDir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  if (i === s) console.log('first frame ms', Date.now() - t0);
}
console.log('done', clip, e - s, 'frames', Date.now() - t0, 'ms');
await b.close(); srv.close();
