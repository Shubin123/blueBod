# Per-packet received signal strength from WiMANS raw Intel 5300 traces: dBm per receive antenna
# (rssi - 44 - agc), with packet times in ms. Usage: python3 rssi.py DATASET_DIR OUT.json
import sys, os, csv, json, numpy as np, scipy.io as sio
from multiprocessing import Pool
root,out=sys.argv[1],sys.argv[2]
def one(label):
    p=os.path.join(root,'wifi_csi/mat',label+'.mat')
    if not os.path.exists(p): return label,None
    t=sio.loadmat(p,variable_names=['trace'])['trace'][:,0]
    f=lambda r,k: int(np.asarray(r[k]).ravel()[0])
    ts=np.array([f(r,'timestamp_low') for r in t],dtype=np.int64)
    ts=np.where(ts<0,ts+2**32,ts);ts=np.unwrap(ts.astype(float),period=2**32)
    agc=np.array([f(r,'agc') for r in t]);raw=np.array([[f(r,k) for k in ('rssi_a','rssi_b','rssi_c')] for r in t])
    dbm=np.where(raw>0,raw-44-agc[:,None],np.nan)
    return label,dict(t=np.round((ts-ts[0])/1000,3).tolist(),rssi=[[None if np.isnan(v) else int(v) for v in col] for col in dbm.T])
if __name__=='__main__':
    rows=list(csv.DictReader(open(os.path.join(root,'annotation.csv'),encoding='utf-8-sig')))
    with Pool(8) as pool: res=dict(pool.map(one,[r['label'] for r in rows],chunksize=16))
    keep=[]
    for r in rows:
        acts=[r[f'user_{i}_activity'] for i in range(1,7) if r[f'user_{i}_activity']]
        locs=[r[f'user_{i}_location'] for i in range(1,7) if r[f'user_{i}_location']]
        users=[i for i in range(1,7) if r[f'user_{i}_activity']]
        if res.get(r['label']) is None: continue
        g,k=r['label'].split('_')[1:]
        keep.append(dict(label=r['label'],group=int(g),order=int(k),env=r['environment'],band=r['wifi_band'],users=int(r['number_of_users']),
                         activity=acts[0] if acts else 'empty',location=locs[0] if locs else None,user=users[0] if users else None,**res[r['label']]))
    json.dump(keep,open(out,'w'))
    print(len(keep),'samples')
