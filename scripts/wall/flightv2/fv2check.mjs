import { spawn } from 'node:child_process';
const [url, wait = '20000'] = process.argv.slice(2);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--user-data-dir=/tmp/wallcdp3','--remote-debugging-port=9335','--hide-scrollbars','--window-size=1920,1080','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const t = await (await fetch('http://127.0.0.1:9335/json')).json(); const p = t.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) {} }
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
 o.patched=document.documentElement.innerHTML.includes('FLIGHTV2_P2');
 try{o.v2=window.__v2&&window.__v2();}catch(e){o.v2='err '+e.message}
 try{o.sky=window.SKYW1&&{errs:window.SKYW1.errs,err:window.SKYW1.err,step:window.SKYW1.step};}catch(e){}
 o.tags=[...document.querySelectorAll('#airPlanes .ac .tag.v2')].slice(0,6).map(e=>e.innerText.replace(/\\n/g,' | '));
 o.tagsShown=document.querySelectorAll('#airPlanes .ac .tag.show').length; o.planes=document.querySelectorAll('#airPlanes .ac').length;
 o.edge=[...document.querySelectorAll('#airPlanes .v2e')].map(e=>e.innerText);
 o.busEl=!!document.querySelector('#wingBus'); o.busText=(document.querySelector('#wingBus')||{}).innerText||''; o.busCls=document.body.classList.contains('bus-on');
 o.busMk=document.querySelectorAll('#airPlanes .v2b').length;
 o.key=((document.querySelector('#wingKey')||{}).innerText||'').slice(0,160).replace(/\\n/g,' | ');
 const wf=document.querySelector('#wingFlight'); o.card=wf?wf.innerText.replace(/\\n/g,' | ').slice(0,300):'';
 const ell=[]; document.querySelectorAll('#wingFlight, #wingFlight *, .bp, .bp *').forEach(e=>{ if(getComputedStyle(e).textOverflow==='ellipsis') ell.push(e.className||e.tagName); }); o.ellipsis=[...new Set(ell)];
 let n=0,t0=performance.now(); await new Promise(r=>{function f(){n++; if(performance.now()-t0<3000) requestAnimationFrame(f); else r();} requestAnimationFrame(f);}); o.fps=Math.round(n/3);
 try{ const r=await (await fetch('/api/bus')).json(); o.busApi={lines:(r.lines||[]).length,veh:(r.vehicles||[]).length,ok:r.ok}; }catch(e){o.busApi='err'}
 return JSON.stringify(o,null,1);})()`;
const ev = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log(ev.result?.result?.value || JSON.stringify(ev.result));
console.log('exceptions:', JSON.stringify(logs.slice(0, 6)));
process.exit(0);
