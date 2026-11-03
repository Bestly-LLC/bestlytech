import fs from 'node:fs';
// usage: FAKE_HOUR=14 node tab2.mjs <out.jpg|-> [jsfile] [waitMs] [htmlurl]  -- separate test tab, live page untouched; prints js result JSON
const base = 'http://127.0.0.1:9336';
const ver = await (await fetch(base + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend[i] = r; bws.send(JSON.stringify({ id: i, method, params, sessionId })); });
bws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  if (m.method === 'Fetch.requestPaused' && /\/logos\//.test(m.params.request.url) && process.env.BLOCKLOGOS) { send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, body: '' }, m.sessionId); }
  else if (m.method === 'Fetch.requestPaused' && process.env.OVERRIDE) { const u = m.params.request.url; const isDoc = /18099\/wall(\?|$)/.test(u) && m.params.resourceType === 'Document';
    if (isDoc) { const body = fs.readFileSync(process.env.OVERRIDE).toString('base64'); send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body }, m.sessionId); }
    else send('Fetch.continueRequest', { requestId: m.params.requestId }, m.sessionId); } };
await new Promise(r => bws.onopen = r);
const t = await send('Target.createTarget', { url: 'about:blank' });
const tid = t.result.targetId;
const a = await send('Target.attachToTarget', { targetId: tid, flatten: true });
const s = a.result.sessionId;
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, s);
await send('Page.enable', {}, s);
if (process.env.OVERRIDE||process.env.BLOCKLOGOS) await send('Fetch.enable', { patterns: [{ urlPattern: '*18099/wall*', resourceType: 'Document' }].concat(process.env.BLOCKLOGOS?[{ urlPattern: '*18099/logos/*' }]:[]) }, s);
if (process.env.FAKE_HOUR) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const RD=Date;const n=new RD();const t=new RD(n);t.setHours(${process.env.FAKE_HOUR},5,0,0);const off=t-n;class FD extends RD{constructor(...a){if(a.length)super(...a);else super(RD.now()+off);} static now(){return RD.now()+off;}};window.Date=FD;})();` }, s);
if (process.env.PRE) await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(process.env.PRE, 'utf8') }, s);
await send('Page.navigate', { url: process.argv[5] || 'http://127.0.0.1:18099/wall?src=preview' }, s);
await new Promise(r => setTimeout(r, +(process.argv[4] || 16000)));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result;
if (process.argv[3] && process.argv[3] !== '-') { const r = await ev(fs.readFileSync(process.argv[3], 'utf8')); console.log(JSON.stringify(r.result && r.result.value, null, 1), r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 600) : ''); }
await new Promise(r => setTimeout(r, +(process.env.POSTWAIT || 2500)));
if (process.argv[2] !== '-') { const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, s); fs.writeFileSync(process.argv[2], Buffer.from(shot.result.data, 'base64')); }
await send('Target.closeTarget', { targetId: tid });
bws.close();
