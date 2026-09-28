import numpy as np, cv2, json
from scipy import ndimage
sk=np.load('skel.npy').astype(np.uint8)
BOX=(572,703,668,792)  # x0,y0,x1,y1 grip blob
sk[BOX[1]:BOX[3],BOX[0]:BOX[2]]=0
H,W=sk.shape
N8=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
def nb(y,x): return [(y+dy,x+dx) for dy,dx in N8 if 0<=y+dy<H and 0<=x+dx<W and sk[y+dy,x+dx]]
def deg_map():
    k=np.ones((3,3));k[1,1]=0
    return ndimage.convolve(sk,k,mode='constant')*sk
def trace_all():
    d=deg_map(); nodes=set(zip(*np.where((d!=2)&(sk>0))))
    seen=set(); edges=[]
    for n in nodes:
        for m in nb(*n):
            if (n,m) in seen: continue
            path=[n,m]; seen.add((n,m)); prev,cur=n,m
            while cur not in nodes:
                nx=[p for p in nb(*cur) if p!=prev and p not in path[-3:]]
                if not nx: break
                prev,cur=cur,nx[0]; path.append(cur)
            seen.add((path[-1],path[-2])); edges.append(path)
    # loops with no nodes
    rest=sk.copy()
    for e in edges:
        for y,x in e: rest[y,x]=0
    return edges,nodes,d
# prune spurs iteratively
for it in range(4):
    edges,nodes,d=trace_all()
    removed=0
    for e in edges:
        a,b=e[0],e[-1]
        if (d[a]==1 or d[b]==1) and len(e)<28 and not (d[a]==1 and d[b]==1 and len(e)>12):
            for p in e:
                if d[p]!=3 and d[p]<3 or p in (a,b) and d[p]==1: sk[p]=0
            removed+=1
    sk=(ndimage.binary_hit_or_miss(sk)==0)*sk if False else sk
    from skimage.morphology import skeletonize
    sk=skeletonize(sk>0).astype(np.uint8)
    print('iter',it,'removed',removed)
edges,nodes,d=trace_all()
# dedupe edges
uniq={}
for e in edges:
    key=tuple(sorted([e[0],e[-1]]))+(len(e),)
    uniq[key]=e
edges=list(uniq.values())
print('edges',len(edges),'nodes',len(nodes))
ends=[n for n in nodes if d[n]==1]
print('endpoints',sorted([(int(x),int(y)) for y,x in ends]))
json.dump([[[int(x),int(y)] for y,x in e] for e in edges],open('edges.json','w'))
vis=cv2.cvtColor(cv2.imread('clean.png',0)//3,cv2.COLOR_GRAY2BGR)
rng=np.random.default_rng(1)
for i,e in enumerate(edges):
    c=tuple(int(v) for v in rng.integers(80,255,3))
    for y,x in e: vis[y,x]=c
    y,x=e[len(e)//2]; cv2.putText(vis,str(i),(x+3,y),cv2.FONT_HERSHEY_SIMPLEX,.4,c,1)
for y,x in ends: cv2.circle(vis,(x,y),4,(0,0,255),1)
cv2.imwrite('edges.png',vis[400:1170,100:1010])
