import fs from 'node:fs';
// usage: node livecrop.mjs <out.jpg> [scale]  -- 2x clip around #cCar on the LIVE page (read only)
const list = await (await fetch('http://127.0.0.1:9336/json')).json();
const pg = list.find(t => t.type === 'page' && /18099\/wall/.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
await new Promise(r => ws.onopen = r);
const rr = await send('Runtime.evaluate', { expression: 'JSON.stringify((()=>{const r=document.querySelector("#cCar .hdr").getBoundingClientRect();return {x:r.x,y:r.y,w:innerWidth,h:innerHeight}})())', returnByValue: true });
const b = JSON.parse(rr.result.result.value); console.log(JSON.stringify(b));
const clip = { x: Math.max(0, b.x - 55), y: Math.max(0, b.y - 45), width: 480, height: 300, scale: +(process.argv[3] || 2) };
const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip });
fs.writeFileSync(process.argv[2], Buffer.from(r.result.data, 'base64'));
ws.close();
