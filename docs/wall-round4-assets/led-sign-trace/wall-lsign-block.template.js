  /* ================= W8 round 4 (2026-09-28): LED sign projection mapping =================
     Jared's white neon line-art sign (two legs kicking up out of a pool, a hand gripping a leg, a fist) hangs on the sign
     wall across grid C6-C7. LSG = its tube centerlines, traced from his photos and registered to projector space through
     the calibration-grid photo (ref px = a 960x540 viewport; cx/cy = sign center as 0..1 of the screen; plate = the clear
     acrylic backing). state.ledSign {on,look,color,x,y,s,r,sx,outline,notify,shield,test} fine-aligns and styles it:
     x/y = offset (0..1 of the screen), s = scale, r = degrees, sx = extra width, outline = alignment test.
     ONE small canvas (~130 CSS px): idle looks are drawn once (CSS opacity does the flicker-on + breathing); a rAF loop
     runs only while an animation plays (<= 30 fps; the idle "trace" look 20 fps). Wall content under the acrylic is
     blacked out (shield). window.LEDSIGN_BOX = the keep-out box {norm:[x0,y0,x1,y1] (0..1 screen), wing:[x0,y0,x1,y1]
     (sign-wall px)}; WING_AVOID's neon entry follows it and a 'ledsign:box' event fires on change (W5 signature layout).
     Notifications (new signature, Turo booking, motivate, Scout / alert card) play a short sign animation unless Do Not
     Disturb or sleep. Heartbeat "lsign" -> watchdog (lsign_watch) -> Scout. */
  const LSG=__LSG__;
  const LS={cv:null,ctx:null,P:null,plate:null,pl:null,spr:null,dpr:1,key:'',idle:'',anim:null,raf:0,lt:0,errs:0,err:'',errAt:[],safeUntil:0,
    fx:0,skip:0,lastFx:null,ms:0,vis:false,mo:undefined,tk:undefined,boxKey:'',avIx:undefined,heroOn:false,last:null,boot:Date.now()};
  window.LEDSIGN_BOX=null;
  const lsNum=(v,d,a,b)=>typeof v==='number'&&isFinite(v)?Math.min(b,Math.max(a,v)):d;
  function lsCfg(){ const c=S&&S.ledSign&&typeof S.ledSign==='object'?S.ledSign:null;
    return {has:!!(c&&typeof c.x==='number'&&typeof c.y==='number'&&typeof c.s==='number'),on:!c||c.on!==false,
      look:c&&/^(lit|breathe|wash|trace|none)$/.test(c.look||'')?c.look:'lit',color:c&&/^#[0-9a-fA-F]{6}$/.test(c.color||'')?c.color:'#F4EEFF',
      x:lsNum(c&&c.x,0,-.3,.3),y:lsNum(c&&c.y,0,-.3,.3),s:lsNum(c&&c.s,1,.4,2.5),r:lsNum(c&&c.r,0,-45,45),sx:lsNum(c&&c.sx,1,.6,1.6),
      outline:!!(c&&c.outline),notify:!c||c.notify!==false,shield:!c||c.shield!==false,test:c&&c.test&&typeof c.test==='object'?c.test:null}; }
  // Do Not Disturb from state.dnd {on, from:"22:30", to:"07:00", override:{mode:"on"|"off", until}}
  function lsDnd(){ try{ const d=S&&S.dnd; if(!d||typeof d!=='object') return false; const o=d.override;
      if(o&&typeof o==='object'&&(o.mode==='on'||o.mode==='off')){ const u=+o.until||0, um=u&&u<1e12?u*1000:u; if(!u||Date.now()<um) return o.mode==='on'; }
      if(d.on===false) return false; const hm=s=>{ const m=/^(\d{1,2}):(\d{2})/.exec(String(s||'')); return m?(+m[1])*60+(+m[2]):null; };
      const a=hm(d.from), b=hm(d.to); if(a==null||b==null||a===b) return false; const t=new Date(), m=t.getHours()*60+t.getMinutes();
      return a<b?(m>=a&&m<b):(m>=a||m<b); }catch(e){ return false; } }
  function lsAsleep(){ try{ if(WK&&WK.black) return true; }catch(e){} try{ return effMode()==='off'; }catch(e){ return false; } }
  // colors
  const lsRgb=h=>Array.isArray(h)?h:[1,3,5].map(i=>parseInt(String(h).slice(i,i+2),16)||0);
  const lsHsl=(h,s,l)=>{ s/=100; l/=100; const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l), f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1)); return [f(0)*255,f(8)*255,f(4)*255]; };
  const lsMix=(a,b,k)=>{ a=lsRgb(a); b=lsRgb(b); return a.map((v,i)=>v+(b[i]-v)*k); };
  const lsCss=c=>{ c=lsRgb(c); return 'rgb('+c.map(v=>Math.round(Math.max(0,Math.min(255,v)))).join(',')+')'; };
  const lsWashCol=t=>lsHsl(250+110*(.5+.5*Math.sin(t*2*Math.PI/30)),90,70);   // slow violet -> pink -> blue drift
  const lsE=p=>p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2, lsC=v=>Math.max(0,Math.min(1,v));
  // geometry + placement
  function lsBuild(){ if(!LS.P){ LS.P=LSG.paths.map(d=>new Path2D(d)); LS.plate=new Path2D(LSG.plate); } }
  function lsPlace(c){ const W_=innerWidth, H_=innerHeight, kx=W_/LSG.ref[0], ky=H_/LSG.ref[1], b=LSG.box;
    const R=Math.hypot(Math.max(-b[0],b[2])*c.sx*kx,Math.max(-b[1],b[3])*ky)*c.s, side=Math.ceil(2*(R+16*Math.max(kx,ky)*c.s));
    return {px:(LSG.cx+c.x)*W_,py:(LSG.cy+c.y)*H_,kx,ky,side}; }
  function lsSetup(c){ const pl=lsPlace(c); let cv=LS.cv;
    if(!cv||!cv.isConnected){ cv=document.createElement('canvas'); cv.id='lsign'; cv.setAttribute('aria-hidden','true');
      cv.addEventListener('animationend',e=>{ if(e.animationName==='lsFlick') cv.classList.remove('ls-flick'); });
      document.body.appendChild(cv); LS.cv=cv; LS.ctx=cv.getContext('2d'); LS.key=''; LS.vis=false; }
    const dpr=Math.min(2,window.devicePixelRatio||1), key=[pl.side,dpr,pl.px.toFixed(1),pl.py.toFixed(1),c.s,c.sx,c.r].join('|');
    if(key!==LS.key){ LS.key=key; LS.idle=''; cv.width=Math.round(pl.side*dpr); cv.height=Math.round(pl.side*dpr); cv.style.width=cv.style.height=pl.side+'px';
      cv.style.transform=`translate(${(pl.px-pl.side/2).toFixed(1)}px,${(pl.py-pl.side/2).toFixed(1)}px)`; LS.dpr=dpr; LS.pl=pl; }
    return pl; }
  function lsHom(src,dst){ const A=[],b=[]; for(let i=0;i<4;i++){ const [x,y]=src[i],[u,v]=dst[i]; A.push([x,y,1,0,0,0,-x*u,-y*u]); b.push(u); A.push([0,0,0,x,y,1,-x*v,-y*v]); b.push(v); }
    const g=solve(A,b); return (x,y)=>{ const w=g[6]*x+g[7]*y+1; return [(g[0]*x+g[1]*y+g[2])/w,(g[3]*x+g[4]*y+g[5])/w]; }; }
  function lsBox(c,pl){ const b=LSG.box, m=5, a=c.r*Math.PI/180, cr=Math.cos(a), sr=Math.sin(a), W_=innerWidth, H_=innerHeight;
    const pts=[[b[0]-m,b[1]-m],[b[2]+m,b[1]-m],[b[2]+m,b[3]+m],[b[0]-m,b[3]+m]].map(([x,y])=>{ x*=c.s*c.sx*pl.kx; y*=c.s*pl.ky; return [pl.px+x*cr-y*sr,pl.py+x*sr+y*cr]; });
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    const norm=[Math.min(...xs)/W_,Math.min(...ys)/H_,Math.max(...xs)/W_,Math.max(...ys)/H_].map(v=>+v.toFixed(4)); let wing=null;
    try{ if(Array.isArray(S.wing)&&S.wing.length===4){ const inv=lsHom(S.wing.map(([x,y])=>[x*W_,y*H_]),[[0,0],[WW,0],[WW,WH],[0,WH]]), q=pts.map(p=>inv(p[0],p[1]));
      const qx=q.map(p=>p[0]), qy=q.map(p=>p[1]); wing=[Math.min(...qx),Math.min(...qy),Math.max(...qx),Math.max(...qy)].map(v=>Math.round(v)); } }catch(e){}
    return {norm,wing}; }
  function lsPublishBox(bx){ window.LEDSIGN_BOX=bx;
    try{ if(bx.wing&&typeof WING_AVOID!=='undefined'&&Array.isArray(WING_AVOID)){ const m=12, nb=[Math.max(0,bx.wing[0]-m),Math.max(0,bx.wing[1]-m),Math.min(WW,bx.wing[2]+m),Math.min(WH,bx.wing[3]+m)];
        if(LS.avIx===undefined){ let best=-1, bo=0; WING_AVOID.forEach((k,i)=>{ const o=Math.max(0,Math.min(k[2],nb[2])-Math.max(k[0],nb[0]))*Math.max(0,Math.min(k[3],nb[3])-Math.max(k[1],nb[1])); if(o>bo){ bo=o; best=i; } }); LS.avIx=best>=0?best:null; }
        const ix=LS.avIx; if(ix!=null&&WING_AVOID[ix]&&WING_AVOID[ix].join()!==nb.join()){ WING_AVOID[ix]=nb; if(!heroBusy) renderSigs(); } } }catch(e){}
    try{ window.dispatchEvent(new CustomEvent('ledsign:box',{detail:bx})); }catch(e){} }
  // drawing. The neon strokes are rendered ONCE into white sprites (halo + core) plus the black acrylic shield; an
  // animation frame is only a few blits, one tint fill and one polyline mask (<= 1 path). Per-frame vector strokes with
  // line dashes dropped the projector page to 6 fps in testing (its GPU is small), so nothing like that runs per frame.
  const LS_HALO=[[10,.045],[6.5,.08],[4,.16],[2.4,.42]], LS_CORE=[1.5,.9];
  function lsXf(x,c){ const pl=LS.pl, d=LS.dpr; x.setTransform(d,0,0,d,0,0); x.translate(pl.side/2,pl.side/2); x.rotate(c.r*Math.PI/180);
    x.scale(c.s*c.sx*pl.kx,c.s*pl.ky); x.lineCap='round'; x.lineJoin='round'; }
  function lsSprites(c){ const k=LS.key; if(LS.spr&&LS.spr.k===k) return LS.spr; const w=LS.cv.width, h=LS.cv.height;
    const mk=()=>{ const v=document.createElement('canvas'); v.width=w; v.height=h; return v; }, halo=mk(), core=mk(), base=mk(), t1=mk(), t2=mk();
    let x=halo.getContext('2d'); lsXf(x,c); x.globalCompositeOperation='lighter'; x.strokeStyle='#fff';
    LS_HALO.forEach(([lw,a])=>{ x.lineWidth=lw; x.globalAlpha=a; LS.P.forEach(p=>x.stroke(p)); });
    x=core.getContext('2d'); lsXf(x,c); x.strokeStyle='#fff'; x.lineWidth=LS_CORE[0]; x.globalAlpha=LS_CORE[1]; LS.P.forEach(p=>x.stroke(p));
    x=base.getContext('2d'); lsXf(x,c); x.fillStyle='#000'; x.fill(LS.plate); x.lineWidth=5; x.strokeStyle='rgba(0,0,0,.55)'; x.stroke(LS.plate);
    LS.spr={k,halo,core,base,t1,t2}; return LS.spr; }
  // masks from the traced polylines (LSG.pts, a point every ~1.5 ref px): reveal = each tube drawn up to a share q;
  // seg = a short piece of every tube ending at point h (a light running along it)
  function lsPoly(x,a,i0,i1){ const n=a.length/2; i0=Math.max(0,Math.floor(i0)); i1=Math.min(n-1,Math.ceil(i1)); if(i1<=i0) return;
    x.moveTo(a[i0*2],a[i0*2+1]); for(let i=i0+1;i<=i1;i++) x.lineTo(a[i*2],a[i*2+1]); }
  const lsMaskReveal=q=>x=>{ x.lineWidth=9; x.beginPath(); LSG.pts.forEach(a=>lsPoly(x,a,0,q*(a.length/2-1))); x.stroke(); };
  const lsMaskSeg=(hf,seg)=>x=>{ x.lineWidth=5; x.beginPath(); LSG.pts.forEach((a,i)=>{ const h=hf(a.length/2,i); lsPoly(x,a,h-seg,h); }); x.stroke(); };
  function lsLayer(t,c,tint,mask){ const s=LS.spr, x=t.getContext('2d'); x.setTransform(1,0,0,1,0,0); x.globalAlpha=1; x.globalCompositeOperation='source-over';
    x.clearRect(0,0,t.width,t.height);
    if(mask){ lsXf(x,c); x.strokeStyle='#fff'; mask(x); x.setTransform(1,0,0,1,0,0); x.globalCompositeOperation='source-in'; }
    x.drawImage(s.halo,0,0);
    if(tint){ x.globalCompositeOperation='source-atop'; x.fillStyle=tint; x.fillRect(0,0,t.width,t.height); }
    x.globalCompositeOperation=mask?'source-atop':'lighter'; x.drawImage(s.core,0,0); x.globalCompositeOperation='source-over'; return t; }
  function lsBlit(x,layer,amp){ x.globalCompositeOperation='lighter'; let a=amp; while(a>.01){ x.globalAlpha=Math.min(1,a); x.drawImage(layer,0,0); a-=1; } x.globalAlpha=1; }
  function lsBegin(c){ const x=LS.ctx, s=lsSprites(c); x.setTransform(1,0,0,1,0,0); x.globalAlpha=1; x.globalCompositeOperation='source-over'; x.setLineDash([]);
    x.clearRect(0,0,LS.cv.width,LS.cv.height); if(c.shield) x.drawImage(s.base,0,0); return x; }
  const lsGlow=(x,c,tint,amp,mask)=>{ if(amp>0) lsBlit(x,lsLayer(LS.spr.t1,c,tint,mask),amp); };
  const lsSpark=(x,c,amp,mask)=>{ if(amp>0) lsBlit(x,lsLayer(LS.spr.t2,c,null,mask),amp); };   // white light
  function lsRainbow(t){ const w=LS.cv.width, g=LS.spr.t1.getContext('2d').createLinearGradient(0,0,w,w*.35);
    for(let i=0;i<=6;i++) g.addColorStop(i/6,lsCss(lsHsl((t*95+i*55)%360,95,66))); return g; }
  function lsIdleCol(c){ return c.look==='wash'?lsWashCol(performance.now()/1000):c.color; }
  function lsIdleAmp(c){ return c.look==='none'?0:1; }
  function lsIdle(c,force){ const look=c.outline?'outline':c.look, key=look+'|'+c.color+'|'+c.shield+'|'+LS.key;
    if(!force&&LS.idle===key) return; LS.idle=key; const x=lsBegin(c);
    if(look==='outline'){ lsXf(x,c); x.globalCompositeOperation='source-over'; x.lineWidth=1.1; x.strokeStyle='#FFFFFF'; LS.P.forEach(p=>x.stroke(p));
      x.lineWidth=.6; x.strokeStyle='#30D158'; x.setLineDash([3,3]); x.stroke(LS.plate); x.setLineDash([]);
      x.strokeStyle='#FF453A'; x.beginPath(); x.moveTo(-4,0); x.lineTo(4,0); x.moveTo(0,-4); x.lineTo(0,4); x.stroke(); }
    else if(look!=='none') lsGlow(x,c,lsCss(lsIdleCol(c)),1);
    LS.cv.dataset.look=look; }
  // notification animations (short; they settle back into the idle look)
  const LS_FX={sign:{col:'#FF6FD8',dur:4200},turo:{col:'#A78BFA',dur:3600,n:3},motivate:{col:null,dur:6500},alert:{col:'#FF9F0A',dur:3400,n:2},scout:{col:'#0A84FF',dur:3400,n:2},hello:{col:null,dur:3200}};
  function lsAnim(name){ const f=LS_FX[name]||LS_FX.sign, a={name,dur:f.dur,fps:30};
    if(name==='sign'||name==='hello') a.frame=(x,p,t,c)=>{ const col=f.col||c.color;
      if(p<.42){ const q=lsE(p/.42); lsGlow(x,c,lsCss(col),.95,lsMaskReveal(q)); lsSpark(x,c,1,lsMaskSeg(n=>q*(n-1),5)); }
      else if(p<.6) lsGlow(x,c,lsCss(col),1+.7*Math.sin((p-.42)/.18*Math.PI));
      else { const k=lsE((p-.6)/.4); lsGlow(x,c,lsCss(lsMix(col,lsIdleCol(c),k)),1+(lsIdleAmp(c)-1)*k); } };
    else if(name==='motivate') a.frame=(x,p,t,c)=>{ const k=p>.8?lsE((p-.8)/.2):0, g=lsRainbow(t);
      if(p<.25) lsGlow(x,c,g,1,lsMaskReveal(lsE(p/.25)));
      else { lsGlow(x,c,g,(1+.35*Math.sin(t*5))*(1-k)); if(k>0) lsGlow(x,c,lsCss(lsIdleCol(c)),lsIdleAmp(c)*k); }
      if(p>.25&&p<.8) lsSpark(x,c,1.1,lsMaskSeg((n,i)=>((t*.55+i*.137)%1)*(n-1+5),5)); };
    else a.frame=(x,p,t,c)=>{ const n=f.n||2, b=Math.sin(Math.PI*((p*n)%1)), k=p<.8?1:1-lsE((p-.8)/.2);
      lsGlow(x,c,lsCss(lsMix(lsIdleCol(c),f.col,k)),(lsIdleAmp(c)*(1-k)+k)*(1+.85*b*k)); };
    return a; }
  function lsTraceIdle(){ return {name:'trace',dur:0,fps:15,frame:(x,p,t,c)=>{ lsGlow(x,c,lsCss(c.color),.55); lsSpark(x,c,.9,lsMaskSeg((n,i)=>((t/3.6+i*.137)%1)*(n-1+6),6)); }}; }
  function lsRun(a){ if(!LS.cv) return; LS.anim=a; a.t0=performance.now(); LS.cv.classList.remove('ls-breathe'); LS.cv.classList.add('on'); if(!LS.raf) LS.raf=requestAnimationFrame(lsLoop); }
  function lsStop(){ LS.anim=null; if(LS.raf){ cancelAnimationFrame(LS.raf); LS.raf=0; } }
  function lsLoop(t){ LS.raf=0; const a=LS.anim; if(!a) return;
    if(t-LS.lt<1000/(a.fps||30)-4){ LS.raf=requestAnimationFrame(lsLoop); return; } LS.lt=t;
    try{ const c=lsCfg(); lsBuild(); lsSetup(c); const p=a.dur?Math.min(1,(t-a.t0)/a.dur):0, t0=performance.now();
      const x=lsBegin(c); a.frame(x,p,(t-a.t0)/1000,c); LS.ms=LS.ms*.9+(performance.now()-t0)*.1;
      if(a.dur&&p>=1){ LS.anim=null; LS.idle=''; lsTick(); return; } }catch(e){ LS.anim=null; lsErr(e); return; }
    LS.raf=requestAnimationFrame(lsLoop); }
  function lsFire(name,force){ try{ if(!LS_FX[name]) name='sign'; const c=lsCfg();
      if(lsAsleep()||S.calGrid||S.mapping||c.outline||Date.now()<LS.safeUntil||(!force&&(!c.on||!c.notify||lsDnd()))){ LS.skip++; return false; }
      lsBuild(); lsSetup(c); LS.fx++; LS.lastFx=name; LS.vis=true; lsRun(lsAnim(name)); return true; }catch(e){ lsErr(e); return false; } }
  function lsErr(e){ LS.errs++; LS.err=String((e&&e.message)||e).slice(0,110); const n=Date.now(); LS.errAt=LS.errAt.filter(t=>n-t<60000); LS.errAt.push(n);
    if(LS.errAt.length>=3) LS.safeUntil=n+10*60e3;   // self-heal: static glow only (no animations) for 10 min
    lsStop(); try{ if(LS.cv) LS.cv.remove(); }catch(x){} LS.cv=null; LS.key=''; LS.idle=''; LS.vis=false; }
  function lsEvents(c){ if(!S||!('ledSign' in S)) return;   // wait for the real state (the page boots with a stub), or a reload replays old events
    const mv=S.motivate&&typeof S.motivate==='object'?(S.motivate.seq!=null?S.motivate.seq:S.motivate.ts):null;
    if(LS.mo===undefined) LS.mo=mv; else if(mv!=null&&mv!==LS.mo){ LS.mo=mv; lsFire('motivate'); }
    const t=c.test, tk=t?(t.at||t.seq||null):null;   // admin "Play" button: {fx, at}
    if(LS.tk===undefined) LS.tk=tk; else if(tk&&tk!==LS.tk){ LS.tk=tk; if(+t.at>LS.boot-5000&&Date.now()-(+t.at)<120000) lsFire(String(t.fx||'sign'),true); } }
  function lsObserve(){ try{ const h=$('#sigHero');
      if(h) new MutationObserver(()=>{ const on=h.classList.contains('on'); if(on&&!LS.heroOn) lsFire('sign'); LS.heroOn=on; }).observe(h,{attributes:true,attributeFilter:['class']});
      let bk=document.body.classList.contains('w2-bk');
      new MutationObserver(()=>{ const on=document.body.classList.contains('w2-bk'); if(on&&!bk) lsFire('turo'); bk=on; }).observe(document.body,{attributes:true,attributeFilter:['class']});
      const al=$('#alertBox'); if(al){ let was=!al.hidden; new MutationObserver(()=>{ const on=!al.hidden; if(on&&!was) lsFire(/^Scout/.test((($('#alertApp')||{}).textContent)||'')?'scout':'alert'); was=on; }).observe(al,{attributes:true,attributeFilter:['hidden']}); }
    }catch(e){ lsErr(e); } }
  function lsTick(){ try{ const c=lsCfg(), grid=!!(S.calGrid||S.mapping), asleep=lsAsleep(), show=c.outline||grid||(c.on&&!asleep);
      lsBuild(); const pl=lsSetup(c), cv=LS.cv;
      const bk=[pl.side,pl.px.toFixed(1),pl.py.toFixed(1),c.s,c.sx,c.r,JSON.stringify(S.wing||null)].join('|');
      if(bk!==LS.boxKey){ LS.boxKey=bk; lsPublishBox(lsBox(c,pl)); }
      cv.classList.toggle('ls-grid',grid);
      if(!show){ if(LS.anim&&LS.anim.dur) return;   // a one-shot (admin Play) finishes, then hides
        if(LS.vis||cv.classList.contains('on')){ LS.vis=false; cv.classList.remove('on','ls-flick','ls-breathe'); lsStop(); } return; }
      const oc=Object.assign({},c); if(grid) oc.outline=true;
      if(Date.now()<LS.safeUntil||document.body.classList.contains('lite')){ if(oc.look==='trace') oc.look='lit'; }
      if(oc.outline&&LS.anim) lsStop();
      if(!LS.vis){ LS.vis=true; LS.idle=''; if(!oc.outline&&oc.look!=='none'){ cv.classList.remove('ls-flick'); void cv.offsetWidth; cv.classList.add('ls-flick'); } }
      cv.classList.add('on'); cv.classList.toggle('ls-breathe',!oc.outline&&!LS.anim&&oc.look==='breathe');
      lsEvents(c); if(LS.anim&&LS.anim.name==='trace'&&(oc.look!=='trace'||oc.outline)) lsStop();
      if(!LS.anim){ if(oc.look==='trace'&&!oc.outline) lsRun(lsTraceIdle()); else lsIdle(oc,oc.look==='wash'&&!oc.outline); }
      LS.last=oc; }catch(e){ lsErr(e); } }
  window.LSIGN={hb(){ const c=lsCfg(); return {ok:Date.now()>=LS.safeUntil,errs:LS.errs,err:LS.err||null,look:c.outline?'outline':c.look,align:c.has?'state':'default',
      vis:LS.vis,anim:LS.anim?LS.anim.name:null,fx:LS.fx,skip:LS.skip,last:LS.lastFx,ms:+LS.ms.toFixed(2),box:window.LEDSIGN_BOX&&LEDSIGN_BOX.norm}; },
    fire:(n)=>lsFire(n||'hello',true), dnd:lsDnd};
  try{ lsObserve(); setTimeout(lsTick,1200); setInterval(lsTick,300); }catch(e){ lsErr(e); }

