#!/usr/bin/env python3
"""BRIEFFIT_20261104: morning brief replaces clock + picks (sequential fade), solid card in the same box,
time header instead of temperature, rows wrap to 2 lines and never truncate.
usage: p_brieffit.py <wall.html in> <wall.html out>   (anchored, exact-once)"""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
MARK = "BRIEFFIT_20261104"
if MARK in s: sys.exit("ABORT: already patched")

def once(hay, needle, what):
    n = hay.count(needle)
    if n != 1: sys.exit("ABORT: %s found %d times" % (what, n))
    return hay.index(needle)

# ---------- 1. CSS: replace the whole #briefCss block ----------
a = once(s, '<style id="briefCss">', "css open")
b = s.index('</style>', a) + len('</style>')
CSS = r'''<style id="briefCss">
/* BRIEFFIT_20261104: brief REPLACES the clock card + picks + hourly/daily scenes (fade out first, brief fades in after; reverse on hide). Same box as the middle band: left 0, top 0, 1060 wide (30 px gap before the Scout card at 1090), 300 tall. */
body.bf-hide #board .left,body.bf-hide #board #picks,body.bf-hide #sHourly,body.bf-hide #sDaily{opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:opacity .35s ease,visibility 0s linear .35s!important}
#briefP{position:absolute;left:0;top:0;width:1060px;height:300px;z-index:30;box-sizing:border-box;border-radius:36px;background:linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)),#000;box-shadow:0 0 0 2px rgba(255,255,255,.15) inset,0 0 44px 12px rgba(0,0,0,.55);color:var(--label);font-family:var(--sf);opacity:0;transition:opacity .45s ease;pointer-events:none;overflow:hidden}
#briefP.in{opacity:1}
@media (prefers-reduced-motion:reduce){#briefP{transition:opacity .01s}body.bf-hide #board .left,body.bf-hide #board #picks,body.bf-hide #sHourly,body.bf-hide #sDaily{transition:opacity .01s,visibility 0s!important}}
#briefP .bcol{position:absolute;top:0;height:300px;display:flex;flex-direction:column;justify-content:center}
#briefP .bL{left:36px;width:372px}
#briefP .bR{left:468px;width:560px}
#briefP .brule{position:absolute;left:432px;top:40px;width:1px;height:220px;background:linear-gradient(180deg,rgba(235,235,245,0),rgba(235,235,245,.22) 28%,rgba(235,235,245,.22) 72%,rgba(235,235,245,0))}
#briefP .btime{display:block;font:800 150px/.84 "Big Shoulders Display",var(--sf);white-space:nowrap;color:var(--label)}
#briefP .btime .u{font:600 .3em/1 var(--sf);margin-left:0;letter-spacing:0;color:var(--label-2)}
#briefP .bsm{margin-top:18px;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-.01em;color:var(--label-2)}
#briefP .bsm span{white-space:nowrap}
#briefP .bone{margin-top:8px;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-.01em;color:var(--label)}
#briefP .brow{display:grid;grid-template-columns:32px var(--tw,150px) 1fr;column-gap:0;align-items:start}
#briefP .brow.bg{margin-top:12px}
#briefP .brow .bic{height:32px;display:flex;align-items:center}
#briefP .brow .bic svg{width:24px;height:24px;fill:var(--label-2);color:var(--label-2)}
#briefP .brow .btm{color:var(--label-2);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:26px;line-height:32px;font-weight:600}
#briefP .brow .btx,#briefP .brow .bwide{font-size:26px;line-height:32px;font-weight:600;letter-spacing:-.01em;min-width:0;white-space:normal;overflow:hidden;text-overflow:clip;max-height:64px}
#briefP .brow .btx{grid-column:3}
#briefP .brow .bwide{grid-column:2 / 4}
#briefP .brow .bwide.bl2{color:var(--label-2)}
#briefP .bacc{color:var(--yellow)}
#briefP .bn{white-space:nowrap}
</style>'''
s = s[:a] + CSS + s[b:]

# ---------- 2. JS: off() ----------
a = once(s, 'function off(){ document.body.classList.remove(\'brief-on\')', "off()")
b = s.index('\n', a)
OFF = r'''let leaveT=0, enterT=0;   // BRIEFFIT_20261104
function off(){
  lastSig=''; HB.on=false;
  const e=document.getElementById('briefP');
  if(!e&&!document.body.classList.contains('bf-hide')){ document.body.classList.remove('brief-on'); return; }
  if(leaveT) return;
  clearTimeout(enterT); enterT=0;
  if(e) e.classList.remove('in');                                   // brief fades out first ...
  leaveT=setTimeout(()=>{ leaveT=0; const x=document.getElementById('briefP'); if(x) x.remove(); document.body.classList.remove('bf-hide','brief-on'); },420);   // ... then the clock/picks come back
}'''
s = s[:a] + OFF + s[b:]

# ---------- 3. JS: render() ----------
a = once(s, 'function render(v){', "render")
if s[a:].count('async function poll(){') != 1: sys.exit("ABORT: poll after render not exactly once")
b = s.index('async function poll(){', a)
RENDER = r'''function clk(){ const d=new Date(Date.now()); let h=d.getHours(); const ap=h<12?'AM':'PM'; h=h%12||12; return [h+':'+String(d.getMinutes()).padStart(2,'0'),ap]; }
function fitBrief(el){
  const col=el.querySelector('.bR'), L=el.querySelector('.bL');
  const tm=el.querySelector('.btime'); if(tm){ let fs=150; tm.style.fontSize=fs+'px'; while(tm.scrollWidth>L.clientWidth&&fs>80){ fs-=4; tm.style.fontSize=fs+'px'; } }
  const dropWords=f=>{ if(f.querySelector('span')) return; let w=f.textContent.split(' ');
    const fits=()=>f.scrollHeight<=f.clientHeight+1&&f.scrollWidth<=f.clientWidth+1;
    while(!fits()&&w.length>1){ w.pop(); while(w.length>1&&/^(and|with|of|the|to|a|for|\/|·|-)$/i.test(w[w.length-1])) w.pop(); f.textContent=w.join(' '); } };
  const tms=[...el.querySelectorAll('.btm')]; const tw=Math.max(0,...tms.map(x=>x.scrollWidth))+20; col.style.setProperty('--tw',Math.ceil(tw)+'px');
  for(const f of el.querySelectorAll('.btx,.bwide')) dropWords(f);
  const usedH=()=>{ const a=col.firstElementChild,z=col.lastElementChild; return a?(z.offsetTop+z.offsetHeight-a.offsetTop):0; };
  const fs2=[...el.querySelectorAll('.btx,.bwide')].reverse();
  for(const f of fs2){ if(usedH()<=284) break; f.style.maxHeight='32px'; dropWords(f); }
  let over=0; for(const f of el.querySelectorAll('.btime,.bsm,.bone,.btm,.btx,.bwide')){ if(f.scrollWidth>f.clientWidth+1||(!f.classList.contains('btime')&&f.scrollHeight>f.clientHeight+1)) over++; }
  HB.over=over;
}
function render(v){
  const board=document.getElementById('board'); if(!board) return false;
  const sig=JSON.stringify(v,(k,x)=>k==='day'?undefined:x)+'|'+v.day.getDate();
  let el=document.getElementById('briefP');
  if(sig===lastSig&&el&&!leaveT) return true;
  const rows=[];
  v.evs.forEach((e,i)=>rows.push('<div class="brow"><div class="bic">'+(i?'':ICON('i-cal'))+'</div><div class="btm">'+esc(e.tm)+'</div><div class="btx">'+esc(nb(e.tx))+'</div></div>'));
  v.turo.forEach((e,i)=>rows.push('<div class="brow"><div class="bic">'+(i?'':ICON('i-car'))+'</div><div class="btm">'+esc(e.tm)+'</div><div class="btx">'+esc(nb(e.tx))+'</div></div>'));
  v.sky.forEach((s,i)=>rows.push('<div class="brow'+(i?'':' bg')+'"><div class="bic">'+(i?'':ICON('i-plane'))+'</div><div class="bwide'+(i?' bl2':'')+'">'+esc(s)+'</div></div>'));
  if(v.dig){
    const d1=v.dig.l1.length>1?esc(v.dig.l1[0])+'<span class="bacc">'+esc(v.dig.l1[1])+'</span>':(v.dig.acc?'<span class="bacc">'+esc(v.dig.l1[0])+'</span>':esc(v.dig.l1[0]));
    rows.push('<div class="brow bg"><div class="bic">'+ICON('i-shield')+'</div><div class="bwide">'+d1+'</div></div>');
    if(v.dig.l2) rows.push('<div class="brow"><div class="bic"></div><div class="bwide bl2">'+esc(nb(v.dig.l2))+'</div></div>');
  }
  const dd=v.day, c=clk();
  const html='<div class="brule"></div><div class="bcol bL"><div class="btime" id="briefT">'+c[0]+'<span class="u">'+NB+c[1]+'</span></div>'+
   '<div class="bsm"><span>Good morning</span> · <span>'+DOW[dd.getDay()]+', '+MON[dd.getMonth()]+NB+dd.getDate()+'</span><br><span>'+esc(v.condition)+', high'+NB+v.hi+'°</span></div>'+
   (v.one?'<div class="bone">'+esc(v.one)+'</div>':'')+'</div><div class="bcol bR">'+rows.join('')+'</div>';
  const fresh=!el||!!leaveT;
  if(leaveT){ clearTimeout(leaveT); leaveT=0; }
  if(!el){ el=document.createElement('div'); el.id='briefP'; board.appendChild(el); }
  el.innerHTML=html;
  document.body.classList.add('brief-on','bf-hide');                   // old cards fade out now (.35 s) ...
  fitBrief(el);
  if(fresh&&!el.classList.contains('in')){ clearTimeout(enterT); enterT=setTimeout(()=>{ enterT=0; const x=document.getElementById('briefP'); if(x) x.classList.add('in'); },400); }   // ... brief fades in after
  lastSig=sig; HB.on=true; HB.sig=sig.length;
  return true;
}
setInterval(()=>{ const el=document.getElementById('briefP'), t=document.getElementById('briefT'); if(!el||!t||!HB.on) return; const c=clk(); if(t.firstChild&&t.firstChild.nodeValue!==c[0]){ t.innerHTML=c[0]+'<span class="u">'+NB+c[1]+'</span>'; fitBrief(el); } },5000);
'''
s = s[:a] + RENDER + s[b:]
# grammar: "13 need you" / "1 needs you" (both occurrences are inside build(), exact-twice)
G = "dg.needs+NB+'needs'+NB+'you'"
if s.count(G) != 2: sys.exit("ABORT: needs-you anchor found %d times" % s.count(G))
s = s.replace(G, "dg.needs+NB+(dg.needs===1?'needs':'need')+NB+'you'")
# marker comment
a = once(s, '<!-- BRIEF_20261103 morning brief', "brief comment")
s = s[:a] + '<!-- BRIEFFIT_20261104 patched: see style#briefCss / script#briefJs -->\n' + s[a:]
open(dst, "w", encoding="utf-8").write(s)
print("ok", len(s))
