/* ===== CARCARD_20261103: "Cars" page in the center-right rotating slot, right after the Blue Steel / Turo card. Owner Mae (charge planner).
   Data = the wall server /api/cars (Mae's planner table through wall_car_charge_plan, cached 2 min). Hidden when there is no data. Nothing animates at rest. No ellipsis: text shrinks, then wraps whole words.
   The column is 280 px wide on purpose (the TV-shadow mask slants across this slot); wrapper carries class "rings" so avoidMask() zooms instead of clipping.
   Status priority: won't be ready > street sweeping > charge now > charging > on a trip > planned. ===== */
var CCD={on:false,sig:'',st:null,errs:[],err:null,okAt:0,fake:null,fit:0};
(function(){
  const TZ='America/Los_Angeles', NB=' ';
  const css=document.createElement('style'); css.id='carccss';
  css.textContent=`
#cCar{--W:280px;gap:0;}
#cCar .hdr{width:var(--W);}
#cCar .hdr .meta{margin-left:auto;font:600 19px/1 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.74);white-space:nowrap;}
#cCar .cc-wrap.rings{display:flex;flex-direction:column;gap:9px;width:var(--W);margin-top:9px;align-items:stretch;}
#cCar .cc-list{display:flex;flex-direction:column;width:100%;transform-origin:0 0;}
#cCar .cc-car{display:flex;flex-direction:column;gap:7px;width:100%;}
#cCar .cc-list.d1{--ic:46px;--hs:62px;--rs:20px;--nm:23px;--p1:19px;--p2:17px;}
#cCar .cc-list.d2{--ic:34px;--hs:38px;--rs:16px;--nm:20px;--p1:17px;--p2:15.5px;}
#cCar .cc-list.d3{--ic:26px;--hs:30px;--rs:15px;--nm:18px;--p1:15px;--p2:15px;}
#cCar .cc-list.d2 .cc-car{gap:3px;} #cCar .cc-list.d3 .cc-car{gap:2px;}
#cCar .cc-list.d2 .cc-car+.cc-car{margin-top:7px;padding-top:7px;border-top:1px solid rgba(235,235,245,.10);}
#cCar .cc-list.d3 .cc-car+.cc-car{margin-top:5px;padding-top:5px;border-top:1px solid rgba(235,235,245,.10);}
#cCar .cc-top{display:flex;align-items:center;gap:12px;min-height:var(--ic);}
#cCar .cc-ic{position:relative;flex:none;width:var(--ic);height:var(--ic);border-radius:calc(var(--ic)*.32);display:grid;place-items:center;
  background:rgba(235,235,245,.06);box-shadow:inset 0 0 0 1px rgba(235,235,245,.10);color:var(--tint,rgba(235,235,245,.82));}
#cCar .cc-ic svg{width:62%;height:62%;}
#cCar .cc-nm{font:600 var(--nm)/1.08 var(--sf);letter-spacing:-.015em;color:#fff;min-width:0;flex:1 1 0;overflow-wrap:normal;}
#cCar .cc-hero{margin-left:auto;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px;text-align:right;}
#cCar .cc-list.d2 .cc-hero,#cCar .cc-list.d3 .cc-hero{flex-direction:row;align-items:baseline;gap:7px;}
#cCar .cc-hero b{font:800 var(--hs)/.84 "Big Shoulders Display",var(--sf);letter-spacing:0;color:#fff;white-space:nowrap;}
#cCar .cc-hero b small{font:inherit;font-size:.5em;margin-left:2px;opacity:.72;}
#cCar .cc-hero i{font:600 var(--rs)/1.1 var(--sf);font-style:normal;color:rgba(245,245,247,.74);white-space:nowrap;}
#cCar .cc-bar{position:relative;height:5px;border-radius:3px;background:rgba(235,235,245,.13);margin:2px 0 3px;}
#cCar .cc-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--bc,var(--green));
  -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 12px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 12px),transparent);}
#cCar .cc-bar u{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;border-radius:1px;background:rgba(245,245,247,.42);}
#cCar .cc-st{display:flex;align-items:flex-start;gap:9px;color:rgba(255,255,255,.95);}
#cCar .cc-sl{flex:none;width:18px;height:calc(var(--p1)*1.2);display:grid;place-items:center;}
#cCar .cc-sl b{width:9px;height:9px;border-radius:50%;background:var(--sc,var(--green));display:block;}
#cCar .cc-sl svg{width:18px;height:18px;}
#cCar .cc-tx{min-width:0;flex:1 1 0;display:flex;flex-direction:column;gap:1px;}
#cCar .cc-tx .p1{font:600 var(--p1)/1.2 var(--sf);letter-spacing:-.008em;}
#cCar .cc-tx .p2{font:500 var(--p2)/1.2 var(--sf);letter-spacing:-.005em;opacity:.78;}
#cCar .cc-tx .p1,#cCar .cc-tx .p2{white-space:nowrap;}
#cCar .cc-car.st-now .cc-st{color:var(--yellow);} #cCar .cc-car.st-now{--sc:var(--yellow);--bc:var(--yellow);}
#cCar .cc-car.st-wont .cc-st,#cCar .cc-car.st-sweep .cc-st{color:var(--orange);} #cCar .cc-car.st-wont,#cCar .cc-car.st-sweep{--sc:var(--orange);--bc:var(--orange);}
#cCar .cc-car.st-trip .cc-st,#cCar .cc-car.st-stale .cc-st{color:rgba(245,245,247,.72);} #cCar .cc-car.st-trip,#cCar .cc-car.st-stale{--sc:rgba(235,235,245,.45);--bc:rgba(235,235,245,.42);}
#cCar .cc-car.st-now .cc-ic::before{content:"";position:absolute;inset:-9px;border-radius:50%;z-index:-1;pointer-events:none;
  background:radial-gradient(closest-side,rgba(255,214,10,.30),rgba(255,214,10,.10) 62%,rgba(255,214,10,0) 100%);}
#cCar .cc-car.st-now .cc-ic{color:var(--yellow);}
#cCar .cc-ft{display:flex;justify-content:space-between;align-items:baseline;gap:10px;white-space:nowrap;margin-top:1px;}
#cCar .cc-ft span{font:500 16px/1.1 var(--sf);color:rgba(245,245,247,.74);}
#cCar .cc-ft span.sg{font:700 21px/1 var(--sf);letter-spacing:.03em;color:#fff;flex:none;}
body[data-theme="halloween"] #cCar .hdr{color:#7CFC6A!important} body[data-theme="thanksgiving"] #cCar .hdr{color:#A9BF72!important}`;
  document.head.appendChild(css);

  const pt=(iso,o)=>new Date(iso).toLocaleString('en-US',Object.assign({timeZone:TZ},o));
  const nbu=s=>String(s).replace(/[   ](AM|PM|mi|kWh)\b/g,NB+'$1').replace(/\best\. \$/g,'est.'+NB+'$').replace(/\b(Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct) (\d)/g,'$1'+NB+'$2');
  function tm(iso,keepZero){ const m=+pt(iso,{minute:'numeric'}); return nbu(pt(iso,{hour:'numeric',minute:(m||keepZero)?'2-digit':undefined})); }
  const mdt=iso=>nbu(pt(iso,{month:'short',day:'numeric'}));
  const money=n=>'$'+Number(n).toFixed(2);
  const TINT={'Blue Steel':'#8FB6E8'};

  function ccdState(r,st,nowMs){
    const est=r.est_cost!=null?'est. '+money(r.est_cost):'';
    const stn=r.charger_status!=='unknown'&&st&&st.ports_free>0;
    if(r.status==='wont_make'&&r.next_trip_at) return {k:'wont',icon:1,a:'Won’t be ready',b:'for '+tm(r.next_trip_at,true)+' trip'};
    if(r.sweep_due&&nowMs>=Date.parse(r.sweep_due)-12*3600e3&&nowMs<Date.parse(r.sweep_end||r.sweep_due)){
      return nowMs<Date.parse(r.sweep_due)?{k:'sweep',icon:1,a:'Move by '+tm(r.sweep_due,true),b:'street sweeping'}:{k:'sweep',icon:1,a:'Sweeping now',b:'move the car'}; }
    const inWin=r.plan_start&&nowMs>=Date.parse(r.plan_start)&&nowMs<=Date.parse(r.plan_end);
    const now=!r.stale&&r.status!=='stale'&&r.status!=='away'&&(r.charge_now!=null?r.charge_now:(r.home&&!r.plugged_in&&r.soc<(r.target_pct||80)&&stn&&inWin));
    if(now) return {k:'now',a:'Blake charger free',b:'charge now'};
    if(r.status==='charging'||r.charging_state==='Charging')
      return {k:'charge',a:'Charging · full '+tm(r.plan_end),b:nbu(est),c:'Full '+tm(r.plan_end)+(est?' · '+nbu(est):'')};
    if(r.status==='away'){
      if(r.trip_end) return {k:'trip',a:'On a trip',b:'back '+mdt(r.trip_end)+', '+tm(r.trip_end)};
      return {k:'trip',a:'Away from home',b:''}; }
    if(r.stale||r.status==='stale') return {k:'stale',a:'Last seen '+(r.data_at?tm(r.data_at,true):'a while ago'),b:''};
    if(r.status==='ready') return {k:'plan',a:'Ready for the next trip',b:''};
    if(r.plan_start&&r.plan_end) return {k:'plan',a:'Charge '+tm(r.plan_start)+' to '+tm(r.plan_end),b:nbu(est),c:tm(r.plan_start)+' to '+tm(r.plan_end)+(est?' · '+nbu(est):'')};
    return {k:'plan',a:'No charge needed',b:''};
  }
  function ccdErr(w,e){ try{ CCD.errs.push(Date.now()); CCD.err=(w+': '+String((e&&e.message)||e)).slice(0,140); }catch(_){} }
  function ccdEnsure(){ let a=$('#cCar'); if(a) return a; const cards=$('#cards'), t=$('#cTuro'); if(!cards) return null;
    a=document.createElement('article'); a.className='card'; a.id='cCar';
    a.innerHTML='<div class="hdr r" style="--i:0;color:var(--green)"><svg class="sym" viewBox="0 0 24 24"><use href="#i-car"/></svg><span class="app">Cars</span><span class="meta num" id="ccMeta"></span></div>'+
      '<div class="rings cc-wrap r" style="--i:1"><div class="cc-list" id="ccList"></div><div class="cc-ft" id="ccFt"></div></div>';
    cards.insertBefore(a,t?t.nextSibling:null); return a; }
  const over=el=>el.scrollWidth>el.clientWidth+0.5;
  function fit(el,min){ let z=parseFloat(getComputedStyle(el).fontSize); while(over(el)&&z>min){ z-=.5; el.style.fontSize=z+'px'; } return !over(el); }
  function ccdData(){ if(CCD.fake) return CCD.fake; return CCD.st; }
  function ccdRender(force){
    try{
      const d=ccdData(), nowMs=Date.now(); let cars=(d&&d.cars||[]).slice(0,3);
      const newest=cars.reduce((m,r)=>Math.max(m,Date.parse(r.updated_at||r.data_at||0)||0),0);
      if(!CCD.fake&&(!cars.length||(newest&&nowMs-newest>60*60e3)||(CCD.okAt&&nowMs-CCD.okAt>60*60e3))) cars=[];
      if(!cars.length){ CCD.on=false; try{ const c=$('#cCar'); if(c&&!c.classList.contains('on')) c.remove(); }catch(_){} CCD.sig=''; return; }
      const states=cars.map(r=>ccdState(r,d.station,nowMs)), stn=d.station||{}, r0=cars[0];
      const price=r0.price_now!=null?r0.price_now:stn.price_now;
      const sig=JSON.stringify([cars.map(r=>[r.car,Math.round(r.soc),Math.round(r.range_mi),r.target_pct]),states,price,r0.charger_status,stn.ports_free,stn.ports_total]);
      CCD.on=true; if(sig===CCD.sig&&!force&&$('#cCar')) return; CCD.sig=sig;
      const card=ccdEnsure(); if(!card) throw new Error('no #cards');
      const L=$('#ccList'), n=cars.length; L.className='cc-list d'+n; L.style.zoom='';
      L.innerHTML=cars.map((r,i)=>{ const s=states[i], tint=TINT[r.car]||'rgba(235,235,245,.82)';
        const lead=s.icon?'<svg class="sym" viewBox="0 0 24 24"><use href="#i-warn"/></svg>':'<b></b>';
        const bar=n===1?`<div class="cc-bar"><i style="width:${Math.max(2,Math.min(100,r.soc))}%"></i><u style="left:${r.target_pct||80}%"></u></div>`:'';
        const one=s.a+(s.b?' · '+s.b:'');
        const tx=n===3?`<span class="p1" data-c="${esc(s.c||'')}">${esc(one)}</span>`:`<span class="p1">${esc(s.a)}</span>${s.b?`<span class="p2">${esc(s.b)}</span>`:''}`;
        return `<div class="cc-car st-${s.k}" style="--tint:${tint}"><div class="cc-top"><div class="cc-ic"><svg class="sym" viewBox="0 0 24 24"><use href="#i-car"/></svg></div>`+
          `<div class="cc-nm">${esc(r.car)}</div><div class="cc-hero"><b class="num">${Math.round(r.soc)}<small>%</small></b><i class="num">${nbu(Math.round(r.range_mi)+' mi')}</i></div></div>${bar}`+
          `<div class="cc-st"><span class="cc-sl">${lead}</span><div class="cc-tx">${tx}</div></div></div>`; }).join('');
      const cs=r0.charger_status, free=cs==='unknown'?'status unknown':(stn.ports_free!=null?`${stn.ports_free} of ${stn.ports_total} free`:(cs||''));
      $('#ccFt').innerHTML=`<span>Blake charger · ${esc(free)}</span><span class="sg">Mae</span>`;
      $('#ccMeta').textContent=price!=null?'$'+Number(price).toFixed(2)+'/kWh'+NB+'now':'';
      L.querySelectorAll('.cc-nm').forEach(e=>{ e.style.whiteSpace='nowrap'; if(!fit(e,16)) e.style.whiteSpace='normal'; });
      L.querySelectorAll('.cc-tx .p1, .cc-tx .p2').forEach(e=>{
        if(e.dataset.c&&over(e)) e.textContent=e.dataset.c;
        if(!fit(e,n===1?17:14.5)) e.style.whiteSpace='normal'; });
      fit($('#ccFt').firstChild,14);
      const room=card.clientHeight-card.querySelector('.hdr').offsetHeight-9-9-20;
      if(room>0&&L.scrollHeight>room) L.style.zoom=(room/L.scrollHeight).toFixed(3);
      card.querySelectorAll('*').forEach(e=>{ e._amk=''; });
    }catch(e){ ccdErr('render',e); CCD.sig=''; }
  }
  async function ccdPull(){
    try{ const r=await (await fetch('/api/cars',{cache:'no-store'})).json();
      if(r&&Array.isArray(r.cars)){ CCD.st=r; if(r.fetched_at) CCD.okAt=r.fetched_at*1000; if(r.error) CCD.err='feed: '+r.error; else if(CCD.err&&/^feed/.test(CCD.err)) CCD.err=null; } }
    catch(e){ ccdErr('pull',e); }
    ccdRender(); }
  window.ccdOrder=function(o){ try{ if(!CCD.on||!$('#cCar')) return o; const out=o.filter(x=>x!=='cCar'); const i=out.indexOf('cTuro'); out.splice(i<0?0:i+1,0,'cCar'); return out; }catch(e){ ccdErr('order',e); return o; } };
  CCD.hb=function(){ const now=Date.now(); CCD.errs=CCD.errs.filter(t=>now-t<600e3);
    return {on:CCD.on,errs:CCD.errs.length,err:CCD.err,age_s:CCD.okAt?Math.round((now-CCD.okAt)/1000):null,rot:(typeof order!=='undefined'&&order.indexOf('cCar')>=0)}; };
  window.CCD=CCD;
  if(window.W2B&&!W2B._car){ const h0=W2B.hb; W2B.hb=function(){ const o=h0.call(W2B)||{}; try{ o.car=CCD.hb(); }catch(e){} return o; }; W2B._car=1; }
  setInterval(ccdPull,120e3); setTimeout(ccdPull,3000); setTimeout(()=>ccdRender(true),9000); setInterval(()=>ccdRender(),30e3);
  /* test hooks: feed(d) fakes the data, show() pins the Cars page in the rotating slot, release() restores the 9 s rotation */
  window.__ccd={CCD,ccdState,ccdRender,
    feed(d){ CCD.fake=d; CCD.sig=''; ccdRender(true); return {on:CCD.on,errs:CCD.errs.length}; },
    unfeed(){ CCD.fake=null; CCD.sig=''; ccdRender(true); return CCD.on; },
    show(){ try{ clearInterval(cardTimer); }catch(e){} order=buildOrder(); const i=order.indexOf('cCar'); if(i>=0){ ix=i; showCard('cCar'); } return order; },
    release(){ try{ clearInterval(cardTimer); }catch(e){} cardTimer=setInterval(()=>{ if(!alertOn&&curScene==='sBoard') advance(); },9000); return 'released'; }};
})();
/* ===== end CARCARD_20261103 ===== */
