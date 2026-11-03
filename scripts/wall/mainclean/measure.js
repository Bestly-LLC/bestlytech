(()=>{ const out={}; const vis=e=>{ let p=e; while(p&&p!==document.body){ const c=getComputedStyle(p); if(c.display==='none'||c.visibility==='hidden'||+c.opacity<.05) return false; p=p.parentElement; } return true; };
 const leaves=root=>[...root.querySelectorAll('*')].filter(e=>vis(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.getBoundingClientRect().width>0);
 const roots={ slot:null, alerts:'#wingAlerts .al', airports:'#wingAp .apc', clockline:'#board .left .next', focus:'#picks .pick.on', turo:'#cTcal.on' };
 const sc=document.body.dataset.scn; roots.slot=sc==='flight'?'#wingFlight .ft':sc==='key'?'#wingKey .sck':sc==='bus'?'#wingBus .v2bus':null;
 const rects={};
 for(const [k,sel] of Object.entries(roots)){ if(!sel){ out[k]=null; continue; } const r=document.querySelector(sel); if(!r){ out[k]='absent'; continue; } const rr=r.getBoundingClientRect(); rects[k]=[rr.left,rr.top,rr.right,rr.bottom].map(Math.round);
   let min=999, minTxt='', clipped=[], ell=[], items=0; leaves(r).forEach(e=>{ items++; const c=getComputedStyle(e), fs=parseFloat(c.fontSize); if(fs<min){ min=fs; minTxt=e.textContent.trim().slice(0,30); }
     const t=e.textContent; if(/…|\.\.\./.test(t)) ell.push(t.slice(0,30)); if(c.textOverflow==='ellipsis'&&e.scrollWidth>e.clientWidth+1) ell.push('css:'+t.slice(0,30));
     const ovf=c.overflow!=='visible'||c.overflowX!=='visible'; if(ovf&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)) clipped.push(t.trim().slice(0,30)+' '+e.scrollWidth+'x'+e.scrollHeight+'/'+e.clientWidth+'x'+e.clientHeight); });
   // card-level overflow
   const cc=r; if(cc.scrollHeight>cc.clientHeight+1&&getComputedStyle(cc).overflow!=='visible') clipped.push('CARD '+cc.scrollHeight+'/'+cc.clientHeight);
   out[k]={rect:rects[k],minFontCss:min,minTxt,items,clipped,ellipsis:ell}; }
 const ks=Object.keys(rects), ov=[]; for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++){ const a=rects[ks[i]], b=rects[ks[j]]; if(a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3]) ov.push(ks[i]+'x'+ks[j]); }
 out.overlaps=ov; out.scn=sc; out.errs=window.V2&&V2.errs; out.mn=window.__mn&&window.__mn();
 out.allEllipsisCss=[...document.querySelectorAll('body *')].filter(e=>getComputedStyle(e).textOverflow==='ellipsis'&&vis(e)&&e.scrollWidth>e.clientWidth+1).map(e=>e.className+':'+e.textContent.slice(0,25)).slice(0,10);
 return out; })()
