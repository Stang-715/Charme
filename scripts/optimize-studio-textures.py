# Optimize embedded texture resolution only. Geometry and material assignments remain unchanged.
import json,struct,io,sys
from pathlib import Path
from PIL import Image
for filename in sys.argv[1:]:
 p=Path(filename); raw=p.read_bytes(); length=struct.unpack_from('<I',raw,12)[0]; doc=json.loads(raw[20:20+length]); binary=raw[28+length:]; images={i['bufferView']:i for i in doc.get('images',[])}; out=bytearray()
 for index,view in enumerate(doc['bufferViews']):
  data=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
  if index in images:
   image=Image.open(io.BytesIO(data)); image.thumbnail((1024,1024),Image.Resampling.LANCZOS); stream=io.BytesIO(); image.save(stream,format='PNG'); data=stream.getvalue(); images[index]['mimeType']='image/png'
  out.extend(b'\0'*((-len(out))%4)); view['byteOffset']=len(out); view['byteLength']=len(data); out.extend(data)
 out.extend(b'\0'*((-len(out))%4)); doc['buffers'][0]['byteLength']=len(out); js=json.dumps(doc,separators=(',',':')).encode(); js+=b' '*((-len(js))%4)
 result=struct.pack('<III',0x46546c67,2,28+len(js)+len(out))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(out),0x004e4942)+out
 p.write_bytes(result); print(p.name,len(raw),'->',len(result))
