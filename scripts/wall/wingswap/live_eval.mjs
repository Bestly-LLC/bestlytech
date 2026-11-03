import fs from 'node:fs';
const list = await (await fetch('http://127.0.0.1:9336/json')).json();
const pg = list.find(t => t.type === 'page' && /18099/.test(t.url));
const ws = new WebSocket(pg.webSocketDebuggerUrl); let id = 0; const pend = {};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
await new Promise(r => ws.onopen = r);
if (process.argv[3]) { const r = await send('Runtime.evaluate', { expression: fs.readFileSync(process.argv[3], 'utf8'), returnByValue: true, awaitPromise: true }); console.log(r.result.result ? r.result.result.value : JSON.stringify(r)); }
await new Promise(r => setTimeout(r, +(process.argv[4] || 500)));
const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 }); fs.writeFileSync(process.argv[2], Buffer.from(s.result.data, 'base64'));
ws.close();
