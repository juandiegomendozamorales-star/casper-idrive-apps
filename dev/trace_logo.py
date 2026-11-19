import numpy as np, contourpy, json
from PIL import Image
im=Image.open('Logo PP/Logo Perea Performance.png').convert('RGBA'); im=im.crop(im.getbbox())
a=np.asarray(im).astype(float); H,W=a.shape[:2]
A=a[...,3]/255; R,G,B=a[...,0],a[...,1],a[...,2]
classes={'light':(R<120)&(B>150)&(G>90), 'dark':(R<60)&(B>100)&(G<90)&(G>40), 'orange':(R>150)&(G<120), 'black':(R<50)&(G<50)&(B<50)}
def rdp(p,eps):
    if len(p)<3: return p
    s,e=p[0],p[-1]; v=e-s; q=p-s; n=np.linalg.norm(v)
    d=np.abs(v[0]*q[:,1]-v[1]*q[:,0])/n if n>1e-9 else np.linalg.norm(q,axis=1)
    i=int(np.argmax(d))
    if d[i]>eps: return np.vstack([rdp(p[:i+1],eps)[:-1],rdp(p[i:],eps)])
    return np.vstack([s,e])
def area(p): x,y=p[:,0],p[:,1]; return 0.5*(np.dot(x,np.roll(y,1))-np.dot(y,np.roll(x,1)))
out={}
for k,m in classes.items():
    mask=np.pad((m&(A>0.5)).astype(float),1)
    # light blur for smooth contours
    gen=contourpy.contour_generator(z=mask,line_type='Separate')
    polys=[]
    for line in gen.lines(0.5):
        line=line-1
        if len(line)<4: continue
        s=rdp(line,1.2)
        ar=area(s)
        if abs(ar)<60: continue
        polys.append({'a':ar,'p':[[round(float(x),1),round(float(y),1)] for x,y in s[:-1]]})
    out[k]=polys
    print(k,len(polys),sum(len(q['p']) for q in polys), [round(q['a']) for q in polys][:8])
json.dump({'w':W,'h':H,'c':out},open('logo_polys.json','w'))
