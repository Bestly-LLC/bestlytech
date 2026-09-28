
  /* ---------- Skit v2 (W5 r4): "Close Encounters of the Kings Road Kind". A UFO beams Jared up from his desk, which is exactly where
     the home label sits on the sky (read live from #airYou, so it follows W1's movable home). Old skit stays as skitStartV1 (fallback
     when the new voices aren't built). Voices: /opt/bestly/skit/build.py (lines k01..k19, ufo = Piper lessac + alien filter). ---------- */
  var W5U={runs:0,err:null,hum:null};
  SKT_COL.ufo='#30D158'; SKT_NAME.ufo='The Visitor'; SKT_RATE.ufo=1; SKT_SKY.ufo=1;
  SKT_COL.jared='#34C759'; SKT_NAME.jared='Jared'; SKT_RATE.jared=1; SKT_SKY.jared=1; SKT_SKY.desk=1;
  SKT_ART.ufo=`<svg viewBox="-112 -74 224 136" width="224" height="136"><g class="sk-bob">
      <ellipse cx="0" cy="-14" rx="42" ry="36" fill="rgba(150,225,255,.28)" stroke="rgba(210,245,255,.85)" stroke-width="2.5"/>
      <ellipse cx="0" cy="-10" rx="14" ry="17" fill="#7CFC9A"/><ellipse cx="-5.5" cy="-14" rx="4.2" ry="6.5" fill="#111"/><ellipse cx="5.5" cy="-14" rx="4.2" ry="6.5" fill="#111"/>
      <g class="sk-eye"><g class="sk-pup"><circle cx="-4.5" cy="-16" r="1.4" fill="#fff"/><circle cx="6.5" cy="-16" r="1.4" fill="#fff"/></g></g>
      <ellipse class="sk-mouth" cx="0" cy="-2" rx="4" ry="2.4" fill="#0B3D1A"/>
      <path d="M-8 -27 Q-12 -38 -16 -40 M8 -27 Q12 -38 16 -40" stroke="#7CFC9A" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="-16" cy="-40" r="3" fill="#FFD60A"/><circle cx="16" cy="-40" r="3" fill="#FFD60A"/>
      <ellipse cx="0" cy="10" rx="104" ry="25" fill="#AEB4BF"/><ellipse cx="0" cy="3" rx="104" ry="17" fill="#E9ECF2"/><ellipse cx="0" cy="-1" rx="60" ry="8" fill="#FFFFFF" opacity=".55"/>
      <g class="w5-ufol"><circle cx="-78" cy="12" r="6"/><circle cx="-46" cy="17" r="6"/><circle cx="-12" cy="19" r="6"/><circle cx="22" cy="18" r="6"/><circle cx="54" cy="16" r="6"/><circle cx="82" cy="11" r="6"/></g>
      <ellipse cx="0" cy="29" rx="46" ry="9" fill="#8E949E"/><ellipse class="w5-ufoglow" cx="0" cy="33" rx="30" ry="6" fill="#B4FFC8"/></g></svg>`;
  SKT_ART.jared=`<svg viewBox="-26 -44 52 72" width="52" height="72"><g>
      <rect x="-13" y="-16" width="26" height="30" rx="10" fill="#0A84FF"/><path d="M-13 -8 L-21 6 M13 -8 L21 6" stroke="#0A84FF" stroke-width="6" stroke-linecap="round"/>
      <circle cx="0" cy="-27" r="12" fill="#F1C7A0"/><path d="M-12 -30 Q-11 -42 1 -41 Q12 -41 12 -29 Q7 -35 -1 -35 Q-8 -35 -12 -30 Z" fill="#3B2A20"/>
      <circle cx="-4.2" cy="-27" r="1.8" fill="#1C1C1E"/><circle cx="4.2" cy="-27" r="1.8" fill="#1C1C1E"/><path d="M-4 -21 Q0 -18 4 -21" stroke="#7A3B2A" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <rect x="-9" y="13" width="7" height="12" rx="3" fill="#3A3A3C"/><rect x="2" y="13" width="7" height="12" rx="3" fill="#3A3A3C"/></g></svg>`;
  SKT_ART.desk=`<svg viewBox="-46 -26 92 44" width="92" height="44"><g>
      <ellipse cx="0" cy="-6" rx="44" ry="20" fill="rgba(100,210,255,.16)"/><path d="M-16 -2 L-12 -20 L12 -20 L16 -2 Z" fill="#8E8E93"/><path d="M-13 -4 L-10 -18 L10 -18 L13 -4 Z" fill="#64D2FF" class="w5-screen"/>
      <rect x="-40" y="-2" width="80" height="6" rx="3" fill="#C7C7CC"/><rect x="-34" y="4" width="4" height="12" fill="#8E8E93"/><rect x="30" y="4" width="4" height="12" fill="#8E8E93"/></g></svg>`;
  // where the home label sits on the sky, in skit strip units (inverse of skSky). #airYou is translate(X px, Y px) in #airIn.
  function w5HomeStrip(){ let X=AF.cx, Y=AF.my;
    try{ const m=String((($('#airYou')||{}).style||{}).transform||'').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/); if(m){ X=+m[1]; Y=+m[2]; } }catch(e){}
    if(!SKT.useSky||!isFinite(X)||!isFinite(Y)) return [1180,250];
    const W=2*AF.a, H=Math.max(160,AF.floor-AF.top); return [(X-(AF.cx-AF.a))/W*1800,(Y-AF.top)/H*300]; }
  function w5Beam(u,d,on){ let b=document.getElementById('w5beam'); const par=SKT.useSky?$('#skitAir'):$('#skitStage'); if(!par) return;
    if(!b){ b=document.createElement('div'); b.id='w5beam'; par.appendChild(b); }
    if(!on){ b.classList.remove('on'); return; }
    let x0,y0,x1,y1,k=1; if(SKT.useSky){ const A=skSky(u.x,u.y), B=skSky(d[0],d[1]); x0=A[0]; y0=A[1]; x1=B[0]; y1=B[1]; k=A[2]*1.15; } else { x0=u.x; y0=u.y; x1=d[0]; y1=d[1]; }
    const oy=26*k*(u.s||1); y0+=oy; const len=Math.hypot(x1-x0,y1-y0), ang=Math.atan2(y1-y0,x1-x0)*180/Math.PI;
    b.style.cssText=`left:${x0.toFixed(1)}px;top:${y0.toFixed(1)}px;width:${len.toFixed(1)}px;height:${(120*k).toFixed(1)}px;transform:translateY(-50%) rotate(${ang.toFixed(2)}deg)`;
    void b.offsetWidth; b.classList.add('on'); }
  function w5Hum(on){ try{ if(!on){ const h=W5U.hum; W5U.hum=null; if(h){ const t=SND.ctx.currentTime; h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value,t); h.g.gain.linearRampToValueAtTime(0,t+1.2); setTimeout(()=>{ try{ h.o1.stop(); h.o2.stop(); h.l.stop(); }catch(e){} },1400); } return; }
      if(W5U.hum||!skVoiceOK()) return; const c=SND.ctx, g=c.createGain(), o1=c.createOscillator(), o2=c.createOscillator(), l=c.createOscillator(), lg=c.createGain();
      o1.frequency.value=58; o2.type='triangle'; o2.frequency.value=117; l.frequency.value=5.5; lg.gain.value=9; l.connect(lg); lg.connect(o2.frequency);
      g.gain.value=0; o1.connect(g); o2.connect(g); g.connect(skBus()); const t=c.currentTime; g.gain.linearRampToValueAtTime(.05,t+2); o1.start(); o2.start(); l.start();
      W5U.hum={g,o1,o2,l}; SKT.srcs.push({stop:()=>w5Hum(false)}); }catch(e){} }
  async function skitStart(){ tourStop(); TOUR.err=null; TOUR.on=true; TOUR.phase='skit'; skStop(); SKT.on=true; const tok=++SKT.tok; W5U.runs++; W5U.err=null;
    document.body.classList.add('skit','w5ufo'); $('#skitStage').innerHTML=''; SKT.chars={}; SKT.bufs={}; SKT.starDim=0;
    SKT.stars=Array.from({length:130},()=>({x:Math.random()*1800,y:Math.random()*300,r:Math.random()<.2?3:2,w:.5+Math.random()*1.5,p:Math.random()*6}));
    if(S.air&&S.air.length===4&&!AF.q){ try{ airFit(); }catch(e){} }
    SKT.useSky=!!(S.air&&S.air.length===4&&S.corners&&AF.q); SKT.stripDrawn=false;
    document.querySelectorAll('#skitAir .sk-ch,#w5beam').forEach(e=>e.remove());
    { const ss=$('#skAirStars'); if(ss){ let h=''; if(SKT.useSky) for(let i=0;i<90;i++){ const x=AF.cx-AF.a+Math.random()*AF.a*2, y=AF.top+Math.random()*(AF.floor-AF.top), z=5+Math.random()*7;
        h+=`<i style="left:${x|0}px;top:${y|0}px;width:${z.toFixed(1)}px;height:${z.toFixed(1)}px;--o:${(.45+Math.random()*.5).toFixed(2)};--d:${(2.5+Math.random()*4).toFixed(1)}s;--dl:-${(Math.random()*6).toFixed(1)}s"></i>`; }
      ss.innerHTML=h; ss._o=null; } const mo=$('#skMoon'); if(mo) mo.style.opacity=0; }
    SKT.moon={x:1120,y:64,a:0,flick:false}; SKT.raf=requestAnimationFrame(skLoop);
    const h=new Date().getHours(), night=h>=19||h<5, cond=String((D&&D.weather&&(D.weather.condition||D.weather.code))||'').toLowerCase();
    const wx=/rain|drizzle|shower|storm/.test(cond)?'k03r':/cloud|overcast|fog/.test(cond)?'k03k':'k03c';
    try{
      skCard('Close Encounters','of the Kings Road Kind · A Bestly Wall original'); skTween(SKT.moon,'a',1,2500);
      let loaded=0; try{ loaded=await skitLoad(tok); }catch(e){ TOUR.err=String(e.message||e).slice(0,120); if(!SKT.man) throw e; }
      if(!(SKT.man&&SKT.man.lines&&SKT.man.lines.k01n&&SKT.man.lines.k11)){ W5U.err='new voices not built; played the classic skit'; document.body.classList.remove('w5ufo'); skCard(null); return skitStartV1(); }
      await skWait(2600,tok); skCard(null); await skWait(700,tok);
      const home=w5HomeStrip(), sc=skChar('scout'), nb=skChar('nimbus'), pp=skChar('pip'), u7=skChar('unit7'), dk=skChar('desk'), jr=skChar('jared'), uf=skChar('ufo');
      sc.s=.9; nb.s=.95; pp.s=.8; u7.s=.85; dk.s=.8; jr.s=.62; uf.s=.72;
      const hover=[Math.max(120,Math.min(1680,home[0])), home[1]-110>=28?home[1]-110:home[1]+110], jDesk=[home[0],home[1]-12];
      skPlace(sc,620,420,0); skPlace(nb,-180,190,0); skPlace(pp,1950,40,0,{flip:true}); skPlace(u7,2050,52,0); skPlace(uf,2150,-160,0);
      skPlace(dk,home[0],home[1],0); skPlace(jr,jDesk[0],jDesk[1],0); dk.el.style.opacity=0; jr.el.style.opacity=0;
      await skWait(60,tok); skPlace(sc,620,212,1300); dk.el.style.transition='opacity 1.2s'; jr.el.style.transition='opacity 1.2s'; dk.el.style.opacity=1; jr.el.style.opacity=1;
      await skWait(1200,tok); skEmote(sc,'sk-jump',900);
      await skSay(night?'k01n':'k01d',tok);
      skPlace(nb,280,196,3000,{ease:'cubic-bezier(.25,.8,.3,1)'}); await skWait(2600,tok);
      await skSay('k02',tok); nb.el.classList.add('rain'); await skSay(wx,tok); nb.el.classList.remove('rain');
      const pe=skPipEnter(pp,tok); await pe; await skWait(250,tok);
      await skSay('k04',tok); await skSay('k05',tok); skEmote(pp,'sk-jump',900); w5Hum(true); skTween(SKT,'starDim',1,1600); await skSay('k06',tok);
      skPlace(u7,1215,56,2600,{ease:'cubic-bezier(.2,.8,.25,1)'}); u7.el.classList.add('lights'); await skWait(2400,tok); u7.el.classList.add('spot');
      skLookAt('unit7'); await skSay('k07',tok); await skSay('k08',tok);
      // the visitor arrives and parks right over the desk
      u7.el.classList.remove('spot'); skPlace(uf,hover[0]+260,hover[1]-60,2200,{ease:'cubic-bezier(.2,.7,.3,1)'}); await skWait(2200,tok);
      skPlace(uf,hover[0],hover[1],1400,{ease:'cubic-bezier(.34,1.3,.64,1)'}); await skWait(1300,tok);
      skLookAt('ufo'); await skSay('k09',tok); u7.el.classList.add('spot'); await skSay('k10',tok); u7.el.classList.remove('spot');
      skSay('k11',tok,{gap:0}).catch(()=>{}); await skWait(1500,tok); w5Beam(uf,jDesk,true); skLookAt(null,true); await skWait(2000,tok);
      skEmote(sc,'sk-jump',900); await skSay(night?'k12n':'k12d',tok); await skSay('k13',tok,{gap:200});
      // up the beam he goes (spinning slowly, shrinking into the saucer)
      skBubble('jared','Brb!'); jr.rot=0; jr.s=.3;
      skPlace(jr,hover[0],hover[1]+14,3400,{rot:360,ease:'cubic-bezier(.45,0,.35,1)'}); jr.el.style.transition+=',opacity .8s';
      await skWait(3500,tok); jr.el.style.opacity=0; w5Beam(uf,jDesk,false); skBubble(null); skEmote(uf,'sk-jump',900); await skWait(500,tok);
      await skSay('k14',tok);
      skPlace(uf,-260,-140,1300,{ease:'cubic-bezier(.6,0,.9,.4)'}); w5Hum(false); await skWait(900,tok);
      await skSay('k15',tok,{gap:100}); skBubble(null); skPlace(u7,-320,24,4200,{ease:'cubic-bezier(.5,0,.7,.4)'}); await skWait(2400,tok);
      await skSay('k16',tok,{gap:500});
      // ...and back again, one very polite returned human
      skPlace(uf,2150,-160,0); await skWait(80,tok); w5Hum(true); skPlace(uf,hover[0],hover[1],1600,{ease:'cubic-bezier(.2,.8,.25,1.05)'}); await skWait(1700,tok);
      skLookAt('ufo'); w5Beam(uf,jDesk,true); jr.rot=0; jr.s=.3; skPlace(jr,hover[0],hover[1]+14,0); await skWait(40,tok); jr.el.style.opacity=1; jr.s=.62;
      skPlace(jr,jDesk[0],jDesk[1],2600,{rot:0,ease:'cubic-bezier(.3,.7,.3,1)'}); await skSay('k17',tok,{gap:0}); await skWait(700,tok);
      w5Beam(uf,jDesk,false); skPlace(uf,2100,-200,1400,{ease:'cubic-bezier(.6,0,.9,.4)'}); w5Hum(false); skTween(SKT,'starDim',0,1200);
      await skSay('k18',tok,{gap:100}); skBubble('jared','Two.'); await skWait(1700,tok); skBubble(null);
      await skSay('p05',tok,{gap:250}); await skSay('s09',tok,{gap:300});
      await skAll(night?['a1s','a1n','a1p']:['a2s','a2n','a2p'],night?'Go to bed, Jared!':'Go outside, Jared!',tok);
      skBubble(null); await skWait(300,tok); await skSay(night?'k19n':'k19d',tok,{gap:500}); skBubble(null);
      skPlace(nb,-220,180,2600,{ease:'cubic-bezier(.5,0,.75,.4)'}); skPlace(pp,pp.x,pp.y,300,{flip:false,rot:-12}); await skWait(350,tok); skPlace(pp,2000,20,1500,{flip:false,rot:-12,ease:'cubic-bezier(.5,0,.8,.3)'});
      await skWait(700,tok); skPlace(sc,620,430,1200,{ease:'cubic-bezier(.5,0,.8,.4)'}); await skWait(1300,tok);
      skCard('Close Encounters','Starring Scout, Nimbus, Pip, Air Unit Seven and a very polite UFO'); await skWait(4200,tok); skCard(null); await skWait(900,tok);
      if(!loaded&&!TOUR.err) TOUR.err='voices did not load; played with bubbles only';
    }catch(e){ if(e!=='stop'){ TOUR.err=String((e&&e.message)||e).slice(0,160); W5U.err=TOUR.err; } }
    w5Hum(false); const bm=document.getElementById('w5beam'); if(bm) bm.classList.remove('on');
    document.body.classList.remove('w5ufo'); if(SKT.tok===tok) tourStop(); }
