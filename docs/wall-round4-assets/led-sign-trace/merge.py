import numpy as np, json, cv2, math
from scipy import ndimage
edges=[np.array(e,float) for e in json.load(open('edges.json'))]
sk=np.load('skel.npy')
# junction clusters: endpoints of edges; cluster endpoints within 6px
pts=[]
for i,e in enumerate(edges):
    pts.append((i,0,e[0])); pts.append((i,1,e[-1]))
clusters=[]
def find(p):
    for ci,c in enumerate(clusters):
        if np.linalg.norm(np.mean(c['p'],0)-p)<7: return ci
    return None
for i,s,p in pts:
    ci=find(p)
    if ci is None: clusters.append({'p':[p],'m':[(i,s)]})
    else: clusters[ci]['p'].append(p); clusters[ci]['m'].append((i,s))
cen=[np.mean(c['p'],0) for c in clusters]
endc={}
for ci,c in enumerate(clusters):
    for i,s in c['m']: endc[(i,s)]=ci
# drop tiny intra-cluster edges
E={}
for i,e in enumerate(edges):
    a,b=endc[(i,0)],endc[(i,1)]
    L=np.sum(np.linalg.norm(np.diff(e,axis=0),axis=1))
    if a==b and L<20: continue
    e=np.vstack([cen[a],e[1:-1],cen[b]]) if len(e)>2 else np.vstack([cen[a],cen[b]])
    E[i]=(a,b,e)
print('edges after',len(E))
adj={}
for i,(a,b,e) in E.items(): adj.setdefault(a,[]).append(i); adj.setdefault(b,[]).append(i)
def dir_at(e,end,k=14):
    # direction pointing OUT of the node along edge
    if end==0: q=e[min(k,len(e)-1)]-e[0]
    else: q=e[max(-k-1,-len(e))]-e[-1]
    return q/(np.linalg.norm(q)+1e-9)
used=set(); strokes=[]
def walk(start_edge, start_node):
    a,b,e=E[start_edge]; path=list(e if a==start_node else e[::-1]); used.add(start_edge)
    node=b if a==start_node else a
    while True:
        indir=path[-1]-path[max(-15,-len(path))]; indir/=np.linalg.norm(indir)+1e-9
        best=None;bc=math.cos(math.radians(55))
        for j in adj.get(node,[]):
            if j in used: continue
            a2,b2,e2=E[j]; end=0 if a2==node else 1
            c=float(np.dot(indir,dir_at(e2,end)))
            if c>bc: bc=c;best=(j,end)
        if not best: break
        j,end=best; used.add(j); a2,b2,e2=E[j]
        seg=e2 if end==0 else e2[::-1]; path+=list(seg[1:]); node=b2 if end==0 else a2
    return np.array(path)
# order: start from degree-1 nodes, then longest unused edges
deg={n:len(v) for n,v in adj.items()}
for n,v in adj.items():
    if deg[n]==1 and v[0] not in used: strokes.append(walk(v[0],n))
while len(used)<len(E):
    i=max((k for k in E if k not in used), key=lambda k: len(E[k][2]))
    a,b,e=E[i]
    fwd=walk(i,a)
    # extend backwards from a
    used_before=set(used)
    rest=[]
    node=a
    # try extend backward
    back=None
    indir=-dir_at(e,0)
    best=None;bc=math.cos(math.radians(55))
    for j in adj.get(a,[]):
        if j in used: continue
        a2,b2,e2=E[j]; end=0 if a2==a else 1
        c=float(np.dot(indir*-1*-1, dir_at(e2,end)))
        if c>bc: bc=c;best=(j,end)
    if best:
        bk=walk(best[0],a); fwd=np.vstack([bk[::-1],fwd[1:]])
    strokes.append(fwd)
def length(p): return float(np.sum(np.linalg.norm(np.diff(p,axis=0),axis=1)))
strokes.sort(key=length,reverse=True)
print('strokes',len(strokes),[round(length(s)) for s in strokes])
np.save('strokes.npy',np.array(strokes,dtype=object),allow_pickle=True)
vis=cv2.cvtColor(cv2.imread('clean.png',0)//3,cv2.COLOR_GRAY2BGR)
rng=np.random.default_rng(3)
for i,s in enumerate(strokes):
    c=tuple(int(v) for v in rng.integers(90,255,3))
    cv2.polylines(vis,[s.astype(np.int32).reshape(-1,1,2)],False,c,2)
    x,y=s[len(s)//2].astype(int); cv2.putText(vis,str(i),(x+4,y),cv2.FONT_HERSHEY_SIMPLEX,.5,c,1)
cv2.imwrite('strokes.png',vis[400:1170,100:1010])
