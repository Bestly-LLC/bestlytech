import fs from 'node:fs';
// usage: FAKE_HOUR=7 PRE=pre2.js node shots.mjs <outA.jpg> <outB.jpg> [OVERRIDE html via env]
// Test tab (live page untouched): brief forced, wait for the Scout card to be on screen, shoot + measure; ~15 s later again.
const base = 'http://127.0.0.1:47333';
const ver = await (await fetch(base + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend[i] = r; bws.send(JSON.stringify({ id: i, method, params, sessionId })); });
bws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  if (m.method === 'Fetch.requestPaused' && process.env.OVERRIDE) { const u = m.params.request.url; const isDoc = /18099\/wall(\?|$)/.test(u) && m.params.resourceType === 'Document';
    if (isDoc) { const body = fs.readFileSync(process.env.OVERRIDE).toString('base64'); send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body }, m.sessionId); }
    else send('Fetch.continueRequest', { requestId: m.params.requestId }, m.sessionId); } };
await new Promise(r => bws.onopen = r);
const t = await send('Target.createTarget', { url: 'about:blank' });
const tid = t.result.targetId;
const a = await send('Target.attachToTarget', { targetId: tid, flatten: true });
const s = a.result.sessionId;
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: +(process.env.H || 993), deviceScaleFactor: 1, mobile: false }, s);
await send('Page.enable', {}, s);
if (process.env.OVERRIDE) await send('Fetch.enable', { patterns: [{ urlPattern: '*18099/wall*', resourceType: 'Document' }] }, s);
if (process.env.FAKE_HOUR) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const RD=Date;const n=new RD();const t=new RD(n);t.setHours(${process.env.FAKE_HOUR},5,0,0);const off=t-n;class FD extends RD{constructor(...a){if(a.length)super(...a);else super(RD.now()+off);} static now(){return RD.now()+off;}};window.Date=FD;})();` }, s);
if (process.env.PRE) await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(process.env.PRE, 'utf8') }, s);
await send('Page.navigate', { url: 'http://127.0.0.1:18099/wall?src=preview' }, s);
await new Promise(r => setTimeout(r, 9000));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result.result.value;
await ev('window.__BRIEF_FORCE={};1');
await new Promise(r => setTimeout(r, 16000));
const MEAS = `(()=>{const R=e=>{const r=e.getBoundingClientRect();return[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]};
const lis=[...document.querySelectorAll('#cScout #w2Sl li > span')];const pg=document.querySelector('.pager');const ul=lis[0]&&lis[0].closest('ul');const cv=document.getElementById('cvWx');const co=document.getElementById('corner');
const cs=getComputedStyle(cv),cc=getComputedStyle(co);const bp=document.getElementById('briefP');
return JSON.stringify({scene:window.__bf2&&window.__bf2.cur(),corner:{rect:R(co),opacity:+cc.opacity,wx:+cs.opacity,text:cv.innerText.replace(/\\s+/g,' ').trim()},
briefOn:!!(bp&&bp.classList.contains('in')),briefOver:window.__brief&&window.__brief.over,scoutOn:document.getElementById('cScout').classList.contains('on'),
scoutRows:lis.map(x=>{const lh=parseFloat(getComputedStyle(x).lineHeight)||25;return{t:x.textContent,overflow:x.scrollWidth>x.clientWidth+1||x.scrollHeight>x.clientHeight+1,lines:Math.round(x.offsetHeight/lh),ellipsis:/(\\.\\.\\.|\\u2026)\\s*$/.test(x.textContent)}}),
ulBottom:ul&&Math.round(ul.getBoundingClientRect().bottom),pagerTop:pg&&Math.round(pg.getBoundingClientRect().top),errs:window.__errs,cerr:window.__cerr})})()`;
const out = [];
for (const [i, file] of [[0, process.argv[2]], [1, process.argv[3]]]) {
  if (i) await new Promise(r => setTimeout(r, 14000));
  for (let k = 0; k < 80; k++) { const on = await ev(`document.getElementById('cScout').classList.contains('on')`); if (on) break; await new Promise(r => setTimeout(r, 1000)); }
  await new Promise(r => setTimeout(r, 2500));
  const m = JSON.parse(await ev(MEAS)); out.push(m);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }, s);
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}
console.log(JSON.stringify(out, null, 1));
await send('Target.closeTarget', { targetId: tid });
bws.close();
