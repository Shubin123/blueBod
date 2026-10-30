# Downloads the parts of WiMANS (https://www.kaggle.com/datasets/shuokanghuang/wimans, CC BY-NC-SA 4.0)
# the prior needs, without the whole 53 GB archive: the zip is read with HTTP range requests, and only the
# annotation, the raw traces of one-person and empty-room samples of the movements BlueBod knows, and
# those samples' videos are fetched (about 7.5 GB).  Usage: python3 fetch.py DATASET_DIR
import sys, os, csv, io, json, struct, zlib, urllib.request, urllib.error, concurrent.futures as cf
MOVEMENTS={'nothing','walk','rotation','jump','wave'}
out=sys.argv[1]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None
try: urllib.request.build_opener(NoRedirect).open('https://www.kaggle.com/api/v1/datasets/download/shuokanghuang/wimans');raise SystemExit('Expected a redirect to the archive')
except urllib.error.HTTPError as e: URL=e.headers['Location']
def get(a,b):
    for attempt in range(5):
        try: return urllib.request.urlopen(urllib.request.Request(URL,headers={'Range':f'bytes={a}-{b}'}),timeout=120).read()
        except Exception as ex: err=ex
    raise err
size=int(urllib.request.urlopen(urllib.request.Request(URL,headers={'Range':'bytes=0-0'})).headers['Content-Range'].split('/')[1])
tail=get(size-65536,size-1);i=tail.rfind(b'PK\x06\x06')
count,cd_size,cd_off=struct.unpack('<QQQ',tail[i+32:i+56])
cd=get(cd_off,cd_off+cd_size-1);p=0;entries={}
while cd[p:p+4]==b'PK\x01\x02':
    method,=struct.unpack('<H',cd[p+10:p+12]);csize,usize=struct.unpack('<II',cd[p+20:p+28]);nl,el,cl=struct.unpack('<HHH',cd[p+28:p+34]);off,=struct.unpack('<I',cd[p+42:p+46])
    name=cd[p+46:p+46+nl].decode();ex=cd[p+46+nl:p+46+nl+el];q=0
    while q<len(ex):
        hid,hl=struct.unpack('<HH',ex[q:q+4]);d=ex[q+4:q+4+hl];k=0
        if hid==1:
            if usize==0xFFFFFFFF: usize,=struct.unpack('<Q',d[k:k+8]);k+=8
            if csize==0xFFFFFFFF: csize,=struct.unpack('<Q',d[k:k+8]);k+=8
            if off==0xFFFFFFFF: off,=struct.unpack('<Q',d[k:k+8])
        q+=4+hl
    entries[name]=(method,csize,off);p+=46+nl+el+cl
def fetch(name):
    dst=os.path.join(out,name)
    if os.path.exists(dst): return
    method,csize,off=entries[name];h=get(off,off+29);nl,el=struct.unpack('<HH',h[26:30]);start=off+30+nl+el
    raw=get(start,start+csize-1);data=raw if method==0 else zlib.decompress(raw,-15)
    os.makedirs(os.path.dirname(dst) or '.',exist_ok=True);open(dst+'.part','wb').write(data);os.replace(dst+'.part',dst)
fetch('annotation.csv');names=[]
for r in csv.DictReader(open(os.path.join(out,'annotation.csv'),encoding='utf-8-sig')):
    acts=[r[f'user_{i}_activity'] for i in range(1,7) if r[f'user_{i}_activity']]
    if r['number_of_users']=='0' or (r['number_of_users']=='1' and acts[0] in MOVEMENTS):
        names.append(f"wifi_csi/mat/{r['label']}.mat")
        if acts: names.append(f"video/{r['label']}.mp4")
with cf.ThreadPoolExecutor(12) as pool:
    for n,_ in enumerate(pool.map(fetch,names),1):
        if n%500==0: print(n,'/',len(names),flush=True)
print('done',len(names))
