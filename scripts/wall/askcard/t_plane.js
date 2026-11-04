(async()=>{ document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black'); const wait=ms=>new Promise(r=>setTimeout(r,ms));
 window.__S3L=window.__PLSET||['Fly Kilo Charlie LLC','Fly Kilo Charlie LLC']; await wait(9000); window.__mnOff=true; window.__scHold('flight'); await wait(4000);
 const wf=document.getElementById('wingFlight'), c=wf.firstElementChild, r=c.getBoundingClientRect(), fl=wf.querySelector('.v2fl'), sub=wf.querySelector('.v2sub');
 const kids=[...c.children].filter(e=>getComputedStyle(e).display!=='none'&&getComputedStyle(e).position!=='absolute'); const lastB=Math.max(...kids.map(e=>e.getBoundingClientRect().bottom));
 const cs=getComputedStyle(c);
 return JSON.stringify({bbn:wf.classList.contains('bbn'),fl:fl&&fl.textContent,sub:sub&&[sub.textContent,getComputedStyle(sub).display],card:[r.left,r.top,r.right,r.bottom].map(Math.round),h:cs.height,pb:cs.paddingBottom,gapBelowContent:Math.round(r.bottom-lastB),v2:window.__v2().errs,E:window.__E,ask:window.__ask&&window.__ask()}); })()
