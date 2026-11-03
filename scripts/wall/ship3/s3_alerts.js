/* ---- SHIP3 part 1: Local alerts rotate through ALL current alerts (soft fade, "3 of 47" counter) ---- */
const S3AL={items:[],isNew:()=>false,pos:0,len:0,cur:0,t:0,pk:[],seen:{},fading:0,errs:0,hold:6000,fade:260};
function s3AlRank(list,isNew){ return list.slice().sort((a,b)=>(isNew(b)-isNew(a))||((+b.severity||0)-(+a.severity||0))||((+a.dist_ft||1e9)-(+b.dist_ft||1e9))||((+b.first_seen||0)-(+a.first_seen||0))||String(a.key).localeCompare(String(b.key))); }
function s3AlRow(i,isNew){ const c=CIT.reg[i.cat];
  return '<div class="al-r" data-k="'+esc(i.key)+'" style="--r:'+citRGB(c&&c.color)+';--ink:'+citInk(c&&c.color)+'"><div class="al-ic">'+citSvg(c)+'</div><div class="al-tx"><div class="al-t">'+wsSl(esc(i.short||i.title||'Alert'))+(isNew(i)?'<s>NEW</s>':'')+'</div>'+(i.sub?'<div class="al-s">'+alNb(i.sub)+'</div>':'')+'</div></div>'; }
function s3AlEls(){ const el=document.getElementById('wingAlerts'), box=el&&el.querySelector('.al'), pg=box&&box.querySelector('.al-pg'); return pg?{el:el,box:box,pg:pg,ct:box.querySelector('.al-ct')}:null; }
function s3AlRedu(){ try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } }
function s3AlCt(){ const E=s3AlEls(); if(!E||!E.ct) return; const n=S3AL.items.length, a=S3AL.pos+1, b=S3AL.pos+Math.max(1,S3AL.len);
  const tx=(n>S3AL.len||S3AL.len<1)&&n>1?((b>a?a+'–'+b:String(a))+' of '+n):''; if(E.ct.textContent!==tx) E.ct.textContent=tx; E.ct.parentNode.classList.toggle('hc',!!tx); }
/* fit one row's text, then report whether the card still fits (268 css px tall incl. padding) */
function s3AlFitRow(r){ const t=r.querySelector('.al-t'), s=r.querySelector('.al-s'); mnFit(t,26,2); if(s) mnFit(s,20,2); }
function s3AlOver(box){ return box.scrollHeight>269; }
/* build the page that starts at idx: as many rows as fit at the legible size (never wraps past the end of the list) */
function s3AlBuild(idx,maxRows){ const E=s3AlEls(); if(!E) return; const items=S3AL.items, n=items.length; if(!n) return; if(idx>=n||idx<0) idx=0;
  E.pg.innerHTML=''; let cnt=0, keys=[];
  for(let k=idx;k<n&&cnt<(maxRows||99);k++){ E.pg.insertAdjacentHTML('beforeend',s3AlRow(items[k],S3AL.isNew)); const r=E.pg.lastElementChild; s3AlFitRow(r);
    if(cnt>0&&s3AlOver(E.box)){ r.remove(); break; } cnt++; keys.push(items[k].key); }
  S3AL.pos=idx; S3AL.len=cnt; S3AL.pk=keys; S3AL.t=performance.now(); keys.forEach(k=>{ S3AL.seen[k]=1; }); s3AlCt(); }
/* go to a page: soft fade out (opacity only), swap, fade in; reduced motion = plain swap */
function s3AlGo(idx,maxRows,fade){ const E=s3AlEls(); if(!E) return; const seq=(idx===S3AL.cur||S3AL.pk.length===0);
  const done=()=>{ try{ s3AlBuild(idx,maxRows); if(seq) S3AL.cur=S3AL.pos+S3AL.len; if(S3AL.cur>=S3AL.items.length) S3AL.cur=0; E.pg.classList.remove('out'); }catch(e){ S3AL.errs++; V2.errs++; } S3AL.fading=0; };
  if(!fade||s3AlRedu()||!S3AL.pk.length){ done(); return; }
  S3AL.fading=1; E.pg.classList.add('out'); setTimeout(done,S3AL.fade); }
function s3AlTick(){ try{ const E=s3AlEls(); if(!E||AL.sig!=='S3'||S3AL.fading) return; const items=S3AL.items, n=items.length; if(!n) return;
    const amb=(typeof effMode==='function'&&effMode()==='ambient'), now=performance.now();
    if(!S3AL.pk.length){ S3AL.cur=0; s3AlGo(0,amb?1:99,false); return; }
    /* ambient: top alert only, no rotation */
    if(amb){ if(S3AL.pos!==0||S3AL.len!==1||S3AL.pk[0]!==items[0].key){ S3AL.cur=0; s3AlGo(0,1,true); } else s3AlCt(); return; }
    if(S3AL.len===1&&S3AL.pos===0&&n>1&&S3AL.amb){ S3AL.amb=0; S3AL.cur=0; s3AlGo(0,99,true); return; } S3AL.amb=0;
    /* keep the cursor on the same alerts when the list changes under us (new ones sort in, old ones expire) */
    const idxOf=k=>items.findIndex(x=>x.key===k), first=idxOf(S3AL.pk[0]);
    const gone=S3AL.pk.some(k=>idxOf(k)<0), shifted=first>=0&&first!==S3AL.pos;
    if(gone){ const keep=S3AL.pk.map(idxOf).filter(i=>i>=0); S3AL.cur=keep.length?Math.min(...keep):Math.min(S3AL.pos,n-1); s3AlGo(S3AL.cur,99,true); return; }
    if(shifted){ const d=first-S3AL.pos; S3AL.pos=first; S3AL.cur=Math.max(0,Math.min(n-1,S3AL.cur+d)); }
    /* the NEW tag of a shown row changed (5 minute window ended): redraw in place */
    const wantNew=S3AL.pk.map(k=>S3AL.isNew(items[idxOf(k)])?1:0).join(''), haveNew=[...E.pg.querySelectorAll('.al-r')].map(r=>r.querySelector('s')?1:0).join('');
    if(wantNew!==haveNew){ s3AlBuild(S3AL.pos,S3AL.len); }
    if(n<=S3AL.len){ s3AlCt(); return; }    /* everything fits on one page: nothing to rotate */
    if(now-S3AL.t>=S3AL.hold){
      /* a brand-new alert that has not been shown yet jumps the queue once, then the loop carries on where it was */
      let nxt=S3AL.cur>=n?0:S3AL.cur; const pri=items.findIndex(x=>S3AL.isNew(x)&&!S3AL.seen[x.key]); if(pri>=0) nxt=pri;
      s3AlGo(nxt,99,true); } else s3AlCt(); }catch(e){ S3AL.errs++; V2.errs++; S3AL.err=String(e&&e.stack||e); } }
setInterval(s3AlTick,250);
/* citCard hands us the ranked-by-the-page list; this builds the shell once and refreshes the list in place */
function s3AlSet(el,list,isNew){ const items=s3AlRank(list,isNew), amb=(typeof effMode==='function'&&effMode()==='ambient');
  S3AL.items=items; S3AL.isNew=isNew;
  if(AL.sig!=='S3'||!el.querySelector('.al-pg')){ AL.sig='S3'; S3AL.pk=[]; S3AL.len=0; S3AL.pos=0; S3AL.cur=0; S3AL.fading=0; S3AL.amb=amb?1:0;
    el.innerHTML='<div class="al"><div class="al-hd"><span>Local alerts</span><span class="al-ct"></span><span class="al-wn">Within&nbsp;1&nbsp;mi</span></div><div class="al-pg"></div></div>'; }
  if(amb) S3AL.amb=1;
  s3AlTick(); }
/* the shared fit (runs every second and after the bulb padding changes): rows keep their text fit, a page that grew too tall loses its last row, never clipped */
mnAlFit=function(){ try{ const E=s3AlEls(); if(!E) return; const rows=[...E.pg.querySelectorAll('.al-r')]; rows.forEach(s3AlFitRow);
    let len=rows.length; while(len>1&&s3AlOver(E.box)){ rows[len-1].remove(); len--; rows.pop(); }
    if(len!==S3AL.len&&S3AL.pk.length){ const was=S3AL.pos+S3AL.len; S3AL.len=len; S3AL.pk=S3AL.pk.slice(0,len); if(S3AL.cur===was) S3AL.cur=S3AL.pos+len; }
    s3AlCt(); }catch(e){ S3AL.errs++; V2.errs++; } };
window.__s3al=()=>({errs:S3AL.errs,err:S3AL.err||null,n:S3AL.items.length,pos:S3AL.pos,len:S3AL.len,cur:S3AL.cur,age:Math.round(performance.now()-S3AL.t),fading:S3AL.fading,ct:(s3AlEls()||{ct:{}}).ct.textContent,titles:[...document.querySelectorAll('#wingAlerts .al-t')].map(e=>e.textContent)});
{ const st=document.createElement('style'); st.id='ship3al'; st.textContent=`
/* SHIP3_20261103 Local alerts rotation */
#wingAlerts .al-hd{flex-wrap:wrap;row-gap:0}
#wingAlerts .al-wn,#wingAlerts .al-ct{white-space:nowrap}
#wingAlerts .al-ct{font:700 22px/1 var(--sf);letter-spacing:0;text-transform:none;color:rgba(255,255,255,.9);font-variant-numeric:tabular-nums}
#wingAlerts .al-ct:empty{display:none}
#wingAlerts .al-hd.hc .al-wn{order:3;flex:0 0 100%;margin-top:3px;text-align:left}
#wingAlerts .al-pg{opacity:1;transition:opacity .26s ease}
#wingAlerts .al-pg.out{opacity:0}
@media (prefers-reduced-motion:reduce){#wingAlerts .al-pg{transition:none}}
`; document.head.appendChild(st); }
