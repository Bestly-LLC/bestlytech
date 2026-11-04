import fs from 'node:fs';
// usage: node shot2.mjs <out.jpg> [waitForShownMs]  -- live page: waits for an ask card, shoots it at 2x (clip scale, no layout change), then times the fade
const list = await (await fetch('http://127.0.0.1:' + (process.env.CDP || 47333) + '/json')).json();
const pg = list.find(t => t.type === 'page' && /18099/.test(t.url));
const ws = new WebSocket(pg.webSocketDebuggerUrl); let id = 0; const pend = {}; const errs = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 200));
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error ' + JSON.stringify(m.params.args).slice(0, 200)); };
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
const base = (await ev('window.__ask().shown')) || 0; const t0 = Date.now(); let shownAt = 0;
console.log('base shown', base, 'mode', await ev('document.body.dataset.mode+" "+document.body.className.slice(0,120)'));
while (Date.now() - t0 < +(process.argv[3] || 40000)) { if ((await ev('window.__ask().shown')) > base) { shownAt = Date.now(); break; } await wait(300); }
if (!shownAt) { console.log('NO CARD SHOWN', JSON.stringify(await ev('window.__ask()')), errs); process.exit(0); }
await wait(2500);
const snap = await ev(`(()=>{const c=document.getElementById('cAsk'),A=document.getElementById('asA');return JSON.stringify({q:document.getElementById('asQ').textContent,a:A.textContent,fs:A.style.fontSize,rings:document.querySelectorAll('.ac .askring').length,cls:c.className,op:getComputedStyle(c).opacity})})()`);
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1920, height: 993, scale: 2 } });
fs.writeFileSync(process.argv[2], Buffer.from(shot.result.data, 'base64'));
console.log('snap', snap);
let outAt = 0, goneAt = 0; const tl = [];
while (Date.now() - shownAt < 40000) {
  const s = JSON.parse(await ev(`(()=>{const c=document.getElementById('cAsk');return JSON.stringify({op:+getComputedStyle(c).opacity,on:c.classList.contains('on'),out:c.classList.contains('as-out'),a:window.__ask().on})})()`));
  const t = (Date.now() - shownAt) / 1000; if (s.out && !outAt) outAt = t; if (!s.a && !s.on && !goneAt) { goneAt = t; break; } await wait(250);
}
console.log('fade starts at', outAt, 's; card released/hidden at', goneAt, 's after show (shown ~age-adjusted ttl 20)');
console.log('errors during run', JSON.stringify(errs), 'v2', await ev('window.__v2().errs'), 'ask', JSON.stringify(await ev('window.__ask()')));
ws.close();
