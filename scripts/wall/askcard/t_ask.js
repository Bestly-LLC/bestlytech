(async()=>{ document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black'); const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const tl=[]; const t0=Date.now(); let shownAt=0, fadedAt=0, goneAt=0;
 for(let i=0;i<150;i++){ const a=window.__ask(), c=document.getElementById('cAsk'); const op=c?+getComputedStyle(c).opacity:null, on=c&&c.classList.contains('on');
   if(a.shown>0&&!shownAt){ shownAt=Date.now(); await wait(2500); const r=c.getBoundingClientRect(), A=document.getElementById('asA'), Q=document.getElementById('asQ'), ring=document.querySelectorAll('.ac .askring');
     window.__SNAP={card:[r.left,r.top,r.right,r.bottom].map(Math.round),q:Q.textContent,a:A.textContent,fs:A.style.fontSize,aOverflow:A.scrollHeight>A.clientHeight+1,hdr:c.querySelector('.hdr').textContent,rings:ring.length,ringOn:[...ring].map(x=>x.classList.contains('on')),cls:c.className,ask:window.__ask()};
     return JSON.stringify({snap:window.__SNAP,E:window.__E}); }
   await wait(500); }
 return JSON.stringify({timeout:true,ask:window.__ask(),E:window.__E}); })()
