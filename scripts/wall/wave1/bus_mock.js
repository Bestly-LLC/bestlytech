(async()=>{ const n=Date.now(), m=x=>n+x*60000;
  window.__w1Mock={lines:[
    {line:'4',name:'Metro 4',direction:'Eastbound',toward:'',headsign:'',stop:'Santa Monica / La Cienega',walk_min:11,live:true,stale:false,arrivals:[{eta:m(12),live:true,trip:'t4'}]},
    {line:'105',name:'Metro 105',direction:'Southbound',toward:'LAX trips',headsign:'',stop:'La Cienega / Waring',walk_min:8,live:true,stale:false,arrivals:[{eta:m(10),live:true,trip:'t105'}]},
    {line:'10',name:'Metro 10',direction:'Eastbound',toward:'',headsign:'',stop:'Melrose / Orlando',walk_min:3,live:true,stale:false,arrivals:[{eta:m(10),live:true,trip:'t10'}]}],
    alert:{label:'Line 4 detour: Santa Monica Blvd closed at La Brea'}};
  document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black'); window.__w1Home=true; window.__mnOff=true; window.__scHold('bus',0);
  await new Promise(r=>setTimeout(r,2500));
  return JSON.stringify({w1:window.__w1(),v2:window.__v2&&window.__v2().errs});
})()
