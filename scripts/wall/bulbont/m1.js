(()=>{const W=innerWidth,H=innerHeight;const z=(window.__tgb().zones||[]).map(c=>({x:c.x*W,y:c.y*H,r:c.r*W}));
const R=id=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return {id,l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),op:+getComputedStyle(e).opacity,scn:document.body.dataset.scn}};
return JSON.stringify({W,H,z,rects:['wingFlight','wingKey','wingBus','wingAlerts','wingAp'].map(R),tgb:window.__tgb(),mn:window.__mn&&window.__mn(),sc:window.__sc&&window.__sc(),cls:document.body.className})})()
