const list = await (await fetch('http://127.0.0.1:47333/json')).json();
const pg = list.find(t => t.type === 'page' && /18099/.test(t.url));
const ws = new WebSocket(pg.webSocketDebuggerUrl); let id=0; const pend={};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}};
await new Promise(r=>ws.onopen=r);
await send('Runtime.evaluate',{expression:'location.reload()'}); await new Promise(r=>setTimeout(r,500)); ws.close(); console.log('reloaded',pg.url);
