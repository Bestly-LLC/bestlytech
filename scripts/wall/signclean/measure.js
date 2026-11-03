(async()=>{
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function M(el){ const t=el.style.transform; const m=(t.match(/matrix3d\(([^)]*)\)/)||[])[1]; return m?m.split(',').map(Number):null; }
function P(m,x,y){ const w=m[3]*x+m[7]*y+m[15]; return [(m[0]*x+m[4]*y+m[12])/w,(m[1]*x+m[5]*y+m[13])/w]; }
function scales(el){ const m=M(el); if(!m) return {sx:0.55,sy:0.6}; const W=el.offsetWidth,H=el.offsetHeight; let sx=9,sy=9;
  [[0,0],[W,0],[0,H],[W,H],[W/2,H/2]].forEach(([x,y])=>{ const a=P(m,x,y),b=P(m,x+1,y),c=P(m,x,y+1); sx=Math.min(sx,Math.hypot(b[0]-a[0],b[1]-a[1])); sy=Math.min(sy,Math.hypot(c[0]-a[0],c[1]-a[1])); }); return {sx,sy}; }
function scan(card,label){ const sc=scales(card), eff=Math.min(sc.sx,sc.sy); const saved=card.style.transform; card.style.transform='none'; const base=card.getBoundingClientRect();
  const leaves=[]; const w=document.createTreeWalker(card,NodeFilter.SHOW_TEXT); let n; const seen=new Set();
  while(n=w.nextNode()){ if(!n.textContent.trim()) continue; const e=n.parentElement; if(seen.has(e)) continue; seen.add(e); const cs=getComputedStyle(e); const r=e.getBoundingClientRect(); if(r.width<1||r.height<1||cs.visibility==='hidden'||cs.display==='none') continue;
    const col=cs.color.match(/[\d.]+/g).map(Number); const a=col.length>3?col[3]:1; const lum=(col[0]+col[1]+col[2])/3;
    const clip=(cs.overflow!=='visible'&&e.scrollWidth>e.clientWidth+1);
    leaves.push({e:e,t:n.textContent.trim().slice(0,28),fs:parseFloat(cs.fontSize),fw:+cs.fontWeight,a:+(a).toFixed(2),lum:Math.round(lum),r:[r.left,r.top,r.right,r.bottom],clip,ell:cs.textOverflow==='ellipsis'}); }
  let over=[]; for(let i=0;i<leaves.length;i++) for(let j=i+1;j<leaves.length;j++){ const A=leaves[i].r,B=leaves[j].r; const ox=Math.min(A[2],B[2])-Math.max(A[0],B[0]), oy=Math.min(A[3],B[3])-Math.max(A[1],B[1]); if(ox>2&&oy>2&&!leaves[i].e.contains(leaves[j].e)&&!leaves[j].e.contains(leaves[i].e)) over.push(leaves[i].t+' | '+leaves[j].t); }
  const cardR=card.getBoundingClientRect(); const outside=leaves.filter(l=>l.r[2]>base.left+card.offsetWidth+1||l.r[3]>base.top+card.offsetHeight+1||l.r[0]<base.left-1||l.r[1]<base.top-1).map(l=>l.t);
  card.style.transform=saved;
  const mn=leaves.reduce((a,l)=>l.fs<a.fs?l:a,{fs:999});
  return {label,n:leaves.length,minCss:mn.fs,minText:mn.t,eff:+(mn.fs*eff).toFixed(1),sx:+sc.sx.toFixed(3),sy:+sc.sy.toFixed(3),minW:Math.min(...leaves.map(l=>l.fw)),minAlpha:Math.min(...leaves.map(l=>l.a)),minLum:Math.min(...leaves.map(l=>l.lum)),clipped:leaves.filter(l=>l.clip).map(l=>l.t),ell:leaves.filter(l=>l.ell).length,overlaps:over,outside,under18:leaves.filter(l=>l.fs*eff<17.9).map(l=>l.t+':'+l.fs)}; }
const out=[];
const fl=document.getElementById('wingFlight'); if(fl&&fl.querySelector('.ft')) out.push(scan(fl,'flight'));
for(const p of [0,1,2]){ window.__scHold('key',p); await sleep(900); out.push(scan(document.getElementById('wingKey'),'key'+p)); }
window.__scHold('bus',0); await sleep(900); const b=document.getElementById('wingBus'); if(b) out.push(scan(b,'bus'));
window.__scHold(null);
return JSON.stringify(out,null,0);
})()
