(async()=>{ const out={}; const wait=ms=>new Promise(r=>setTimeout(r,ms)); const n=()=>Date.now(), m=x=>n()+x*60000;
  document.body.classList.remove('fx-hw','fx-hs','fx-hk','w2-fxi','black'); window.__w1Home=true;
  const L=(line,stop,dir,walk,arr,extra)=>Object.assign({line:line,name:'Metro '+line,direction:dir,toward:line==='105'?'LAX trips':'',headsign:'',stop:stop,walk_min:walk,live:true,stale:false,arrivals:arr},extra||{});
  // (c1) leave-now bus vs normal plane card
  window.__w1Mock={lines:[L('10','Melrose / Orlando','Eastbound',3,[{eta:m(3.5),live:true,trip:'a1'}])]};
  await wait(1600); const mn1=window.__mn(); out.c1={hold:mn1.hold,w1:window.__w1().leaveNow,fl:document.body.classList.contains('fl-on')};
  // (c2) bus within 20 min but nothing to leave for yet: plane card keeps the slot
  window.__w1Mock={lines:[L('10','Melrose / Orlando','Eastbound',3,[{eta:m(14),live:true,trip:'a2'}])]};
  await wait(1600); const mn2=window.__mn(); out.c2={hold:mn2.hold,w1:window.__w1().leaveNow,bus:document.body.classList.contains('bus-on')};
  // (c3) bus farther than 20 min: no card at all
  window.__w1Mock={lines:[L('10','Melrose / Orlando','Eastbound',3,[{eta:m(31),live:true,trip:'a3'}])]};
  await wait(1600); out.c3={bus:document.body.classList.contains('bus-on'),hold:window.__mn().hold};
  // (a) missed leave-by: first bus can't be caught (2 min away, 3 min walk) -> next bus on the line; and a faster other line
  window.__w1Mock={lines:[L('10','Melrose / Orlando','Eastbound',3,[{eta:m(2),live:true,trip:'b1'},{eta:m(20),live:true,trip:'b2'}]),L('4','Santa Monica / La Cienega','Eastbound',11,[{eta:m(13),live:true,trip:'c1'}])]};
  await wait(1600); const w=window.__w1(); out.a={rows:w.rows,bus:w.bus};
  // (b+d) stale feed + crowding: scheduled rows and a seats glyph on a live row
  window.__w1Mock={lines:[L('4','Santa Monica / La Cienega','Eastbound',14,[{eta:m(16),live:false,trip:'s1'}],{live:false,stale:true}),L('105','La Cienega / Waring','Southbound',8,[{eta:m(12),live:true,trip:'s2',occ:'standing'}]),L('10','Melrose / Orlando','Eastbound',4,[{eta:m(9),live:true,trip:'s3',occ:'seats'}]),
    {line:'CityLine',name:'WeHo CityLine',direction:'Westbound',toward:'',headsign:'',stop:'800 N. Kings Road',walk_min:3,live:true,stale:false,arrivals:[{eta:m(7),live:true,trip:'w1'}]}],alert:{label:'Line 10 detour: Melrose Ave closed at Fairfax'}};
  window.__mnOff=true; window.__scHold('bus',0); await wait(2000);
  out.b={rows:window.__w1().rows,text:[...document.querySelectorAll('#wingBus .w1-r')].map(r=>r.innerText.replace(/\n/g,' | '))};
  return JSON.stringify(out);
})()
