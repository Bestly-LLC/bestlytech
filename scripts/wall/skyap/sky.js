/* ===== SKYAP_20261102: airports on the sky (runways, glow, approach corridor, pills), landing / taking-off planes, airline logos ===== */
const AP={
 LAX:{n:'Los Angeles Intl',c:'#0A84FF',t:'#fff',ll:[33.9425,-118.4081],r:[['6L',33.949119,-118.431187,'24R',33.952112,-118.401954],['6R',33.94682,-118.434693,'24L',33.95047,-118.399063],['7L',33.935556,-118.422089,'25R',33.939881,-118.379794],['7R',33.933659,-118.419074,'25L',33.937371,-118.3827]]},
 BUR:{n:'Hollywood Burbank',c:'#FFB340',t:'#3a2400',ll:[34.2007,-118.359],r:[['8',34.197918,-118.369165,'26',34.197654,-118.349982],['15',34.212342,-118.360479,'33',34.193908,-118.355392]]},
 ONT:{n:'Ontario Intl',c:'#30D158',t:'#0a2e14',ll:[34.056,-117.6012],r:[['8L',34.0569,-117.623,'26R',34.0569,-117.583],['8R',34.055,-117.616,'26L',34.055,-117.583]]}};
const APX={els:{},logo:{},lq:[],lAt:0,drawn:0};
const apRgb=h=>{ const n=parseInt(h.slice(1),16); return (n>>16&255)+','+(n>>8&255)+','+(n&255); };
const apOn=()=>S.skyLandmarks!==false&&S.airShow!==false&&!S.mapping&&!!$('#air')&&$('#air').classList.contains('on');
const apD2R=Math.PI/180;
function apBrg(a,b,c,d){ const p1=a*apD2R,p2=c*apD2R,dl=(d-b)*apD2R, y=Math.sin(dl)*Math.cos(p2), x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl); return (Math.atan2(y,x)/apD2R+360)%360; }
function apMi(a,b,c,d){ const p1=a*apD2R,p2=c*apD2R,dp=p2-p1,dl=(d-b)*apD2R, h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return 7917.6*Math.asin(Math.min(1,Math.sqrt(h))); }
const apAd=(a,b)=>Math.abs((a-b+540)%360-180);
const apComp=b=>['north','northeast','east','southeast','south','southwest','west','northwest'][Math.round(b/45)%8];
const apT12=s=>String(s||'').replace(/\s+/g,NBP);
function apEnds(A){ const out=[]; A.r.forEach(r=>{ out.push({nm:r[0],la:r[1],lo:r[2],h:apBrg(r[1],r[2],r[4],r[5])}); out.push({nm:r[3],la:r[4],lo:r[5],h:apBrg(r[4],r[5],r[1],r[2])}); }); return out; }
function apBd(code){ const b=V2.board&&V2.board.airports&&V2.board.airports[code]; return b||null; }
/* point d miles out along the reverse of heading h from (la,lo), w miles to the side */
function apPt(la,lo,h,d,w){ const hr=(h+180)*apD2R, hp=(h+90)*apD2R, cl=Math.cos(la*apD2R)*69.17;
  return [la+(Math.cos(hr)*d+Math.cos(hp)*(w||0))/69.0, lo+(Math.sin(hr)*d+Math.sin(hp)*(w||0))/cl]; }
function apPh(o){ const v=(o&&o.a&&o.a.v2&&o.a.v2.fz)?o.a.v2:vc(o); return (v&&v.fz&&AP[v.fa])?{z:v.fz,a:v.fa,m:v.fm}:null; }
/* ---- canvas layer (runways, glow, corridor, ticks, chevrons, dotted landing paths); drawn from drawTrails ---- */
function apDraw(c,proj,kp,now){ if(!apOn()||!AF.ppn) return; let n=0;
  const Q=(la,lo)=>airXY(la,lo), P=(la,lo)=>{ const q=airXY(la,lo); return proj(q[0],q[1]); };
  for(const code of Object.keys(AP)){ const A=AP[code], cp=Q(A.ll[0],A.ll[1]);
    if(apMi(airHome[0],airHome[1],A.ll[0],A.ll[1])>RADMI()*1.8+3) continue;
    const fr=scrFrame(proj,cp[0],cp[1]); if(!fr) continue; const rgb=apRgb(A.c), B=apBd(code), ends=apEnds(A);
    const busy=!!(B&&(B.arrivals||[]).length);
    /* glow under the field: radial, feathered to 0 */
    let rs=0; ends.forEach(e=>{ const p=P(e.la,e.lo),f=proj(cp[0],cp[1]); if(p&&f) rs=Math.max(rs,Math.hypot(p[0]-f[0],p[1]-f[1])); });
    const Rg=Math.max(rs*1.25,60); c.save(); frIn(c,fr); const gg=c.createRadialGradient(0,0,0,0,0,Rg);
    gg.addColorStop(0,`rgba(${rgb},${busy?.38:.22})`); gg.addColorStop(.5,`rgba(${rgb},${busy?.16:.08})`); gg.addColorStop(1,`rgba(${rgb},0)`); c.fillStyle=gg; c.fillRect(-Rg,-Rg,Rg*2,Rg*2); c.restore();
    /* runway strips */
    c.save(); c.lineCap='round'; A.r.forEach(r=>{ const p1=P(r[1],r[2]),p2=P(r[4],r[5]); if(!p1||!p2) return;
      c.strokeStyle=`rgba(${rgb},.28)`; c.lineWidth=13; c.beginPath(); c.moveTo(p1[0],p1[1]); c.lineTo(p2[0],p2[1]); c.stroke();
      c.strokeStyle='rgba(242,242,247,.96)'; c.lineWidth=5; c.beginPath(); c.moveTo(p1[0],p1[1]); c.lineTo(p2[0],p2[1]); c.stroke(); }); c.restore();
    /* approach corridor: only while arrivals exist and a flow is known */
    if(busy&&B.flow_hdg!=null){ const act=ends.filter(e=>apAd(e.h,B.flow_hdg)<=25), pick=[];
      act.forEach(e=>{ if(!pick.some(k=>apMi(k.la,k.lo,e.la,e.lo)<.6)) pick.push(e); });
      pick.forEach(e=>{ const S6=[0,2,4,6,8,10], pc=d=>P(...apPt(e.la,e.lo,e.h,d,0)), p0=pc(0), p10=pc(10); if(!p0||!p10) return;
        [[.62,1],[.4,.8],[.2,.6]].forEach(([hw,al])=>{ const L=S6.map(d=>P(...apPt(e.la,e.lo,e.h,d,-hw))), Rr=S6.map(d=>P(...apPt(e.la,e.lo,e.h,d,hw)));
          if(L.some(x=>!x)||Rr.some(x=>!x)) return; const g2=c.createLinearGradient(p0[0],p0[1],p10[0],p10[1]);
          g2.addColorStop(0,`rgba(${rgb},${(.34*al).toFixed(2)})`); g2.addColorStop(1,`rgba(${rgb},0)`); c.fillStyle=g2; c.beginPath(); c.moveTo(L[0][0],L[0][1]);
          L.slice(1).forEach(p=>c.lineTo(p[0],p[1])); Rr.slice().reverse().forEach(p=>c.lineTo(p[0],p[1])); c.closePath(); c.fill(); });
        /* 3 static chevrons pointing at the runway */
        c.save(); c.lineCap='round'; c.lineJoin='round'; [1.6,3.2,4.8].forEach((d,i)=>{ const a=pc(d), b=pc(d-.3); if(!a||!b) return; let ux=b[0]-a[0],uy=b[1]-a[1]; const l=Math.hypot(ux,uy)||1; ux/=l; uy/=l; const z=12, vx=-uy,vy=ux;
          c.strokeStyle=`rgba(${rgb},${(.92-i*.2).toFixed(2)})`; c.lineWidth=4; c.beginPath(); c.moveTo(a[0]-ux*z*.2+vx*z*1.2,a[1]-uy*z*.2+vy*z*1.2); c.lineTo(a[0]+ux*z,a[1]+uy*z); c.lineTo(a[0]-ux*z*.2-vx*z*1.2,a[1]-uy*z*.2-vy*z*1.2); c.stroke(); }); c.restore();
        /* ticks at 5 and 10 mi */
        [5,10].forEach(d=>{ const a=P(...apPt(e.la,e.lo,e.h,d,-.55)), b=P(...apPt(e.la,e.lo,e.h,d,.55)); if(!a||!b) return;
          c.save(); c.lineCap='round'; c.strokeStyle=`rgba(${rgb},.9)`; c.lineWidth=3; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.stroke(); c.restore();
          const tq=Q(...apPt(e.la,e.lo,e.h,d,.95)), tf=scrFrame(proj,tq[0],tq[1]); if(tf){ c.save(); frIn(c,tf); c.font='800 19px '+(getComputedStyle(document.body).getPropertyValue('--sf')||'-apple-system,system-ui,sans-serif'); c.textAlign='center'; c.textBaseline='middle'; c.lineJoin='round';
            c.lineWidth=5; c.strokeStyle='rgba(0,0,0,.7)'; c.strokeText(d+NBP+'mi',0,0); c.fillStyle='#fff'; c.fillText(d+NBP+'mi',0,0); c.restore(); } });
        /* active runway end label just before the threshold */
        const lq=Q(...apPt(e.la,e.lo,e.h,.55,0)), lf=scrFrame(proj,lq[0],lq[1]); if(lf){ c.save(); frIn(c,lf); c.font='800 22px '+(getComputedStyle(document.body).getPropertyValue('--sf')||'-apple-system,system-ui,sans-serif'); c.textAlign='center'; c.textBaseline='middle'; c.lineJoin='round';
          c.lineWidth=6; c.strokeStyle='rgba(0,0,0,.75)'; c.strokeText(e.nm,0,0); c.fillStyle=A.c; c.fillText(e.nm,0,0); c.restore(); } }); }
    n++; }
  /* dotted path: landing plane -> nearest aligned threshold */
  c.save(); Object.values(AIRS).forEach(o=>{ try{ if(!o.disp||o.gone||o.entering||!(o.op>.3)) return; const ph=apPh(o); if(!ph||ph.z!=='arr') return; const A=AP[ph.a], ends=apEnds(A), tr=o.a.track;
      let cand=tr!=null?ends.filter(e=>apAd(e.h,tr)<=40):[]; if(!cand.length) cand=ends; let best=null,bd=1e9;
      cand.forEach(e=>{ const q=Q(e.la,e.lo), d=Math.hypot(q[0]-o.disp[0],q[1]-o.disp[1]); if(d<bd){ bd=d; best=q; } }); if(!best) return;
      const p0=proj(o.disp[0],o.disp[1]), p1=proj(best[0],best[1]); if(!p0||!p1) return; const len=Math.hypot(p1[0]-p0[0],p1[1]-p0[1]), N=Math.min(36,Math.floor(len/24)); if(N<1) return;
      const rgb=apRgb(A.c); for(let i=1;i<=N;i++){ const t=i/(N+1); c.fillStyle=`rgba(${rgb},${(.85*o.op).toFixed(3)})`; c.beginPath(); c.arc(p0[0]+(p1[0]-p0[0])*t,p0[1]+(p1[1]-p0[1])*t,3.4,0,6.2832); c.fill(); }
    }catch(e){ V2.errs++; } }); c.restore();
  APX.drawn=n; }
/* ---- airport pills (DOM, upright, in #airPlanes like the edge pills) ---- */
const AP_CHEV='<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M8 4l8 8-8 8"/></svg>';
function apStatus(code){ const B=apBd(code); if(!B) return {q:1,t:'No arrivals now'};
  if(B.night) return {q:0,t:'Landing east · Over the ocean'};
  if((B.arrivals||[]).length){ return {q:0,t:'Landing'+(B.flow?' '+B.flow:'')+' · next'+NBP+apT12(B.next_eta)}; } return {q:1,t:'No arrivals now'}; }
function apPills(){ const box=$('#airPlanes'); if(!box) return; const on=apOn(); const keep={};
  if(on&&AF.ppn) Object.keys(AP).forEach(code=>{ const A=AP[code], p=airXY(A.ll[0],A.ll[1]), st=apStatus(code), dmi=apMi(airHome[0],airHome[1],A.ll[0],A.ll[1]);
    const hv=obHold(p[0],p[1]+70,150,70,0), inb=hv[2]; keep[code]=1; let e=APX.els[code];
    if(!e){ e=document.createElement('div'); e.className='apl'; e.style.setProperty('--c',A.c); e.style.setProperty('--t',A.t); e.style.setProperty('--r',apRgb(A.c));
      e.innerHTML='<div class="in"><i class="cb">'+code+'</i><div class="tx"><b></b><span></span></div><div class="ch"></div></div>'; box.appendChild(e); APX.els[code]=e; }
    const b1=e.querySelector('b'), s1=e.querySelector('span'), ch=e.querySelector('.ch');
    const t1=inb?A.n:(A.n+' · '+Math.round(dmi)+NBP+'mi '+apComp(apBrg(airHome[0],airHome[1],A.ll[0],A.ll[1])));
    if(b1.textContent!==t1) b1.textContent=t1; if(s1.textContent!==st.t) s1.textContent=st.t; e.classList.toggle('q',!!st.q);
    if(inb){ if(ch.innerHTML) ch.innerHTML=''; } else { if(!ch.innerHTML) ch.innerHTML=AP_CHEV; const hx=AF.hx??AF.cx, hy=AF.hy??AF.my; ch.style.transform='rotate('+(Math.atan2(p[1]-hy,p[0]-hx)/apD2R).toFixed(0)+'deg)'; }
    e.style.transform=skyPt(hv[0],hv[1]); });
  Object.keys(APX.els).forEach(k=>{ if(!keep[k]){ APX.els[k].remove(); delete APX.els[k]; } }); }
/* ---- logos: one at a time, 2.2 s apart (the Pi allows 1 fetch / 2 s); the tag shows the code tile until the logo is there ---- */
function apLogoAsk(ic){ if(!ic||!/^[A-Z]{3}$/.test(ic)) return; const s=APX.logo[ic]; if(s==='ok'||s==='pend'||(s&&s.no&&Date.now()-s.no<600000)||(s&&s.wait&&Date.now()<s.wait)) return; APX.logo[ic]='pend'; APX.lq.push(ic); }
async function apLogoStep(){ try{ if(!APX.lq.length||Date.now()-APX.lAt<2200) return; APX.lAt=Date.now(); const ic=APX.lq.shift();
    const r=await fetch('/logos/'+ic+'.png',{cache:'force-cache'});
    if(r.status===200){ APX.logo[ic]='ok'; APX.lv=(APX.lv||0)+1; return; }
    let busy=false; try{ busy=((await r.json()).error==='busy'); }catch(e){}
    APX.logo[ic]=busy?{wait:Date.now()+5000}:{no:Date.now()}; }catch(e){ V2.errs++; } }
/* ---- plane tint: whole icon, trail and ring take the airport color (default; type colors return if Jared wants badge + ring only) ---- */
const _acInfoSK=acInfo;
acInfo=function(a){ const I=_acInfoSK(a); try{ const v=a&&a.v2; if(v&&v.fz&&AP[v.fa]){ return Object.assign({},I,{color:AP[v.fa].c}); } }catch(e){ V2.errs++; } return I; };
function apRings(){ Object.values(AIRS).forEach(o=>{ try{ if(!o.el) return; const ph=apPh(o); let r=o._apr;
    if(ph&&!r){ r=o._apr=document.createElement('i'); r.className='apr'; o.el.appendChild(r); }
    if(!r) return; const k=ph?ph.a:''; if(o._apk!==k){ o._apk=k; if(ph) r.style.setProperty('--ac',AP[ph.a].c); o.el.classList.toggle('apph',!!ph); }
    const sc=ph?(o.sc||1).toFixed(2):'1'; if(o._aps!==sc){ o._aps=sc; r.style.transform='scale('+sc+')'; } }catch(e){ V2.errs++; } }); }
/* ---- tag: logo tile + phase badge + phase line 2 ---- */
const _v2TagSK=v2Tag;
v2Tag=function(o,I,txt){ const v=vc(o); if(!v||!v.label) return _v2TagSK(o,I,txt); const el=o.tagEl;
  const fv=(o.a&&o.a.v2&&o.a.v2.fz)?o.a.v2:v, ph=(fv.fz&&AP[fv.fa])?{z:fv.fz,a:fv.fa,m:fv.fm}:null, ic=v.al||(o.a.v2&&o.a.v2.al)||'', ia=v.ai||(o.a.v2&&o.a.v2.ai)||'';
  if(ic) apLogoAsk(ic);
  const em=v2em(v), nt=!em&&v2nt(v), altN=o.a.alt!=null?(Math.round(o.a.alt/100)*100).toLocaleString('en-US')+NBP+'ft':'';
  const ty=v.tier==='airline'?(v.type_code||v.type_name||''):(v.type_name||v.type_code||'');
  let l2=em?((/^\d{4}$/.test(em)?'SQUAWK '+em:'EMERGENCY')+(altN?' · '+altN:'')):[ty,altN].filter(Boolean).join(' · ');
  if(!em&&ph){ const AC=ph.a; l2=ph.z==='arr'?('Landing '+AC+((ph.m==null||ph.m<1)?' now':' in '+ph.m+NBP+'min')+(altN?' · '+altN:'')):('Took off '+AC+(altN?' · climbing '+altN:'')); }
  const logoOk=APX.logo[ic]==='ok', lgOn=!!(ic||ia||ph), k=v.label+'|'+l2+'|'+(nt?1:0)+(em?1:0)+'|'+(ph?ph.z+ph.a:'')+'|'+ic+(logoOk?1:0);
  if(o._v2k!==k){ o._v2k=k; o._v2=1; el.classList.add('v2'); el.classList.toggle('sos',!!em); el.classList.toggle('nt',!!nt); el.classList.toggle('lgo',lgOn);
    const sz=ph?56:50, code=ia||ic;
    const lg=(ic||ia)?`<div class="lgw" style="width:${sz}px;height:${sz}px"><i class="lg${logoOk?' ok':''}" style="width:${sz}px;height:${sz}px">${logoOk?`<img src="/logos/${esc(ic)}.png" width="${sz}" height="${sz}" decoding="async" alt="">`:`<s>${esc(code)}</s>`}</i>${ph?apBadge(ph):''}</div>`:(ph?`<div class="lgw" style="width:${sz}px;height:${sz}px"><i class="lg" style="width:${sz}px;height:${sz}px"><s>${ph.a}</s></i>${apBadge(ph)}</div>`:'');
    el.innerHTML=lg+'<div class="tx"><b>'+esc(v.label)+(nt?'<em>NOTABLE</em>':'')+'</b><span>'+esc(l2)+'</span></div>'; }
  return 'x'.repeat(Math.max(v.label.length+(nt?8:0)+(lgOn?4:0),Math.ceil(l2.length*.72)+(lgOn?4:0))); };
function apBadge(ph){ const A=AP[ph.a], d=ph.z==='arr'?'M12 5v13M6 13l6 6 6-6':'M12 19V6M6 11l6-6 6 6';
  return `<u class="pb" style="--c:${A.c};--t:${A.t}"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg></u>`; }
/* ---- board only counts LAX + BUR (ONT is far outside the 15 mi feed) ---- */
v2BoardOn=function(){ const b=V2.board; if(!b||!b.airports) return false; if(!['LAX','BUR'].some(k=>b.airports[k]&&(b.airports[k].arrivals||[]).length)) return false; return Date.now()%80000<12000; };
setInterval(()=>{ try{ apPills(); apRings(); }catch(e){ V2.errs++; } },1000);
setInterval(apLogoStep,500);
{ const _dbg=window.__v2; window.__v2=()=>Object.assign(_dbg(),{ap:APX.drawn,apPills:Object.keys(APX.els).length,logos:Object.values(APX.logo).filter(x=>x==='ok').length,phased:Object.values(AIRS).filter(o=>apPh(o)).length,logoImgs:document.querySelectorAll('#airPlanes .tag .lg img').length,codeTiles:document.querySelectorAll('#airPlanes .tag .lg s').length}); }
/* ===== end SKYAP_20261102 ===== */
