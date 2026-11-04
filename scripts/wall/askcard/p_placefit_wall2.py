import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patchlib import patch
P = sys.argv[1] if len(sys.argv) > 1 else "/opt/bestly/wall/www/wall.html"
patch(P, [
 ("window.__s3pl=()=>({errs:",
  "{ const _pf=bbFitText; bbFitText=function(wf){ _pf(wf); try{ pfFitSub(wf); }catch(e){ V2.errs++; } }; }   /* PLACEFIT_20261103: also covers the non-narrow card */\nwindow.__s3pl=()=>({errs:"),
])
