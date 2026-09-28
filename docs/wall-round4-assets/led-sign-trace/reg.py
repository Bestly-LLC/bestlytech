import numpy as np, cv2
from scipy import ndimage, optimize
g=cv2.imread('/home/claude/ws-r4-w8/docs/wall-round4-assets/led-sign-grid-C6-C7.jpg')
gray=cv2.cvtColor(g,cv2.COLOR_BGR2GRAY)
ed=cv2.Canny(cv2.GaussianBlur(gray,(5,5),0),20,50)
cv2.imwrite('gedges.png',ed)
dt=ndimage.distance_transform_edt(ed==0)
strokes=list(np.load('strokes.npy',allow_pickle=True))
P=np.vstack([s[::3] for s in strokes[:9]])
def T(p,x):
    a,b,c,d,e,f,g_,h=x
    w=g_*p[:,0]+h*p[:,1]+1
    return np.stack([(a*p[:,0]+b*p[:,1]+c)/w,(d*p[:,0]+e*p[:,1]+f)/w],1)
# init: bbox map
sx=(1000-165)/(977-135); sy=(1165-440)/(1140-434)
x0=np.array([sx,0,165-135*sx,0,sy,440-434*sy,0,0])
def cost(x,trunc=20,aff=False):
    if aff: x=np.r_[x,0,0]
    q=T(P,x)
    v=ndimage.map_coordinates(dt,[q[:,1],q[:,0]],order=1,mode='nearest')
    return np.mean(np.minimum(v,trunc)**2)
best=None
for dx in range(-40,41,10):
  for dy in range(-40,41,10):
    xi=x0.copy(); xi[2]+=dx; xi[5]+=dy
    c=cost(xi)
    if best is None or c<best[0]: best=(c,xi)
print('grid best',best[0])
r=optimize.minimize(lambda x:cost(x,20,True),best[1][:6],method='Powell',options={'maxiter':20000,'xtol':1e-4})
print('affine',r.fun)
r2=optimize.minimize(lambda x:cost(x,12,True),r.x,method='Powell',options={'maxiter':20000})
print('affine2',r2.fun, r2.x)
xa=np.r_[r2.x,0,0]
r3=optimize.minimize(lambda x:cost(x,10),xa,method='Powell',options={'maxiter':40000})
print('homog',r3.fun, r3.x)
np.save('H_affine.npy',xa); np.save('H_hom.npy',r3.x)
for name,x in [('aff',xa),('hom',r3.x)]:
    vis=g.copy()
    for s in strokes[:9]:
        q=T(s,x); cv2.polylines(vis,[q.astype(np.int32).reshape(-1,1,2)],False,(255,0,255),3)
    cv2.imwrite(f'overlay_{name}.png',vis[380:1250,100:1100])
