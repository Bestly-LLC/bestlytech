const list = await (await fetch('http://127.0.0.1:47333/json')).json();
const pg = list.find(t => t.type === 'page' && /18099/.test(t.url));
const ws = new WebSocket(pg.webSocketDebuggerUrl); let id=0; const pend={};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}};
await new Promise(r=>ws.onopen=r);
const v=await send('Runtime.evaluate',{returnByValue:true,expression:'JSON.stringify({v2errs:window.__v2&&window.__v2().errs,pol:window.__pol&&window.__pol().errs,brief:window.__brief&&{on:window.__brief.on,errs:window.__brief.errs},scene:window.__bf2&&window.__bf2.cur(),cornerOp:getComputedStyle(document.getElementById("corner")).opacity,bf2:typeof window.__bf2Board})'});
console.log(v.result.result.value); ws.close();
