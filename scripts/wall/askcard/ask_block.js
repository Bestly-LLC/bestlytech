/* ===== ASKCARD_20261103: "Ask the wall" answer card in the center-right rotating slot (#cards), built from ask_card_proto.js (approved).
   Data: the Mac answerer pushes each finished wall_questions answer to POST /api/ask on this Pi; the page polls GET /api/ask (same row the prototype took: question, answer_text, answer_card{subject{type,id},ttl_s}).
   Question small, answer big (no detail lines), pink feathered focus ring on the plane it is about, shows ~20 s then fades. Also: plane card gap + duplicate operator line (see v2Card patch + css below). ===== */
(function(){
  const NB=' ', AK={errs:0,err:null,seen:null,okAt:0,on:false,t:null,t2:null,obs:null,shown:0,last:null};
  const css=document.createElement('style'); css.id='askcss';
  css.textContent=`
#cAsk{--W:280px;gap:0;transition:opacity .9s ease;}
#cAsk.as-out{opacity:0!important;}
#cAsk .hdr{width:var(--W);}
#cAsk .hdr .meta{font:600 19px/1 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.74);white-space:nowrap;}
#cAsk .as-wrap.rings{display:flex;flex-direction:column;gap:8px;width:var(--W);margin-top:8px;align-items:stretch;transform-origin:0 0;}
#cAsk .as-q{flex:none;font:500 16px/1.2 var(--sf);letter-spacing:-.005em;color:rgba(245,245,247,.62);font-style:italic;overflow-wrap:normal;}
#cAsk .as-a{flex:none;font:700 40px/1.06 var(--sf);letter-spacing:-.022em;color:#fff;overflow-wrap:normal;}
.ac .askring{position:absolute;left:50%;top:50%;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;pointer-events:none;z-index:3;opacity:0;transition:opacity .9s ease;
  background:radial-gradient(closest-side,rgba(255,55,95,0) 52%,rgba(255,55,95,.6) 68%,rgba(255,55,95,.24) 82%,rgba(255,55,95,0) 100%);}
.ac .askring.on{opacity:1;}
/* plane card (sign wall): the card is only as tall as its content, so no empty gap under the stats; notable/emergency keep a strip for the Sky Sync signature */
body #wingFlight .ft.v2c{height:auto!important;min-height:0!important;max-height:468px}
body #wingFlight .ft.v2c.nt,body #wingFlight .ft.v2c.sos{padding-bottom:50px!important}
`;
  document.head.appendChild(css);
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const nbu=s=>String(s).replace(/(\d) (AM|PM|mi|ft|feet|miles?|mph|minutes?|min|degrees|percent)\b/g,'$1'+NB+'$2');
  const clock=()=>new Date().toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).replace(/ /g,NB);
  const g=id=>document.getElementById(id);
  function akErr(w,e){ AK.errs++; AK.err=(w+': '+String((e&&e.message)||e)).slice(0,140); }
  function ensure(){ let el=g('cAsk'); if(el) return el; const cards=g('cards'); if(!cards) return null;
    el=document.createElement('article'); el.className='card'; el.id='cAsk';
    el.innerHTML='<div class="hdr r" style="--i:0;color:var(--blue)"><svg class="sym" viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.2a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 0 0-6.4 0V12a3.2 3.2 0 0 0 3.2 3.2Zm5.6-3.4a.9.9 0 0 0-1.8 0 3.8 3.8 0 0 1-7.6 0 .9.9 0 0 0-1.8 0 5.6 5.6 0 0 0 4.7 5.5v1.7H9.9a.9.9 0 0 0 0 1.8h4.2a.9.9 0 0 0 0-1.8h-1.6v-1.7a5.6 5.6 0 0 0 5.1-5.5Z"/></svg><span class="app">Ask the wall</span><span class="meta num" id="asMeta"></span></div>'+
      '<div class="as-wrap rings r" style="--i:1"><div class="as-q" id="asQ"></div><div class="as-a" id="asA"></div></div>';
    cards.appendChild(el); return el; }
  const sentences=t=>t.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g)||[t];
  /* answer fit: prefer the biggest type. Candidates = the full text, then fewer whole sentences; each gets its biggest fitting size (40 down to 22).
     First candidate that reaches 28 wins, else the first that reaches 24 (keeps more words), else the biggest size found, else trailing whole words. Never clipped, never an ellipsis. */
  function fitAnswer(card){
    const a=g('asA'), q=g('asQ'), full=a._full||'';
    const room=()=>card.clientHeight-card.querySelector('.hdr').offsetHeight-8-8-q.offsetHeight-8;
    const best=txt=>{ a.innerHTML=nbu(esc(txt)); for(let fs=40;fs>=22;fs-=1){ a.style.fontSize=fs+'px'; if(a.scrollHeight<=room()+1) return fs; } return 0; };
    const ss=sentences(full).map(s=>s.trim()).filter(Boolean), cands=[full]; for(let n=ss.length-1;n>=1;n--) cands.push(ss.slice(0,n).join(' '));
    const fz=cands.map(best); let k=fz.findIndex(f=>f>=28); if(k<0) k=fz.findIndex(f=>f>=24); if(k<0){ const m=Math.max.apply(null,fz); k=m>0?fz.indexOf(m):-1; }
    if(k>=0){ best(cands[k]); return; }
    const w=(ss[0]||full).split(' '); while(w.length>1){ w.pop(); if(best(w.join(' '))) return; }
  }
  function fitQuestion(q,txt){ const w=txt.split(' '); const set=()=>{ q.textContent='“'+w.join(' ')+'”'; };
    set(); const lh=parseFloat(getComputedStyle(q).lineHeight)||19; while(w.length>1&&q.scrollHeight>lh*2+2){ w.pop(); set(); } }
  function pickEl(subject){ try{ if(!subject||subject.type!=='aircraft'||!subject.id||typeof AIRS==='undefined') return null; const h=String(subject.id).toLowerCase(); const o=AIRS[h]||AIRS['~'+h]; return (o&&!o.gone&&o.el)?o.el:null; }catch(e){ akErr('pick',e); return null; } }
  function ring(subject,on){ document.querySelectorAll('.ac .askring').forEach(r=>{ r.classList.remove('on'); setTimeout(()=>r.remove(),1000); });
    if(!on) return 'off'; const el=pickEl(subject); if(!el) return subject?'no-plane-on-sky':'no-subject'; const r=document.createElement('i'); r.className='askring'; el.appendChild(r); requestAnimationFrame(()=>r.classList.add('on')); return 'ring'; }
  function render(row){ const card=ensure(); if(!card) throw new Error('no #cards'); const c=row.answer_card||{};
    g('asMeta').textContent=clock(); const a=g('asA'); a._full=String(row.answer_text||'').trim();
    card.classList.remove('as-out'); fitQuestion(g('asQ'),String(row.question||'').trim()); fitAnswer(card); return ring(c.subject,true); }
  function release(){ try{ if(AK.obs){ AK.obs.disconnect(); AK.obs=null; } AK.on=false; ring(null,false);
      clearInterval(cardTimer); cardTimer=setInterval(()=>{ if(!alertOn&&curScene==='sBoard') advance(); },9000); advance(); }catch(e){ akErr('release',e); } }
  function show(row,age){ try{
      const res=render(row), cards=g('cards'), ttl=Math.max(6,Math.min(30,(+(row.answer_card&&row.answer_card.ttl_s)||20)-(age||0)));
      clearTimeout(AK.t); clearTimeout(AK.t2); if(AK.obs){ AK.obs.disconnect(); AK.obs=null; }
      clearInterval(cardTimer); order=buildOrder(); order=['cAsk'].concat(order.filter(x=>x!=='cAsk')); ix=0; showCard('cAsk'); AK.on=true; AK.shown++; AK.last=row.id;
      let busy=false; const apply=()=>{ if(busy||!AK.on) return; busy=true; cards.querySelectorAll('.card').forEach(c=>{ const on=c.id==='cAsk'; if(c.classList.contains('on')!==on) c.classList.toggle('on',on); }); busy=false; };
      AK.obs=new MutationObserver(apply); AK.obs.observe(cards,{subtree:true,attributes:true,attributeFilter:['class']});
      AK.t=setTimeout(()=>{ const c=g('cAsk'); if(c) c.classList.add('as-out'); ring(null,false); AK.t2=setTimeout(release,1000); },ttl*1000);
      return res; }catch(e){ akErr('show',e); return 'err'; } }
  async function poll(){ try{ const r=await (await fetch('/api/ask',{cache:'no-store'})).json(); AK.okAt=Date.now();
      if(r&&r.id&&r.id!==AK.seen){ const age=(r.age_s==null)?99:r.age_s;
        if(age>=25){ AK.seen=r.id; }
        else if(!alertOn&&curScene==='sBoard'){ AK.seen=r.id; show(r,age); } } }catch(e){ akErr('poll',e); } }
  AK.hb=()=>({on:AK.on,errs:AK.errs,err:AK.err,shown:AK.shown,age_s:AK.okAt?Math.round((Date.now()-AK.okAt)/1000):null});
  if(window.W2B&&!W2B._ask){ const h0=W2B.hb; W2B.hb=function(){ const o=h0.call(W2B)||{}; try{ o.ask=AK.hb(); }catch(e){} return o; }; W2B._ask=1; }
  setInterval(poll,1500); setTimeout(poll,2500);
  window.ASKCARD={AK,show:(row,age)=>show(row,age||0),render,release,ring,fitAnswer};
  window.__ask=()=>AK.hb();
})();
/* ===== end ASKCARD_20261103 ===== */
