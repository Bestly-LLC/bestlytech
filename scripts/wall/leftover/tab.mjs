import fs from 'node:fs';
// usage: node tab.mjs <out.jpg> "<js before shot>"  -- opens a separate test tab, never touches the live page
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
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: +(process.env.H||1080), deviceScaleFactor: 1, mobile: false }, s);
await send('Page.enable', {}, s);
if (process.env.FAKE_HOUR) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const RD=Date;const n=new RD();const t=new RD(n);t.setHours(${process.env.FAKE_HOUR},5,0,0);const off=t-n;class FD extends RD{constructor(...a){if(a.length)super(...a);else super(RD.now()+off);} static now(){return RD.now()+off;}};window.Date=FD;})();` }, s);
await send('Page.navigate', { url: 'http://127.0.0.1:18099/wall?src=preview' }, s);
await new Promise(r => setTimeout(r, 14000));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result;
console.log('before', JSON.stringify((await ev(`JSON.stringify({mode:document.body.dataset.mode,cls:document.body.className.slice(0,200),keys:Object.keys(window).filter(k=>/mode|amb|night/i.test(k)).slice(0,30)})`)).result.value));
if (process.argv[3]) { const code = process.argv[3].startsWith('@') ? fs.readFileSync(process.argv[3].slice(1),'utf8') : process.argv[3]; const r = await ev(code); console.log('js', JSON.stringify(r.result && r.result.value), r.exceptionDetails ? r.exceptionDetails.text : ''); await new Promise(r => setTimeout(r, 15000)); }
console.log('after', JSON.stringify((await ev(`JSON.stringify({mode:document.body.dataset.mode})`)).result.value));
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, s);
fs.writeFileSync(process.argv[2], Buffer.from(shot.result.data, 'base64'));
await send('Target.closeTarget', { targetId: tid });
bws.close();
