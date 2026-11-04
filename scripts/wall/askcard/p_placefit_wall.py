import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patchlib import patch
P = sys.argv[1] if len(sys.argv) > 1 else "/opt/bestly/wall/www/wall.html"
FN = r'''/* PLACEFIT_20261103: the place line ("Over Studio City ...") is shortened, never cut: drop generic suffixes, then the "Over" prefix, then trailing words; each step measured in the page */
const PF_SUF=[/\s+Neighborhood\s+Council\b.*$/i,/\s+Neighborhood\s+Co\b.*$/i,/\s+Neighborhood\b.*$/i,/\s+Community\b.*$/i,/^County\s+of\s+/i,/^City\s+of\s+/i,/\s+Council\b.*$/i];
function pfStrip(n){ let s=String(n).trim(); PF_SUF.forEach(r=>{ const t=s.replace(r,'').trim(); if(t) s=t; }); return s; }
function pfFits(e,txt){ e.textContent=txt; e.style.fontSize=''; if(!e.clientWidth) return true; let s=parseFloat(getComputedStyle(e).fontSize)||40; while(e.scrollWidth>e.clientWidth+1&&s>34){ s=Math.max(34,s-2); e.style.fontSize=s+'px'; } return e.scrollWidth<=e.clientWidth+1; }
function pfFitSub(wf){ const sub=wf.querySelector('.v2sub'); if(!sub||!sub.textContent||!sub.clientWidth) return;
  const parts=sub.textContent.split(' · '), i=parts.findIndex(p=>/^Over\s/.test(p)); if(i<0) return;
  const raw=parts[i].replace(/^Over\s+/,''), short=pfStrip(raw), w=short.split(/\s+/), c=['Over '+raw];
  if(short!==raw) c.push('Over '+short); c.push(short); for(let k=w.length-1;k>=1;k--) c.push(w.slice(0,k).join(' '));
  const others=parts.filter((p,j)=>j!==i), seen={};
  for(const keep of [others,[]]) for(const cand of c){ if(seen[keep.length+'|'+cand]) continue; seen[keep.length+'|'+cand]=1; const txt=keep.concat([cand]).join(' · '); if(pfFits(sub,txt)) return; }
  sub.textContent=parts.join(' · '); }
'''
patch(P, [
 ("const _s3bf=bbFitText;\n", FN + "const _s3bf=bbFitText;\n"),
 ("    wf.querySelectorAll('.v2mt,.v2sub,.v2lands,.ft-ct span').forEach(e=>bbFitEl(e,34)); s3PlVFit(wf);\n    /* still taller",
  "    try{ pfFitSub(wf); }catch(e){ V2.errs++; }   /* PLACEFIT_20261103 */\n    wf.querySelectorAll('.v2mt,.v2sub,.v2lands,.ft-ct span').forEach(e=>bbFitEl(e,34)); s3PlVFit(wf);\n    /* still taller"),
])
