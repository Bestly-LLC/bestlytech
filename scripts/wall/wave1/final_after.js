(async()=>{ const wait=ms=>new Promise(r=>setTimeout(r,ms)); document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black');
  const live=await (await fetch('/api/bus',{cache:'no-store'})).json(); const now=Date.now(), real=performance.timeOrigin+performance.now(), shift=now-real;
  const snap=JSON.parse(JSON.stringify(live)); snap.lines.forEach(r=>r.arrivals.forEach(a=>{ a.eta+=shift; }));
  /* live data at a faked 2 PM has no bus near: slide every time so the soonest reachable bus is about to need leaving (real stops, real walk times, real alert if any) */
  let best=null; snap.lines.forEach(r=>{ if(r.line==='105'&&!/LAX/i.test((r.toward||'')+r.direction)) return; if(r.line==='DASH'||r.line==='CityLine') return; const a=r.arrivals[0]; if(a&&(!best||a.eta<best.eta)) best={eta:a.eta,walk:r.walk_min}; });
  const d=best?(now+(best.walk+1)*60000)-best.eta:0; snap.lines.forEach(r=>r.arrivals.forEach(a=>{ a.eta+=d; }));
  window.__w1Mock=snap; window.__w1Home=true;
  await wait(3000);
  return JSON.stringify({w1:window.__w1(),errs:window.__v2().errs,airports:[...document.querySelectorAll('#wingAp .ar')].map(e=>e.innerText.replace(/\n/g,' '))});
})()
