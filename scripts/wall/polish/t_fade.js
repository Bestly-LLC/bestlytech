(async()=>{ const wait=ms=>new Promise(r=>setTimeout(r,ms)); const P=()=>[...document.querySelectorAll('.pick')];
 const set=k=>{ P().forEach((p,i)=>p.classList.toggle('on',i===k)); };
 const op=()=>P().map(p=>+(+getComputedStyle(p).opacity).toFixed(2));
 const res=[]; for(const [a,b] of [[1,2],[2,4],[4,5]]){ set(a); await wait(1800); set(b); const s=[]; for(let i=0;i<26;i++){ await wait(50); s.push(op()); }
   let both=0, maxPair=0, minSum=9; s.forEach(o=>{ const hi=o.filter(v=>v>.3).length; if(hi>1) both++; const sorted=[...o].sort((x,y)=>y-x); maxPair=Math.max(maxPair,sorted[0]+sorted[1]); minSum=Math.min(minSum,o.reduce((x,y)=>x+y,0)); });
   await wait(800); res.push({from:a,to:b,framesTwoOver30:both,maxTwoSum:+maxPair.toFixed(2),minTotal:+minSum.toFixed(2),rest:op()}); }
 return JSON.stringify(res); })()
