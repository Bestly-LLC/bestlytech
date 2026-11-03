import fs from 'node:fs';
// usage: node ev.mjs "<js>" | @file.js | --reload   -- evaluates on the LIVE headless page (127.0.0.1:9336)
const list = await (await fetch('http://127.0.0.1:9336/json')).json();
const pg = list.find(t => t.type === 'page' && /18099\/wall/.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
await new Promise(r => ws.onopen = r);
let a = process.argv[2];
if (a === '--reload') { await send('Runtime.evaluate', { expression: 'location.reload()' }); console.log('reloaded', pg.url); }
else { const code = a.startsWith('@') ? fs.readFileSync(a.slice(1), 'utf8') : a;
  const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.result ? r.result.result.value : r.result, null, 1), r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500) : ''); }
ws.close();
