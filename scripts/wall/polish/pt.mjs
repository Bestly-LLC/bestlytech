import fs from 'node:fs';
// node pt.mjs <out.jpg> [setup.js] ; env: POL=file.js (eval first), WAIT=ms after setup, FAKE_HOUR, LOAD=ms, SHOTS=n (every SGAP ms)
const base = 'http://127.0.0.1:9336';
const ver = await (await fetch(base + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend[i] = r; bws.send(JSON.stringify({ id: i, method, params, sessionId })); });
bws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
await new Promise(r => bws.onopen = r);
const t = await send('Target.createTarget', { url: 'about:blank' });
const tid = t.result.targetId;
const a = await send('Target.attachToTarget', { targetId: tid, flatten: true });
const s = a.result.sessionId;
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: +(process.env.H||993), deviceScaleFactor: 1, mobile: false }, s);
await send('Page.enable', {}, s);
if (process.env.FAKE_HOUR) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const RD=Date;const n=new RD();const t=new RD(n);t.setHours(${process.env.FAKE_HOUR},5,0,0);const off=t-n;class FD extends RD{constructor(...a){if(a.length)super(...a);else super(RD.now()+off);} static now(){return RD.now()+off;}};window.Date=FD;})();` }, s);
await send('Page.navigate', { url: 'http://127.0.0.1:18099/wall?src=preview' }, s);
await new Promise(r => setTimeout(r, +(process.env.LOAD||12000)));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result;
const rd = f => f.startsWith('@') ? fs.readFileSync(f.slice(1),'utf8') : f;
if (process.env.POL) { const r = await ev(fs.readFileSync(process.env.POL,'utf8')); console.log('pol', JSON.stringify(r.result && r.result.value), r.exceptionDetails ? JSON.stringify(r.exceptionDetails).slice(0,400) : ''); }
if (process.argv[3]) { const r = await ev(fs.readFileSync(process.argv[3],'utf8')); console.log('js', JSON.stringify(r.result && r.result.value), r.exceptionDetails ? JSON.stringify(r.exceptionDetails).slice(0,400) : ''); }
const n = +(process.env.SHOTS||1);
for (let i=0;i<n;i++){ await new Promise(r => setTimeout(r, i? +(process.env.SGAP||1500) : +(process.env.WAIT||2500)));
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }, s);
  const out = n>1 ? process.argv[2].replace('.jpg','_'+i+'.jpg') : process.argv[2];
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); }
if (process.argv[4]) { const r = await ev(fs.readFileSync(process.argv[4],'utf8')); console.log('post', JSON.stringify(r.result && r.result.value)); }
await send('Target.closeTarget', { targetId: tid });
bws.close();
