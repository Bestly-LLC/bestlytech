// SKYAP_20261102 headless check (GET only). usage: node skycheck.mjs http://127.0.0.1:18099/wall 25000
import { spawn } from 'node:child_process';
const [url, wait = '25000'] = process.argv.slice(2);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--user-data-dir=/tmp/wallcdp4','--remote-debugging-port=9336','--hide-scrollbars','--window-size=1920,1080','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const t = await (await fetch('http://127.0.0.1:9336/json')).json(); const p = t.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) {} }
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = {}; const logs = [];
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  if (m.method === 'Runtime.exceptionThrown') logs.push((m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text).slice(0,200));
  if (m.method === 'Fetch.requestPaused') { const q = m.params.request; if (q.method !== 'GET') cmd('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); else cmd('Fetch.continueRequest', { requestId: m.params.requestId }); } });
await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await cmd('Page.navigate', { url });
await sleep(+wait);
const expr = `(async()=>{const o={};
 o.patched=document.documentElement.innerHTML.includes('SKYAP_20261102');
 try{o.v2=window.__v2&&window.__v2();}catch(e){o.v2='err '+e.message}
 o.pills=[...document.querySelectorAll('#airPlanes .apl')].map(e=>e.innerText.replace(/\\n/g,' | '));
 o.tags=[...document.querySelectorAll('#airPlanes .ac .tag.v2')].slice(0,6).map(e=>e.innerText.replace(/\\n/g,' | '));
 o.logoImgs=document.querySelectorAll('#airPlanes .tag .lg img').length; o.codeTiles=document.querySelectorAll('#airPlanes .tag .lg s').length;
 o.rings=document.querySelectorAll('#airPlanes .ac.apph').length; o.planes=document.querySelectorAll('#airPlanes .ac').length;
 const ell=[]; document.querySelectorAll('#airPlanes *, #wingFlight *').forEach(e=>{ if(getComputedStyle(e).textOverflow==='ellipsis') ell.push(e.className||e.tagName); }); o.ellipsis=[...new Set(ell)];
 o.oldLaxGlyph=document.querySelectorAll('#airLand line').length;
 let n=0,t0=performance.now(); await new Promise(r=>{function f(){n++; if(performance.now()-t0<3000) requestAnimationFrame(f); else r();} requestAnimationFrame(f);}); o.fps=Math.round(n/3);
 return JSON.stringify(o,null,1);})()`;
const ev = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log(ev.result?.result?.value || JSON.stringify(ev.result));
console.log('exceptions:', JSON.stringify(logs.slice(0, 6)));
process.exit(0);
