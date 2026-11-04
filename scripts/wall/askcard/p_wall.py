import sys
sys.path.insert(0, "/Users/jaredbest/tmp/askship")
from patchlib import patch

blk = open("/Users/jaredbest/tmp/askship/ask_block.js", encoding="utf-8").read()

OLD_SUB = "t.sub2=d.shape==='route'?'':[v.operator&&v.tier!=='airline'?v.operator:'',a.over?"
NEW_SUB = ("/*ASKCARD*/ t.sub2=d.shape==='route'?'':[(((nz)=>{ const p=nz(v.operator), q=nz(v.label); return !!v.operator&&v.tier!=='airline'&&!(p&&q&&(q.indexOf(p)>=0||p.indexOf(q)>=0)); })"
           "(s=>String(s||'').toLowerCase().replace(/\\b(inc|llc|ltd|corp|co|corporation|company|incorporated)\\b/g,'').replace(/[^a-z0-9]+/g,' ').trim()))?v.operator:'',a.over?")  # ASKCARD: operator line hidden when it equals / is inside the title

END = "/* ===== end CARCARD_20261103 ===== */\n"
patch(sys.argv[1], [(OLD_SUB, NEW_SUB), (END, END + blk)])
