(async()=>{ document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black'); const out=[]; const wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(let i=0;i<9;i++){ out.push(JSON.stringify(window.__s3al())); await wait(1700); }
 const b=document.querySelector('#wingAlerts .al'); const hd=document.querySelector('#wingAlerts .al-hd'); const r=b.getBoundingClientRect();
 return JSON.stringify({samples:out,hdW:[hd.scrollWidth,hd.clientWidth],box:[Math.round(r.width),Math.round(r.height)],sh:b.scrollHeight,errs:window.__v2().errs,cerr:window.__citCardErr||null}); })()
