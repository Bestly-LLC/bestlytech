# FLIGHTV2_P2 wall.html patcher. usage: pc_wall.py in.html out.html
import sys,re
src,dst=sys.argv[1],sys.argv[2]
s=open(src,encoding='utf-8').read()
assert 'FLIGHTV2_P2' not in s, 'already patched'
css=open('v2.css',encoding='utf-8').read()
js=open('v2.js',encoding='utf-8').read().replace('@@CITYLOGO@@',open('cityline.b64').read().strip())
def rep(old,new,cnt=1):
    global s
    assert s.count(old)==cnt,(old[:70],s.count(old))
    s=s.replace(old,new)
rep('</style></head>', css+'\n</style></head>')
rep('  (function airPoll(){ Promise.resolve().then(pullAir)', js+'\n  (function airPoll(){ Promise.resolve().then(pullAir)')
rep('txt=I.short, feat=o===featNow','txt=v2Tag(o,I,I.short), hh=o._v2?60:34, feat=o===featNow')
rep('      if(o.tagEl.textContent!==txt) o.tagEl.textContent=txt;\n','')
rep('[x-r-26-w,y-34,x-r,y+34]:[x+r,y-34,x+r+26+w,y+34]','[x-r-26-w,y-hh,x-r,y+hh]:[x+r,y-hh,x+r+26+w,y+hh]')
rep('if(base&&nLab<5&&','if(base&&nLab<8&&')
rep('(1.25-.62*Math.sqrt(Math.min(1,alt/32000)))','v2Sc(alt)')
rep('if(SKY.rotjs&&o.rotw){ o.rk=','v2Hz(o,alt); if(SKY.rotjs&&o.rotw){ o.rk=')
rep('c.lineTo(t1[0],t1[1]); c.stroke(); });','c.lineTo(t1[0],t1[1]); c.stroke(); });\n    try{ v2Pred(c,proj,kp,now); }catch(e){ SKY.errs++; }')
# no ellipsis in the plane card rules
n=0; out=[]
for ln in s.split('\n'):
    if re.match(r'^(\.bp[ .]|\.ft-|\.ft |\.ac-card)',ln) and 'text-overflow:ellipsis' in ln:
        ln=ln.replace('text-overflow:ellipsis','text-overflow:clip'); n+=1
    out.append(ln)
s='\n'.join(out); assert n>=6,n
open(dst,'w',encoding='utf-8').write(s)
print('wall patched, ellipsis rules removed:',n,'size',len(s))
