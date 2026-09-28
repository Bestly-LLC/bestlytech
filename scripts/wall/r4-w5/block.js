
  /* ================= W5 round 4 (Claude 2026-09-28): live signatures, Motivate me, fresh-air takeover, UFO skit =================
     Plan: docs/wall-round4-2026-09-28-opusplan.md (W5). Everything here is additive: the old sign-wall functions only gained a
     one-line prefix that hands off to w5Render / w5Hero / w5Emos, and fall back to the old code if this block ever throws. */
  var W5S={on:true,err:null,lay:null,key:'',els:new Map(),pend:new Set(),rw:{i:0,next:0,active:0,order:[]},shown:0,renderErr:0,heroTok:0,writes:0,landed:0};
  function w5Fail(e){ try{ W5S.err=String((e&&e.message)||e).slice(0,140); W5S.renderErr++; if(W5S.renderErr>=6) W5S.on=false; }catch(_){} }
  /* ---------- signature geometry + timing ---------- */
  function w5Box(s){ let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    (s.strokes||[]).forEach(st=>{ for(let i=0;i+1<st.length;i+=2){ x0=Math.min(x0,st[i]); x1=Math.max(x1,st[i]); y0=Math.min(y0,st[i+1]); y1=Math.max(y1,st[i+1]); } });
    if(x1<x0){ x0=0; y0=0; x1=200; y1=80; }
    const w=Math.max(60,x1-x0), h=Math.max(34,y1-y0), pad=Math.max(w,h)*.05, cx=(x0+x1)/2, cy=(y0+y1)/2;
    return {x:cx-w/2-pad,y:cy-h/2-pad,w:w+pad*2,h:h+pad*2}; }
  function w5Svg(s,bx){ return `<svg viewBox="${bx.x.toFixed(0)} ${bx.y.toFixed(0)} ${bx.w.toFixed(0)} ${bx.h.toFixed(0)}" preserveAspectRatio="xMidYMid meet"><g class="b">`+
      (s.strokes||[]).map(st=>`<path d="${sigPath(st)}" pathLength="1"/>`).join('')+`</g></svg>`; }
  // per stroke: when each point was drawn (ms from the first touch) + how far along the stroke it is. Old signatures have no
  // timing, so they get a plausible hand speed (0.8 units/ms, 220 ms between strokes) and still write themselves along their path.
  function w5Times(s){ const st0=s.strokes||[], tt=Array.isArray(s.times)&&s.times.length===st0.length?s.times:null, out=[]; let clock=0;
    st0.forEach((st,i)=>{ const n=st.length>>1; if(n<1){ out.push({t0:clock,t1:clock,L:1,cum:[0],ts:[clock]}); return; } const cum=[0];
      for(let k=1;k<n;k++) cum.push(cum[k-1]+Math.hypot(st[2*k]-st[2*k-2],st[2*k+1]-st[2*k-1]));
      let ts=tt&&Array.isArray(tt[i])&&tt[i].length===n?tt[i].map(Number):null; if(ts&&ts.some(v=>!isFinite(v))) ts=null;
      if(!ts){ const start=clock+(i?220:0); ts=cum.map(c=>start+c/.8); }
      for(let k=1;k<n;k++) if(ts[k]<ts[k-1]) ts[k]=ts[k-1];
      clock=ts[n-1]; out.push({t0:ts[0],t1:ts[n-1],L:cum[n-1]||1,cum,ts}); });
    const base=out.length?Math.min(...out.map(o=>o.t0)):0; out.forEach(o=>{ o.t0-=base; o.t1-=base; o.ts=o.ts.map(v=>v-base); });
    return out; }
  // long thinking pauses between strokes are shortened so the replay stays lively (the strokes themselves keep their real speed)
  function w5Compress(tl,maxGap){ const ord=tl.map((o,i)=>i).sort((a,b)=>tl[a].t0-tl[b].t0); let shift=0, end=null;
    ord.forEach(i=>{ const o=tl[i]; o.t0-=shift; o.t1-=shift; o.ts=o.ts.map(v=>v-shift);
      if(end!=null&&o.t0-end>maxGap){ const d=o.t0-end-maxGap; shift+=d; o.t0-=d; o.t1-=d; o.ts=o.ts.map(v=>v-d); }
      end=end==null?o.t1:Math.max(end,o.t1); }); return tl; }
  // write the strokes on at the speed they were drawn (WAAPI dash offset keyframes); returns how long it takes (ms)
  function w5Write(root,tl,maxMs,d0){ const paths=[...root.querySelectorAll('path')], total=Math.max(1,...tl.map(o=>o.t1)); let k=1; if(maxMs&&total>maxMs) k=maxMs/total; d0=d0||0;
    paths.forEach((p,i)=>{ const o=tl[i]; if(!o) return; const n=o.ts.length, span=Math.max(1,o.t1-o.t0), step=Math.max(1,Math.ceil(n/22)), idx=[];
      for(let j=0;j<n;j+=step) idx.push(j); if(idx[idx.length-1]!==n-1) idx.push(n-1);
      let last=0; const fr=idx.map(j=>{ let off=Math.max(last,Math.min(1,(o.ts[j]-o.t0)/span)); last=off; return {strokeDashoffset:(1-o.cum[j]/o.L).toFixed(4),offset:off}; });
      fr[0].offset=0; fr[fr.length-1].offset=1; if(fr.length<2) fr.push({strokeDashoffset:'0',offset:1});
      p.style.strokeDasharray='1 2'; p.style.strokeDashoffset='1';
      try{ const a=p.animate(fr,{duration:Math.max(70,span*k),delay:d0+o.t0*k,fill:'both',easing:'linear'});
        a.onfinish=()=>{ p.style.strokeDashoffset='0'; try{ a.cancel(); }catch(e){} }; }catch(e){ p.style.strokeDashoffset='0'; } });
    W5S.writes++; return d0+total*k; }
  /* ---------- graffiti layout: random spot + slight tilt per signature, stable for a given set; sizes follow the count ---------- */
  function w5Rng(seed){ let a=(seed>>>0)||1; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function w5Ov(a,b,pad){ const x=Math.min(a[2]+pad,b[2])-Math.max(a[0]-pad,b[0]), y=Math.min(a[3]+pad,b[3])-Math.max(a[1]-pad,b[1]); return x>0&&y>0?x*y:0; }
  // keep-out boxes (wing px): the plant + the neon LED sign (C6-C7). W8 publishes the traced sign box as window.W8_KEEPOUT
  // ([[x0,y0,x1,y1],...] in wing px, or a function returning that); until then the old hand-measured neon box is used.
  // (W8 also moves WING_AVOID's neon entry onto the traced sign; window.LEDSIGN_BOX.wing is added too in case it doesn't overlap)
  function w5Keep(){ const ok=b=>Array.isArray(b)&&b.length===4&&b.every(v=>typeof v==='number'&&isFinite(v)); let out=WING_AVOID.filter(ok);
    try{ const lb=window.LEDSIGN_BOX; if(lb&&ok(lb.wing)) out=out.concat([lb.wing]); }catch(e){}
    try{ const k=typeof window.W8_KEEPOUT==='function'?window.W8_KEEPOUT():window.W8_KEEPOUT; if(Array.isArray(k)) out=out.concat(k.filter(ok)); }catch(e){}
    return out.map(b=>[b[0]-12,b[1]-12,b[2]+12,b[3]+12]); }
  addEventListener('ledsign:box',()=>{ try{ W5S.key=''; if(!heroBusy) renderSigs(); }catch(e){} });
  function w5Layout(list,emos){
    const top=sigTop()+8, L=24, R=WW-20, B=WH-16, W=R-L, H=B-top, keep=w5Keep();
    const key=list.map(s=>s.id).join(',')+'|'+emos.map(e=>e.id).join(',')+'|'+top+'|'+keep.map(b=>b.map(Math.round).join(':')).join(';');
    if(W5S.lay&&W5S.key===key) return W5S.lay;
    const n=list.length, items=list.map(s=>{ const bx=w5Box(s); return {s,bx,a:Math.max(1.15,Math.min(4.2,bx.w/bx.h))}; });
    const free=W*H-keep.reduce((a,k)=>a+Math.max(0,Math.min(R,k[2])-Math.max(L,k[0]))*Math.max(0,Math.min(B,k[3])-Math.max(top,k[1])),0);
    const meanA=n?items.reduce((a,i)=>a+i.a,0)/n:2.4;
    let h=n?Math.max(40,Math.min(210,Math.sqrt(free*.56/n/(meanA*1.12)))):120, best=null;
    for(let pass=0;pass<8;pass++){ const rnd=w5Rng(hash(key)+pass*977), placed=[], sigs=[], emo={}; let ov=0;
      items.forEach((it,i)=>{ const sz=h*(i===0?1.14:(.86+rnd()*.26)), w=Math.min(W,sz*it.a), hh=sz*(it.s.name?1.24:1); let bc=null;
        for(let t=0;t<140;t++){ const x=L+rnd()*Math.max(1,W-w), y=top+rnd()*Math.max(1,H-hh), bb=[x,y,x+w,y+hh]; let sc=0;
          for(const p of placed) sc+=w5Ov(bb,p,10); for(const k of keep) sc+=w5Ov(bb,k,0)*8;
          if(!bc||sc<bc.sc) bc={sc,bb}; if(sc===0) break; }
        placed.push(bc.bb); ov+=bc.sc; sigs.push({id:it.s.id,x:bc.bb[0],y:bc.bb[1],w,h:hh,sz,r:(rnd()*2-1)*6.5,bx:it.bx}); });
      emos.forEach(e=>{ const z=Math.max(36,Math.min(92,h*.5)); let bc=null;
        for(let t=0;t<60;t++){ const x=L+rnd()*(W-z), y=top+rnd()*Math.max(1,H-z), bb=[x,y,x+z,y+z]; let sc=0;
          for(const p of placed) sc+=w5Ov(bb,p,4); for(const k of keep) sc+=w5Ov(bb,k,0)*8; if(!bc||sc<bc.sc) bc={sc,bb}; if(sc===0) break; }
        placed.push(bc.bb); ov+=bc.sc*.3; emo[e.id]={x:bc.bb[0]+z/2,y:bc.bb[1]+z/2,z,r:(rnd()*2-1)*16}; });
      const c={sigs,emo,ov,h}; if(!best||c.ov<best.ov) best=c;
      if(ov<=h*h*.1*Math.max(1,n)) break; h*=.92; }
    W5S.lay=best; W5S.key=key; return best; }
  function w5List(){ const q=new Set(heroQ.map(x=>x.id)); return (SIGS||[]).filter(s=>s&&!W5S.pend.has(s.id)&&!q.has(s.id)).slice(0,60); }
  function w5Render(opt){ opt=opt||{}; const box=$('#wingSigs'); if(!box) return;
    const list=w5List(), emos=(typeof EMOS!=='undefined'&&Array.isArray(EMOS))?EMOS:[], lay=w5Layout(list,emos);
    box.querySelectorAll('.wing-avoid').forEach(e=>e.remove());
    let empty=box.querySelector('.wing-empty');
    if(!list.length&&!heroBusy){ if(!empty){ empty=document.createElement('div'); empty.className='wing-empty'; empty.textContent='Be the first to sign.'; box.appendChild(empty); } }
    else if(empty) empty.remove();
    const seen=new Set();
    lay.sigs.forEach((p,i)=>{ const s=list[i]; let el=W5S.els.get(s.id); const fresh=!el;
      if(fresh){ el=document.createElement('div'); el.className='w5-sig'; el.dataset.id=s.id; el._s=s;
        el.innerHTML=`<div class="w5-in">${w5Svg(s,p.bx)}${s.name?`<div class="nm">${esc(s.name)}</div>`:''}</div>`; box.appendChild(el); W5S.els.set(s.id,el); }
      seen.add(s.id); const pv=fresh?null:{x:el._x,y:el._y,w:el._w,h:el._h};
      el._x=p.x; el._y=p.y; el._w=p.w; el._h=p.h; el._r=p.r; el._sz=p.sz;
      el.style.cssText=`left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;width:${p.w.toFixed(1)}px;height:${p.h.toFixed(1)}px;--c:${esc(s.color||'#FFFFFF')};--r:${p.r.toFixed(2)}deg;--fs:${Math.max(13,p.sz*.16).toFixed(0)}px;--sw:${Math.max(2.4,p.sz*.03).toFixed(1)}px;--sh:${p.sz.toFixed(1)}px`;
      if(opt.hide===s.id) el.style.visibility='hidden';
      if(pv&&(Math.abs(pv.x-p.x)>1||Math.abs(pv.y-p.y)>1||Math.abs(pv.w-p.w)>1)){   // FLIP: glide from the old spot to the new one
        const dx=pv.x+pv.w/2-(p.x+p.w/2), dy=pv.y+pv.h/2-(p.y+p.h/2), k=pv.w/p.w;
        try{ el.animate([{transform:`translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(${k.toFixed(3)})`},{transform:'none'}],{duration:1150,delay:(i%14)*28,easing:'cubic-bezier(.32,.72,0,1)',fill:'backwards'}); }catch(e){} }
      else if(fresh&&!opt.noFade){ try{ el.animate([{opacity:0,transform:'scale(.92)'},{opacity:1,transform:'none'}],{duration:900,delay:Math.min(i,24)*45,easing:'cubic-bezier(.32,.72,0,1)',fill:'backwards'}); }catch(e){} } });
    W5S.els.forEach((el,id)=>{ if(!seen.has(id)){ el.remove(); W5S.els.delete(id); } });
    W5S.shown=lay.sigs.length; W5S.rw.order=lay.sigs.map(p=>p.id); if(W5S.rw.i>W5S.rw.order.length) W5S.rw.i=0;
    try{ w5Emos(true); }catch(e){ w5Fail(e); } }
  function w5Emos(all){ const box=$('#wingEmo'); if(!box) return; const list=(typeof EMOS!=='undefined'&&Array.isArray(EMOS))?EMOS:[];
    let lay=W5S.lay; if(!lay||list.some(e=>!lay.emo[e.id])){ W5S.key=''; lay=w5Layout(w5List(),list); }
    const have=new Map([...box.children].map(e=>[String(e.dataset.id),e]));
    list.forEach(e=>{ const id=String(e.id), q=lay.emo[e.id]; if(!q) return; let el=have.get(id); const fresh=!el;
      if(fresh){ el=document.createElement('i'); el.className='emo'+(emoSeen&&!emoSeen.has(e.id)?' pop':''); el.dataset.id=id; el.textContent=e.emoji; box.appendChild(el); }
      have.delete(id); const tf=`translate(${q.x.toFixed(0)}px,${q.y.toFixed(0)}px) translate(-50%,-50%) rotate(${q.r.toFixed(1)}deg)`;
      if(el._tf!==tf){ const old=el._tf; el._tf=tf; el.style.transform=tf; el.style.fontSize=(q.z*.86).toFixed(0)+'px';
        if(old&&!fresh){ try{ el.animate([{transform:old},{transform:tf}],{duration:1150,easing:'cubic-bezier(.32,.72,0,1)'}); }catch(err){} } } });
    have.forEach(el=>el.remove()); }
  /* ---------- a new signature: full-screen replay at real speed, then it glides into its spot on the re-laid board ---------- */
  function w5Hero(){ if(heroBusy||!heroQ.length) return; heroBusy=true; const s=heroQ.shift(), tok=++W5S.heroTok; W5S.pend.add(s.id); heroQ.forEach(q=>W5S.pend.add(q.id));
    const h=$('#sigHero'), bx=w5Box(s), tl=w5Compress(w5Times(s),900), top=wingBand?WING_BAND:0;
    const aw=WW*.84, ah=Math.max(200,(WH-top)*.5), a=bx.w/bx.h; let w=aw, hh=aw/a; if(hh>ah){ hh=ah; w=ah*a; }
    h.classList.add('w5'); h.style.setProperty('--c',s.color||'#FFD166');
    h.innerHTML=`<i class="w5-bg"></i><div class="kick">${s.test?'Test signature':'Just signed'}</div><div class="w5-hd" style="width:${w.toFixed(0)}px;height:${hh.toFixed(0)}px">${w5Svg(s,bx)}</div><div class="nm">${s.name?esc(s.name):'&nbsp;'}</div>`;
    void h.offsetWidth; h.classList.add('on'); lastSigAt=Date.now(); try{ wingVis(); }catch(e){}
    const T=w5Write(h.querySelector('.w5-hd svg'),tl,12000,650);
    setTimeout(()=>{ try{ play('sign'); }catch(e){} },600);
    setTimeout(()=>{ if(tok===W5S.heroTok){ const nm=h.querySelector('.nm'); if(nm) nm.classList.add('on'); } },T+350);
    setTimeout(()=>{ if(tok===W5S.heroTok){ try{ w5Land(s,h,tok); }catch(e){ w5Fail(e); w5HeroDone(h,s.id); } } },T+2300); }
  function w5HeroDone(h,id){ h.classList.remove('on'); setTimeout(()=>{ if(!heroBusy){ h.classList.remove('w5'); h.innerHTML=''; } },800);
    W5S.pend.delete(id); heroBusy=false; lastSigAt=Date.now(); W5S.landed++; if(heroQ.length) setTimeout(()=>playHero(),500); else { W5S.key=''; try{ w5Render(); }catch(e){ w5Fail(e); } } }
  function w5Land(s,h,tok){ const hd=h.querySelector('.w5-hd'); if(!hd){ w5HeroDone(h,s.id); return; }
    const hx=h.offsetLeft+hd.offsetLeft, hy=h.offsetTop+hd.offsetTop, hw=hd.offsetWidth, hh=hd.offsetHeight;
    W5S.pend.delete(s.id); W5S.key=''; w5Render({noFade:true,hide:s.id});
    const el=W5S.els.get(s.id); if(!el){ w5HeroDone(h,s.id); return; }
    // the slot's drawing: width el._w, height = signature size, rotated about the slot's centre
    const sw=el._w, sh=el._sz, cx=el._x+el._w/2, cy=el._y+el._h/2, oy=-(el._h-sh)/2, r=el._r*Math.PI/180;
    const tx=cx-Math.sin(r)*oy, ty=cy+Math.cos(r)*oy, dx=tx-(hx+hw/2), dy=ty-(hy+hh/2), k=Math.min(sw/hw,sh/hh);
    h.classList.add('land');
    try{ hd.animate([{transform:'none'},{transform:`translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${el._r.toFixed(2)}deg) scale(${k.toFixed(4)})`}],{duration:1250,easing:'cubic-bezier(.32,.72,0,1)',fill:'forwards'}); }catch(e){}
    setTimeout(()=>{ if(tok!==W5S.heroTok) return; el.style.visibility=''; h.classList.remove('land'); w5HeroDone(h,s.id); },1260); }
  /* ---------- the board re-writes itself: newest -> oldest, staggered (never two starts at once), overlaps fine, gentle loop ---------- */
  function w5Rewrite(el){ const svg=el.querySelector('svg'), g=svg&&svg.querySelector('g.b'); if(!g||el._busy) return; el._busy=1; W5S.rw.active++;
    const tl=el._tl||(el._tl=w5Compress(w5Times(el._s),650)), pen=g.cloneNode(true); pen.setAttribute('class','p'); svg.appendChild(pen);
    const T=w5Write(pen,tl,6500,0);
    try{ g.animate([{opacity:1},{opacity:.16,offset:.1},{opacity:.16,offset:.86},{opacity:1}],{duration:T+800,easing:'ease-in-out'}); }catch(e){}
    setTimeout(()=>{ try{ const a=pen.animate([{opacity:1},{opacity:0}],{duration:600,easing:'ease-out',fill:'forwards'}); a.onfinish=()=>pen.remove(); }catch(e){ pen.remove(); }
      el._busy=0; W5S.rw.active=Math.max(0,W5S.rw.active-1); },T+300); }
  function w5Tick(){ try{ if(!W5S.on) return; const wing=$('#wing'), b=document.body.classList, R=W5S.rw;
      if(!wing||!wing.classList.contains('on')||heroBusy||document.hidden||b.contains('black')||b.contains('mapping')||b.contains('lite')) return;
      const now=performance.now(); if(!R.order.length||now<R.next||R.active>=3) return;
      if(R.i>=R.order.length){ R.i=0; R.next=now+9000; return; }
      const el=W5S.els.get(R.order[R.i++]); if(!el||!el._s) return;
      w5Rewrite(el); R.next=now+((typeof fps==='number'&&fps>0&&fps<30)?3400:1250)+Math.random()*1150; }catch(e){ w5Fail(e); } }
  setInterval(w5Tick,250);
  try{ W5S.key=''; if(!heroBusy) renderSigs(); }catch(e){ w5Fail(e); }

  /* ---------- Do Not Disturb (state.dnd from admin; the old quiet hours if it's missing) ---------- */
  function w5Dnd(){ const d=S&&S.dnd, now=Date.now();
    if(d&&typeof d==='object'){ const o=d.override; if(o&&o.until>now) return o.mode==='on'; if(d.on===false) return false;
      const m=x=>{ const a=String(x||'').split(':'); return (+a[0]||0)*60+(+a[1]||0); }, f=m(d.from||'22:30'), t=m(d.to||'07:00'), n=new Date(), c=n.getHours()*60+n.getMinutes();
      return f<=t?(c>=f&&c<t):(c>=f||c<t); }
    return quietHours(); }
  function w5SoundOK(){ try{ if(SND.ctx&&SND.ctx.state!=='running') SND.ctx.resume(); }catch(e){} return !!(S&&S.sound!==false&&!w5Dnd()&&SND.ctx&&SND.ctx.state==='running'); }
  // offline-rendered sound beds (same idea as the pre-rendered chimes): rendered once, played as a plain buffer
  const W5BUF={};
  async function w5Render_snd(name,secs,build){ if(W5BUF[name]) return W5BUF[name]; const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext; if(!OAC) return null;
    const sr=24000, oc=new OAC(2,Math.ceil(sr*secs),sr), comp=oc.createDynamicsCompressor(); comp.connect(oc.destination);
    const m=oc.createGain(); m.gain.value=.5; m.connect(comp); const il=Math.floor(sr*2.8), ir=oc.createBuffer(2,il,sr);
    for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch); for(let i=0;i<il;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/il,3); }
    const v=oc.createConvolver(); v.buffer=ir; const wet=oc.createGain(); wet.gain.value=.35; v.connect(wet); wet.connect(m);
    build(oc,m,v); W5BUF[name]=await oc.startRendering(); return W5BUF[name]; }
  function w5Tone(oc,dst,verb,f,t,a,d,r,vol,type,lp){ const o=oc.createOscillator(), g=oc.createGain(); o.type=type||'sine'; o.frequency.value=f;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+a); g.gain.setValueAtTime(vol,t+a+d); g.gain.exponentialRampToValueAtTime(.0001,t+a+d+r);
    let n=o; if(lp){ const f2=oc.createBiquadFilter(); f2.type='lowpass'; f2.frequency.value=lp; o.connect(f2); n=f2; } n.connect(g); g.connect(dst); if(verb) g.connect(verb); o.start(t); o.stop(t+a+d+r+.1); }
  function w5Play(buf,vol){ try{ if(!buf||!w5SoundOK()) return false; const c=SND.ctx, s=c.createBufferSource(), g=c.createGain(); g.gain.value=vol==null?.9:vol; s.buffer=buf; s.connect(g); g.connect(c.destination); s.start(c.currentTime+.05); W5M.src=s; return true; }catch(e){ return false; } }

  /* ---------- "Motivate me" (admin button -> state.motivate {seq, ts}): a ~24 s show on the strip, once per new seq ---------- */
  var W5M={seen:undefined,busy:false,t:[],last:null,runs:0,src:null};
  const W5_LINES=[
    {t:'The brick walls are there to give us a chance to show how badly we want something.',by:'Randy Pausch'},
    {t:'The way to get started is to quit talking and begin doing.',by:'Walt Disney'},
    {t:'Stay hungry. Stay foolish.',by:'Steve Jobs'},
    {t:'If you want the rainbow, you gotta put up with the rain.',by:'Dolly Parton'},
    {t:'Life is like riding a bicycle. To keep your balance, you must keep moving.',by:'Albert Einstein'},
    {t:'No matter what anybody tells you, words and ideas can change the world.',by:'Robin Williams'},
    {t:'Small steps, every day. That is the whole trick.'},
    {t:'Ship it. Then make it better.'},
    {t:'You have done hard things before. This is one more.'},
    {t:'One thing at a time. This thing first.'},
    {t:'Build the thing you wish existed.'},
    {t:'Done is a gift. Give it to yourself.'},
    {t:'Your future self is cheering for what you do next.'},
    {t:'Nobody is coming to do it for you. Good news: you are the one.'},
  ];
  function w5Pick(){ let deck=[]; try{ deck=JSON.parse(localStorage.getItem('w5motDeck')||'[]'); }catch(e){}
    deck=deck.filter(i=>i>=0&&i<W5_LINES.length); if(!deck.length){ deck=W5_LINES.map((_,i)=>i).sort(()=>Math.random()-.5); if(deck[0]===W5M.last&&deck.length>1) deck.push(deck.shift()); }
    const i=deck.shift(); W5M.last=i; try{ localStorage.setItem('w5motDeck',JSON.stringify(deck)); }catch(e){} return W5_LINES[i]; }
  function w5Chips(){ const out=[]; try{ const t=w2F('turo'); if(t&&t.week!=null&&+t.week>0) out.push(['$'+Math.round(+t.week).toLocaleString('en-US'),'Turo this week']); }catch(e){}
    try{ const n=(SIGS||[]).filter(s=>!s.test).length; if(n>=3) out.push([String(n),n===1?'name on the sign wall':'names on the sign wall']); }catch(e){}
    try{ const h=w2F('habits'); if(h&&h.streak) out.push([String(h.streak)+' days','streak']); else if(h&&h.steps) out.push([(+h.steps).toLocaleString('en-US'),'steps today']); }catch(e){}
    try{ const one=String(S.one||'').trim(); if(one) out.push(['One thing',one.length>42?one.slice(0,40)+'…':one]); }catch(e){}
    return out.slice(0,3); }
  function w5Finale(){ const h=new Date().getHours(); return h<11?'Make today count.':h<17?'Go make something great.':h<21?'Finish strong.':'Proud of you. Now rest.'; }
  function w5MotSound(){ return w5Render_snd('mot',25,(oc,m,v)=>{ const pad=oc.createGain(); pad.gain.value=1; pad.connect(m); pad.connect(v);
      [50,57,66,73,76].forEach((n,i)=>w5Tone(oc,pad,null,mtof(n),.2+i*.12,3.2,13.5,4.5,.045,'triangle',1100));   // D major 9 pad swell
      [81,86,90].forEach((n,i)=>w5Tone(oc,m,v,mtof(n),3.3+i*.16,.006,.05,1.8,.05));                                    // bells as the line appears
      [74,78,81,86,88,93].forEach((n,i)=>w5Tone(oc,m,v,mtof(n),17.6+i*.09,.005,.04,1.6,.045));                          // finale shimmer
      w5Tone(oc,m,v,mtof(38),17.55,.02,.1,1.4,.09,'sine'); }); }
  function w5MotCheck(){ const m=S&&S.motivate; if(!m||m.seq==null){ if(W5M.seen===undefined) W5M.seen=null; return; }
    if(m.seq===W5M.seen) return; const first=W5M.seen===undefined; W5M.seen=m.seq;
    if(first&&!(m.ts&&Math.abs(Date.now()-m.ts)<60000)) return;   // an old press from before a reload
    w5Motivate(); }
  setInterval(()=>{ try{ w5MotCheck(); }catch(e){ w5Fail(e); } },700);
  // usable strip width: stay left of the TV wedge (the mask), like the skit does
  function w5Room(el){ let mx=1800; try{ const v=maskLeftX(20,290); if(isFinite(v)) mx=v; }catch(e){} mx=Math.max(900,Math.min(1780,mx-30));
    el.style.setProperty('--x0','40px'); el.style.setProperty('--mw',(mx-40).toFixed(0)+'px'); return mx-40; }
  function w5Stage(id){ let el=document.getElementById(id); if(!el){ el=document.createElement('div'); el.id=id; el.setAttribute('aria-hidden','true'); const st=$('#stage'); if(st) st.appendChild(el); } return el; }
  function w5Fit(el,maxW,maxH,start,min){ const inn=el.querySelector('.m-in')||el; let fs=start; el.style.fontSize=fs+'px';
    while(fs>min&&(inn.scrollWidth>Math.min(maxW,inn.clientWidth)+2||inn.offsetHeight>maxH+2)){ fs-=3; el.style.fontSize=fs+'px'; } return fs; }
  function w5Words(el,text,delay,gap){ el.innerHTML='<span class="m-in">'+String(text).split(/\s+/).map((w,i)=>`<span class="w" style="animation-delay:${(delay+i*gap).toFixed(2)}s">${esc(w)}</span>`).join(' ')+'</span>'; return String(text).split(/\s+/).length; }
  async function w5Motivate(){ if(W5M.busy) return; if((TOUR&&TOUR.on)||document.body.classList.contains('skit')){ setTimeout(w5Motivate,4000); return; }
    W5M.busy=true; W5M.runs++; W5M.at=Date.now(); const L=w5Pick(), chips=w5Chips(), el=w5Stage('w5mot'), room=w5Room(el); W5M.t.forEach(clearTimeout); W5M.t=[];
    const at=(ms,f)=>W5M.t.push(setTimeout(()=>{ try{ f(); }catch(e){ w5Fail(e); } },ms));
    el.innerHTML=`<i class="b1"></i><i class="b2"></i><i class="b3"></i><div class="m-hey">Hey <b>Jared.</b></div><div class="m-line"></div><div class="m-by"></div><div class="m-chips"></div><div class="m-fin"></div><div class="m-spark"></div>`;
    let snd=null; try{ snd=await Promise.race([w5MotSound(),new Promise(r=>setTimeout(()=>r(null),1800))]); }catch(e){}
    document.body.classList.add('w5-mot'); requestAnimationFrame(()=>el.classList.add('on')); w5Play(snd,.85);
    const hey=el.querySelector('.m-hey'), line=el.querySelector('.m-line'), by=el.querySelector('.m-by'), ch=el.querySelector('.m-chips'), fin=el.querySelector('.m-fin');
    at(500,()=>hey.classList.add('in')); at(2700,()=>{ hey.classList.remove('in'); hey.classList.add('out'); });
    const nw=L.t.split(/\s+/).length, gap=Math.min(.16,2.2/nw), hold=Math.max(4200,nw*330);
    at(3200,()=>{ w5Words(line,L.t,0,gap); line.classList.add('in'); w5Fit(line,1e9,250,112,56); });
    if(L.by) at(3200+nw*gap*1000+700,()=>{ by.textContent='— '+L.by; by.classList.add('in'); });
    const t2=3200+nw*gap*1000+hold; at(t2,()=>{ line.classList.add('out'); by.classList.remove('in'); by.classList.add('out'); });
    let t3=t2+700;
    if(chips.length){ at(t3,()=>{ ch.innerHTML=chips.map((c,i)=>`<div class="c" style="animation-delay:${(i*.18).toFixed(2)}s"><b>${esc(c[0])}</b><span>${esc(c[1])}</span></div>`).join(''); ch.classList.add('in'); });
      at(t3+4300,()=>{ ch.classList.remove('in'); ch.classList.add('out'); }); t3+=4900; }
    at(t3,()=>{ fin.textContent=w5Finale(); w5Fit(fin,1e9,150,128,60); fin.classList.add('in'); try{ lightWipe(); }catch(e){} w5Spark(el.querySelector('.m-spark')); });
    at(t3+3900,()=>el.classList.remove('on'));
    at(t3+5200,()=>{ document.body.classList.remove('w5-mot'); el.innerHTML=''; W5M.busy=false; }); }
  function w5Spark(box){ if(!box) return; let h=''; for(let i=0;i<26;i++){ const a=Math.random()*6.283, d=120+Math.random()*420, x=Math.cos(a)*d, y=Math.sin(a)*d*.32, c=['#FFD166','#FF6B9A','#7BDFF2','#C3A6FF','#9BF6A1'][i%5];
      h+=`<i style="--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;background:${c};animation-delay:${(Math.random()*.25).toFixed(2)}s"></i>`; } box.innerHTML=h; }

  /* ---------- fresh-air takeover (Pi rule: indoor air bad -> Dyson on + this, max once per 2 h, never during DND) ---------- */
  var W5A={seen:undefined,busy:false,t:[],runs:0,d:null};
  async function w5Pull(){ try{ const r=await (await fetch('/api/w5',{cache:'no-store'})).json(); W5A.d=r; const tk=r&&r.take;
      if(!tk||tk.seq==null){ if(W5A.seen===undefined) W5A.seen=null; return; }
      if(tk.seq===W5A.seen) return; const first=W5A.seen===undefined; W5A.seen=tk.seq;
      if(first&&!(tk.at&&Math.abs(Date.now()/1000-tk.at)<60)) return;
      if(tk.kind==='air') w5Air(tk); }catch(e){} }
  setInterval(w5Pull,4000); setTimeout(w5Pull,1500);
  function w5AirSound(){ return w5Render_snd('air',6,(oc,m,v)=>{ [72,76,79,84].forEach((n,i)=>w5Tone(oc,m,v,mtof(n),.15+i*.13,.006,.06,1.3,.05));
      const len=Math.floor(oc.sampleRate*3), b=oc.createBuffer(1,len,oc.sampleRate), d=b.getChannelData(0); for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
      const s=oc.createBufferSource(); s.buffer=b; const bp=oc.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=.8; bp.frequency.setValueAtTime(500,.8); bp.frequency.exponentialRampToValueAtTime(2200,2.6);
      const g=oc.createGain(); g.gain.setValueAtTime(0,.8); g.gain.linearRampToValueAtTime(.05,1.8); g.gain.linearRampToValueAtTime(0,3.6); s.connect(bp); bp.connect(g); g.connect(m); s.start(.8); s.stop(3.7); }); }
  async function w5Air(tk){ if(W5A.busy||w5Dnd()) return; if((TOUR&&TOUR.on)||document.body.classList.contains('skit')||W5M.busy){ setTimeout(()=>w5Air(tk),5000); return; }
    W5A.busy=true; W5A.runs++; const el=w5Stage('w5air'); w5Room(el); W5A.t.forEach(clearTimeout); W5A.t=[];
    const at=(ms,f)=>W5A.t.push(setTimeout(()=>{ try{ f(); }catch(e){ w5Fail(e); } },ms));
    const pm=tk.pm25!=null?`Indoor air · PM2.5 ${Math.round(tk.pm25)} µg/m³`:(tk.label?`Indoor air · ${tk.label}`:'Indoor air is stuffy');
    const pur=tk.purifier==='on'?'The air purifier is on.':tk.purifier==='failed'?'Couldn’t reach the air purifier.':'';
    el.innerHTML=`<div class="a-scene"><svg class="a-house" viewBox="0 0 260 220"><path d="M20 110 L130 26 L240 110" fill="none" stroke="#FFD166" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="44" y="100" width="172" height="112" rx="16" fill="#1C1C1E" stroke="rgba(255,255,255,.28)" stroke-width="3"/><rect x="104" y="128" width="54" height="84" rx="8" fill="#FFB340" opacity=".9"/>
      <g class="a-door"><rect x="104" y="128" width="54" height="84" rx="8" fill="#0A84FF"/><circle cx="147" cy="172" r="4.5" fill="#fff"/></g></svg>
      <svg class="a-breeze" viewBox="0 0 600 220"><path d="M20 70 C120 20 200 120 300 70 S480 30 580 80"/><path d="M10 130 C130 90 230 170 330 120 S500 100 590 140"/><path d="M40 185 C150 150 250 215 350 175 S520 160 590 190"/></svg>
      <svg class="a-leaf l1" viewBox="0 0 40 40"><path d="M5 35 C5 12 20 5 36 4 C35 20 28 35 5 35 Z" fill="#30D158"/><path d="M8 32 L30 10" stroke="#1E8E3E" stroke-width="2"/></svg>
      <svg class="a-leaf l2" viewBox="0 0 40 40"><path d="M5 35 C5 12 20 5 36 4 C35 20 28 35 5 35 Z" fill="#9BF6A1"/><path d="M8 32 L30 10" stroke="#1E8E3E" stroke-width="2"/></svg></div>
      <div class="a-txt"><div class="a-k">${esc(pm)}</div><div class="a-h">Let’s get some fresh air.</div><div class="a-s">Open the door for a few minutes.</div>${pur?`<div class="a-s a-s2">${esc(pur)}</div>`:''}</div>`;
    let snd=null; try{ snd=await Promise.race([w5AirSound(),new Promise(r=>setTimeout(()=>r(null),1500))]); }catch(e){}
    document.body.classList.add('w5-air'); try{ w5Fit(el.querySelector('.a-h'),1e9,170,84,44); }catch(e){} requestAnimationFrame(()=>el.classList.add('on')); w5Play(snd,.8);
    at(1400,()=>el.classList.add('open')); at(13800,()=>el.classList.remove('on'));
    at(15000,()=>{ document.body.classList.remove('w5-air'); el.classList.remove('open'); el.innerHTML=''; W5A.busy=false; }); }

  /* ---------- health: the Pi's watchdog reads this (signatures load/render, shows, errors) ---------- */
  function w5Beat(){ try{ const wing=$('#wing');
      fetch('/api/w5beat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sig:{n:(SIGS||[]).length,shown:W5S.shown,on:W5S.on,err:W5S.err,wing:!!(wing&&wing.classList.contains('on')),hero:!!heroBusy,writes:W5S.writes,landed:W5S.landed,rev:sigRev},
        mot:{runs:W5M.runs,busy:W5M.busy,seen:W5M.seen==null?null:W5M.seen},air:{runs:W5A.runs,seen:W5A.seen==null?null:W5A.seen},ufo:{runs:W5U.runs,err:W5U.err},fps:(typeof fps==='number'?fps:null),dnd:w5Dnd()})}).catch(()=>{}); }catch(e){} }
  setInterval(w5Beat,30000); setTimeout(w5Beat,6000);
