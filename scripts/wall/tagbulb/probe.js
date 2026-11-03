(()=>{ const T=window.__tgb&&window.__tgb(); const W=innerWidth,H=innerHeight; const Z=(T&&T.zones||[]).map(c=>[c.x*W,c.y*H,c.r*W]);
 const hit=(r,m)=>Z.some(([x,y,rr])=>{const nx=Math.max(r.left,Math.min(x,r.right)),ny=Math.max(r.top,Math.min(y,r.bottom));return Math.hypot(nx-x,ny-y)<rr+m});
 const q=[...document.querySelectorAll('#airPlanes .tag.show')].map(t=>{const r=t.getBoundingClientRect(),cs=getComputedStyle(t);return {txt:t.innerText.split('\n')[0],op:cs.opacity,skx:t.classList.contains('skx'),hit:hit(r,0),dy:t.style.getPropertyValue('--tgdy'),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}});
 const e=[...document.querySelectorAll('#airPlanes .v2e .in,#airPlanes .apl .in')].map(t=>{const r=t.getBoundingClientRect();return {txt:t.innerText.replace(/\n/g,' '),hit:hit(r,0),hid:t.closest('.tgbh')?1:0}});
 return {Z,tags:q,pills:e,tgb:T,errs:window.__v2&&window.__v2().errs,w:W,h:H}; })()
