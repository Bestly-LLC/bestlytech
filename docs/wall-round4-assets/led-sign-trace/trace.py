import cv2, numpy as np
from skimage.morphology import skeletonize
from scipy import ndimage
im=cv2.imread('/home/claude/ws-r4-w8/docs/wall-round4-assets/led-sign-on-purple.jpg')
L=cv2.cvtColor(im,cv2.COLOR_BGR2LAB)[...,0]
th=cv2.morphologyEx(L,cv2.MORPH_TOPHAT,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(51,51)))
m=(th>18).astype(np.uint8)
m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
lab,n=ndimage.label(m)
sz=ndimage.sum(m,lab,range(1,n+1))
keep=np.isin(lab,[i+1 for i,s in enumerate(sz) if s>3000])
print('components kept',[int(s) for s in sz if s>3000])
m=keep.astype(np.uint8)
# fill tiny holes
m=m.astype(np.uint8)
cv2.imwrite('clean.png',m*255)
sk=skeletonize(m>0).astype(np.uint8)
cv2.imwrite('skel.png',sk*255)
np.save('skel.npy',sk); np.save('mask.npy',m)
# tube width estimate
dt=ndimage.distance_transform_edt(m)
print('median half-width on skeleton',np.median(dt[sk>0]))
ys,xs=np.where(m); print('bbox',xs.min(),xs.max(),ys.min(),ys.max())
