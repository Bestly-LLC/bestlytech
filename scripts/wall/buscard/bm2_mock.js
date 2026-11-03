(async()=>{ const wait=ms=>new Promise(r=>setTimeout(r,ms)); document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black');
  const live=await (await fetch('/api/bus',{cache:'no-store'})).json(); const n=Date.now(), m=x=>n+x*60000;
  const pick=(line,dir)=>live.lines.find(r=>r.line===line&&String(r.dir_id)===String(dir));
  const ft=(a,b)=>Math.hypot((a[0]-b[0])*364000,(a[1]-b[1])*364000*Math.cos(34.08*Math.PI/180));
  /* line 10 eastbound approaching Melrose / Orlando in the leave-now window (arrives in 4 min = walk 4 min); line 105 toward LAX (southbound) 11 min out */
  const spec=[['10','0','m10',4.6,3800],['105','1','m105',11,7500]];
  const lines=[], vehicles=[];
  spec.forEach(([ln,d,trip,arr,back])=>{ const r=JSON.parse(JSON.stringify(pick(ln,d))); const eta=m(arr); r.arrivals=[{eta:eta,live:true,trip:trip}]; r.live=true; r.stale=false; lines.push(r);
    const rt=live.routes[ln+':'+d]; let bi=0,bd=1e9; rt.forEach((p,i)=>{ const dd=ft(p,[r.stop_lat,r.stop_lon]); if(dd<bd){ bd=dd; bi=i; } });
    let acc=0,i=bi; while(i>0&&acc<back){ acc+=ft(rt[i],rt[i-1]); i--; } const a=rt[i], b=rt[Math.min(i+1,rt.length-1)];
    const brg=(Math.atan2((b[1]-a[1])*Math.cos(34.08*Math.PI/180),(b[0]-a[0]))*180/Math.PI+360)%360;
    vehicles.push({id:'v'+trip,line:ln,agency:'metro',direction:r.direction,dir_id:d,lat:a[0],lng:a[1],bearing:Math.round(brg),mph:12,trip_id:trip,stop_eta:eta}); });
  /* distractors that must NOT be drawn: 10 westbound, a CityLine bus, the 105 northbound */
  const rt10=live.routes['10:1']; vehicles.push({id:'x1',line:'10',agency:'metro',direction:'Westbound',dir_id:'1',lat:rt10[40][0],lng:rt10[40][1],bearing:270,mph:15,trip_id:'zz',stop_eta:null});
  vehicles.push({id:'x2',line:'CityLine',agency:'weho',direction:'Eastbound',lat:34.0905,lng:-118.3745,bearing:90,mph:10,trip_id:null,stop_eta:null});
  window.__w1Mock={lines:lines,vehicles:vehicles,routes:live.routes,walks:live.walks,alert:null}; window.__w1Home=true; window.__mnOff=true; window.__scHold('bus',0);
  await wait(3500);
  return JSON.stringify({bm2:window.__bm2(),veh:vehicles.map(v=>[v.id,v.line,Math.round((v.stop_eta-Date.now())/60000)]),v2:window.__v2().errs});
})()
