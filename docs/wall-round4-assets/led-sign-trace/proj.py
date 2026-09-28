import cv2, numpy as np, json
g=cv2.imread('/home/claude/ws-r4-w8/docs/wall-round4-assets/led-sign-grid-C6-C7.jpg').astype(float)
b,gr,r=g[...,0],g[...,1],g[...,2]
Y=(r+gr)/2-b
def center(prof,off):
    base=np.median(np.r_[prof[:10],prof[-10:]]); w=np.clip(prof-base-(prof.max()-base)*.3,0,None); return off+np.sum(w*np.arange(len(prof)))/np.sum(w)
colpts=[(center(Y[y,int(470+.045*y)-50:int(470+.045*y)+50],int(470+.045*y)-50),y) for y in list(range(20,420,20))+list(range(1260,1600,20))]
r6=[(x,center(Y[508:588,x],508)) for x in list(range(10,420,20))+list(range(1020,1200,20))]
r7=[(x,center(Y[1157:1237,x],1157)) for x in list(range(10,440,20))+list(range(700,1200,20))]
cx=np.polyfit([p[1] for p in colpts],[p[0] for p in colpts],1)   # x = a*y+b
c6=np.polyfit([p[0] for p in r6],[p[1] for p in r6],1)             # y = a*x+b
c7=np.polyfit([p[0] for p in r7],[p[1] for p in r7],1)
print('colC x=%.4f*y+%.1f'%tuple(cx),'row6 y=%.4f*x+%.1f'%tuple(c6),'row7 y=%.4f*x+%.1f'%tuple(c7))
def inter(cl,rl):
    # x=a*y+b ; y=c*x+d
    a,b_=cl; c,d=rl; y=(c*b_+d)/(1-c*a); return np.array([a*y+b_,y])
O6=inter(cx,c6); O7=inter(cx,c7); print('C6',O6,'C7',O7)
H_=540; W_=960; V=9.6*0+np.linalg.norm(O7-O6)/(H_/8); HS=V*1.20
print('vscale',V,'hscale',HS)
ey=(O7-O6)/(H_/8)
rowdir=np.array([1,c6[0]]); rowdir/=np.linalg.norm(rowdir); rowdir7=np.array([1,c7[0]]); rowdir7/=np.linalg.norm(rowdir7)
ex=(rowdir+rowdir7)/2; ex=ex/np.linalg.norm(ex)*HS
M=np.array([ex,ey]).T; Mi=np.linalg.inv(M)
def photo2norm(p):
    uv=(np.asarray(p)-O6)@Mi.T
    return np.stack([2/12+uv[:,0]/W_, 6/8+uv[:,1]/H_],1)
json.dump({'O6':O6.tolist(),'ex':ex.tolist(),'ey':ey.tolist()},open('photo2proj.json','w'))
np.save('Mi.npy',Mi); np.save('O6.npy',O6)
print(photo2norm([O6,O7]))
