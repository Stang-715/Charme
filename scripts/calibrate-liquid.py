"""Measure generated liquid geometry; writes scalar volume calibration only."""
import struct,json,math
from pathlib import Path
b=Path('public/models/liquid.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);binary=b[28+n:]
def read(index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];types={5126:'f',5125:'I',5123:'H'};fmt=types[a['componentType']];count={'VEC3':3,'SCALAR':1}[a['type']];stride=v.get('byteStride',struct.calcsize(fmt)*count);base=v.get('byteOffset',0)+a.get('byteOffset',0)
 return [struct.unpack_from('<'+fmt*count,binary,base+i*stride) for i in range(a['count'])]
p=j['meshes'][0]['primitives'][0];vertices=read(p['attributes']['POSITION']);indices=[x[0] for x in read(p['indices'])]
def hull(points):
 p=sorted(set(points))
 def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 low=[];high=[]
 for q in p:
  while len(low)>1 and cross(low[-2],low[-1],q)<=0:low.pop()
  low.append(q)
 for q in reversed(p):
  while len(high)>1 and cross(high[-2],high[-1],q)<=0:high.pop()
  high.append(q)
 return low[:-1]+high[:-1]
ymin=min(v[1]for v in vertices);ymax=max(v[1]for v in vertices);areas=[]
for k in range(100):
 y=ymin+(k+.5)/100*(ymax-ymin);pts=[]
 for i in range(0,len(indices),3):
  tri=[vertices[x]for x in indices[i:i+3]]
  for a,c in zip(tri,tri[1:]+tri[:1]):
   if (a[1]<y)!=(c[1]<y):
    f=(y-a[1])/(c[1]-a[1]);pts.append((a[0]+f*(c[0]-a[0]),a[2]+f*(c[2]-a[2])))
 h=hull(pts);areas.append(abs(sum(a[0]*c[1]-c[0]*a[1]for a,c in zip(h,h[1:]+h[:1])))/2)
total=sum(areas);cdf=[0];
for a in areas:cdf.append(cdf[-1]+a/total)
Path('src/shared/liquid-calibration.json').write_text(json.dumps({'source':'Magnific yiVR7oaPW9','method':'100-slice convex cross-section integration','cdf':cdf},indent=2)+'\n')
