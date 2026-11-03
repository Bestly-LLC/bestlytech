import fs from 'node:fs';
// CARCARD verify harness: separate CDP tab (never touches the live page), main mode. OVERRIDE=<html> serves a candidate wall.html for the document request.
// usage: [OVERRIDE=wall.new.html] FAKE_HOUR=14 [H=1080] node tab5.mjs <manifest.json>   manifest: {shots:[{js, out, wait, clip, after}]}
const man = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = 'http://127.0.0.1:9336';
const ver = await (await fetch(base + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend[i] = r; bws.send(JSON.stringify({ id: i, method, params, sessionId })); });
bws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  if (m.method === 'Fetch.requestPaused') { const u = m.params.request.url; const isDoc = /18099\/wall(\?|$)/.test(u) && m.params.resourceType === 'Document';
    if (isDoc && process.env.OVERRIDE) { const body = fs.readFileSync(process.env.OVERRIDE).toString('base64'); send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body }, m.sessionId); }
    else send('Fetch.continueRequest', { requestId: m.params.requestId }, m.sessionId); } };
await new Promise(r => bws.onopen = r);
const t = await send('Target.createTarget', { url: 'about:blank' });
const tid = t.result.targetId;
const a = await send('Target.attachToTarget', { targetId: tid, flatten: true });
const s = a.result.sessionId;
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: +(process.env.H || 1080), deviceScaleFactor: 1, mobile: false }, s);
await send('Page.enable', {}, s);
if (process.env.OVERRIDE) await send('Fetch.enable', { patterns: [{ urlPattern: '*18099/wall*', resourceType: 'Document' }] }, s);
if (process.env.FAKE_HOUR) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const RD=Date;const n=new RD();const t=new RD(n);t.setHours(${process.env.FAKE_HOUR},5,0,0);const off=t-n;class FD extends RD{constructor(...a){if(a.length)super(...a);else super(RD.now()+off);} static now(){return RD.now()+off;}};window.Date=FD;})();` }, s);
await send('Page.navigate', { url: 'http://127.0.0.1:18099/wall?src=preview' }, s);
await new Promise(r => setTimeout(r, +(process.env.LOAD || 14000)));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result;
for (const sh of man.shots) {
  if (sh.js) { const r = await ev(sh.js); console.log('js', JSON.stringify(r.result && r.result.value), r.exceptionDetails ? JSON.stringify(r.exceptionDetails).slice(0, 400) : ''); }
  await new Promise(r => setTimeout(r, sh.wait || 3500));
  if (sh.after) { const r = await ev(sh.after); console.log('after', JSON.stringify(r.result && r.result.value)); }
  if (sh.out) { const shot = await send('Page.captureScreenshot', Object.assign({ format: 'jpeg', quality: 92 }, sh.clip ? { clip: sh.clip } : {}), s);
    fs.writeFileSync(sh.out, Buffer.from(shot.result.data, 'base64')); }
}
await send('Target.closeTarget', { targetId: tid });
bws.close();
