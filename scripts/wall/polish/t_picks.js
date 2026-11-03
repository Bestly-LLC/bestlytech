(async()=>{ const wait=ms=>new Promise(r=>setTimeout(r,ms)); const P=()=>[...document.querySelectorAll('.pick')]; const n=P().length; const out=[];
 for(let k=0;k<n;k++){ P().forEach((p,i)=>p.classList.toggle('on',i===k)); await wait(1700);
   const ps=P(), on=ps[k]; const vis=ps.filter(p=>+getComputedStyle(p).opacity>.02&&getComputedStyle(p).visibility!=='hidden').length;
   const w=on.querySelector('.why'), t=on.querySelector('.text'); const rs=[...on.querySelectorAll('.text,.why')].map(e=>{ const r=e.getBoundingClientRect(); return [e.className,Math.round(r.top),Math.round(r.bottom),e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1]; });
   out.push({k,vis,txt:(t&&t.textContent||'').slice(0,40),why:(w&&w.textContent||'').slice(0,60),wmq:!!(w&&w.querySelector('.wmq-in')),rs}); }
 return JSON.stringify({pol:window.__pol().healed,out}); })()
