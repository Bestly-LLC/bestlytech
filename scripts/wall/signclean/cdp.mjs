import fs from 'node:fs';
// usage: node cdp.mjs <exprfile.js> [--shot out.jpg] [--reload]
const args = process.argv.slice(2);
const exprFile = args[0];
const shotIx = args.indexOf('--shot');
const list = await (await fetch('http://127.0.0.1:9336/json')).json();
const pg = list.find(t => t.type === 'page' && /wall|18099|8099/.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
await new Promise(r => ws.onopen = r);
if (args.includes('--reload')) {
  await send('Runtime.evaluate', { expression: 'location.reload()' });
  await new Promise(r => setTimeout(r, 9000));
  ws.close(); process.exit(0);
}
if (exprFile && exprFile !== '-') {
  const expr = fs.readFileSync(exprFile, 'utf8');
  const v = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(typeof v.result.result.value === 'string' ? v.result.result.value : JSON.stringify(v.result.result.value ?? v.result));
}
if (shotIx > -1) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  fs.writeFileSync(args[shotIx + 1], Buffer.from(r.result.data, 'base64'));
}
ws.close();
