import numpy as np, cv2, json
from scipy import ndimage
strokes=list(np.load('strokes.npy',allow_pickle=True))
L=lambda p: float(np.sum(np.linalg.norm(np.diff(p,axis=0),axis=1)))
keep=[s for s in strokes if L(s)>40]
print('kept',len(keep),[round(L(s)) for s in keep])
# grip: arm outer top joins leg line; three finger coils; wrist line joins bottom finger
man=[
 [(571,735),(580,724),(592,716),(608,712),(626,710),(642,711),(650,707),(655,702)],
 [(584,745),(596,739),(612,735),(628,733),(641,733),(647,737),(646,742)],
 [(598,760),(610,755),(626,752),(642,751),(653,753),(657,758),(655,763)],
 [(605,792),(603,786),(610,779),(624,773),(640,771),(652,772),(657,777),(655,783)],
]
man=[np.array(m,float) for m in man]
def resample(p,step=2.0):
    d=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    t=np.arange(0,d[-1],step); t=np.r_[t,d[-1]]
    return np.stack([np.interp(t,d,p[:,0]),np.interp(t,d,p[:,1])],1)
def smooth(p,sig):
    closed=np.linalg.norm(p[0]-p[-1])<3
    q=p.copy()
    mode='wrap' if closed else 'nearest'
    q[:,0]=ndimage.gaussian_filter1d(p[:,0],sig,mode=mode); q[:,1]=ndimage.gaussian_filter1d(p[:,1],sig,mode=mode)
    if not closed: q[0]=p[0]; q[-1]=p[-1]
    return q
def rdp(p,eps):
    if len(p)<3: return p
    a,b=p[0],p[-1]; ab=b-a; n=np.linalg.norm(ab)
    d=np.abs(np.cross(ab,p-a))/n if n>0 else np.linalg.norm(p-a,axis=1)
    i=int(np.argmax(d))
    if d[i]>eps: return np.vstack([rdp(p[:i+1],eps)[:-1],rdp(p[i:],eps)])
    return np.vstack([a,b])
allp=[]
for s in keep: allp.append(smooth(resample(s),2.5))
for m in man: allp.append(smooth(resample(m,1.0),1.5))
# purple -> grid photo
Hh=np.load('H_hom.npy')
def T(p,x):
    a,b,c,d,e,f,g_,h=x; w=g_*p[:,0]+h*p[:,1]+1
    return np.stack([(a*p[:,0]+b*p[:,1]+c)/w,(d*p[:,0]+e*p[:,1]+f)/w],1)
Mi=np.load('Mi.npy'); O6=np.load('O6.npy')
def photo2norm(p):
    uv=(np.asarray(p)-O6)@Mi.T
    return np.stack([2/12+uv[:,0]/960, 6/8+uv[:,1]/540],1)
RW,RH=960,540
refp=[photo2norm(T(p,Hh))*[RW,RH] for p in allp]
allr=np.vstack(refp)
x0,y0=allr.min(0); x1,y1=allr.max(0)
cx,cy=(x0+x1)/2,(y0+y1)/2
print('bbox ref px',x0,y0,x1,y1,'size',x1-x0,y1-y0,'center norm',cx/RW,cy/RH)
out=[]
for p in refp:
    q=rdp(p-[cx,cy],0.06)
    out.append(q)
print('points',sum(len(q) for q in out))
def path_d(q):
    # smooth quadratic through midpoints (like sigPath)
    f=lambda v: ('%.2f'%v).rstrip('0').rstrip('.')
    d='M%s %s'%(f(q[0,0]),f(q[0,1]))
    if len(q)==2: return d+'L%s %s'%(f(q[1,0]),f(q[1,1]))
    for i in range(1,len(q)-1):
        m=(q[i]+q[i+1])/2
        d+='Q%s %s %s %s'%(f(q[i,0]),f(q[i,1]),f(m[0]),f(m[1]))
    return d+'L%s %s'%(f(q[-1,0]),f(q[-1,1]))
paths=[path_d(q) for q in out]
lens=[round(L(q),1) for q in out]
# acrylic plate hull: dilate the tube mask (purple), fill, contour
m=np.load('mask.npy')
k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(61,61))
plate=cv2.morphologyEx(cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(41,41))),cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(121,121)))
plate=ndimage.binary_fill_holes(plate).astype(np.uint8)
cs,_=cv2.findContours(plate,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
c=max(cs,key=cv2.contourArea)[:,0,:].astype(float)
c=smooth(resample(np.vstack([c,c[:1]]),3),3)
hull=photo2norm(T(c,Hh))*[RW,RH]-[cx,cy]
hull=rdp(hull,0.25)
print('hull pts',len(hull))
hd='M'+' L'.join('%.1f %.1f'%(a,b) for a,b in hull[:-1])+'Z'
geo={'cx':round(cx/RW,5),'cy':round(cy/RH,5),'ref':[RW,RH],'box':[round(x0-cx,2),round(y0-cy,2),round(x1-cx,2),round(y1-cy,2)],
     'tube':round(8.5*2*0.965/9.66,2),'paths':paths,'lens':lens,'plate':hd}
json.dump(geo,open('lsign_geo.json','w'))
print(json.dumps({k:v for k,v in geo.items() if k not in('paths','plate')}))
print('bytes',len(json.dumps(geo)))
# verification: back-project onto grid photo
g=cv2.imread('/home/claude/ws-r4-w8/docs/wall-round4-assets/led-sign-grid-C6-C7.jpg')
M=np.linalg.inv(Mi)
def norm2photo(n):
    uv=np.stack([(n[:,0]-2/12)*960,(n[:,1]-6/8)*540],1); return uv@M.T+O6
for q in out:
    pp=norm2photo((q+[cx,cy])/[RW,RH]); cv2.polylines(g,[pp.astype(np.int32).reshape(-1,1,2)],False,(255,0,255),2)
pp=norm2photo((hull+[cx,cy])/[RW,RH]); cv2.polylines(g,[pp.astype(np.int32).reshape(-1,1,2)],True,(0,255,255),2)
cv2.imwrite('verify.png',g[380:1250,100:1100])
# uniform polyline samples (ref px, relative to center) for cheap masks: every ~1.5 ref px
pts=[]
for p in refp:
    q=p-[cx,cy]; r=resample(q,1.5)
    pts.append([round(float(v),1) for v in r.reshape(-1)])
geo['pts']=pts
json.dump(geo,open('lsign_geo.json','w'))
print('pts',sum(len(a)//2 for a in pts),'bytes',len(json.dumps(geo)))
