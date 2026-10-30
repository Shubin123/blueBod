# MediaPipe Pose (heavy, same options as the app's camera teacher) over WiMANS single-person videos,
# reduced exactly as public/teacher.js does: the joints the figure draws, only frames where shoulders
# and hips are clearly seen, resampled to 12 steps of 250 ms across the 3 s clip.
# Usage: poses.py pose_landmarker_heavy.task DATASET_DIR/video OUT.json [workers]
import sys, os, json, cv2, numpy as np, mediapipe as mp
from multiprocessing import Pool
JOINTS=[0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];CORE=[11,12,23,24];STEPS,STEP_MS=12,250
model,vdir,out=sys.argv[1:4];workers=int(sys.argv[4]) if len(sys.argv)>4 else 6
def landmarker(mode='VIDEO'):
    o=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=model),running_mode=getattr(mp.tasks.vision.RunningMode,mode),
        num_poses=1,min_pose_detection_confidence=.6,min_pose_presence_confidence=.6,min_tracking_confidence=.6)
    return mp.tasks.vision.PoseLandmarker.create_from_options(o)
rgb=lambda img:mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB)))
# WiMANS people stand 5-8 m from a fixed 1080p camera, too small for the detector's input. Find them in
# overlapping tiles on a few frames, then track inside one square crop around everywhere they were seen.
def locate(imgs):
    H,W=imgs[0].shape[:2];T=540;boxes=[]
    with landmarker('IMAGE') as lm:
        for img in imgs:
            for y in range(0,H-T+1,270):
                for x in range(0,W-T+1,460 if W>T else 1):
                    r=lm.detect(rgb(img[y:y+T,x:x+T]))
                    for l in r.pose_landmarks:
                        xs=[x+min(max(q.x,0),1)*T for q in l];ys=[y+min(max(q.y,0),1)*T for q in l];boxes.append((min(xs),min(ys),max(xs),max(ys)))
    if not boxes: return None
    x0,y0=min(b[0] for b in boxes),min(b[1] for b in boxes);x1,y1=max(b[2] for b in boxes),max(b[3] for b in boxes)
    side=int(min(H,W,max(400,1.5*max(x1-x0,y1-y0))));cx,cy=(x0+x1)/2,(y0+y1)/2
    left=int(min(max(cx-side/2,0),W-side));top=int(min(max(cy-side/2,0),H-side))
    return left,top,side
def one(name):
    cap=cv2.VideoCapture(os.path.join(vdir,name+'.mp4'));fps=cap.get(cv2.CAP_PROP_FPS) or 30;imgs=[]
    while True:
        ok,img=cap.read()
        if not ok: break
        imgs.append(img)
    cap.release()
    box=locate(imgs[::22]) if imgs else None
    if not box: return name,dict(coverage=0,seq=None,box=None)
    left,top,side=box;lm=landmarker();frames=[]
    for i,img in enumerate(imgs):
        t=i*1000/fps
        r=lm.detect_for_video(rgb(img[top:top+side,left:left+side]),int(t))
        w=r.pose_world_landmarks[0] if r.pose_world_landmarks else None
        pose=None
        if w is not None and all((w[j].visibility or 0)>=.5 for j in CORE): pose=[c for j in JOINTS for c in (w[j].x,w[j].y,w[j].z)]
        frames.append((t,pose))
    lm.close()
    now=len(frames)*1000/fps;w=[f for f in frames if now-STEPS*STEP_MS<f[0]<=now];seen=[f for f in w if f[1]]
    coverage=len(seen)/len(w) if w else 0
    if coverage<.6: return name,dict(coverage=coverage,seq=None,box=box)
    seq=[]
    for s in range(STEPS):
        t=now-(STEPS-s-.5)*STEP_MS;best=min(seen,key=lambda f:abs(f[0]-t))
        seq.append([round(v,3) for v in best[1]])
    return name,dict(coverage=coverage,seq=seq,box=box)
if __name__=='__main__':
    names=sorted(f[:-4] for f in os.listdir(vdir) if f.endswith('.mp4'))
    done=json.load(open(out)) if os.path.exists(out) else {}
    todo=[n for n in names if n not in done]
    with Pool(workers) as pool:
        for k,(n,r) in enumerate(pool.imap_unordered(one,todo,chunksize=4)):
            done[n]=r
            if (k+1)%100==0: json.dump(done,open(out,'w'));print(k+1,'/',len(todo),flush=True)
    json.dump(done,open(out,'w'));print('done',len(done),sum(1 for v in done.values() if v['seq']),'with motion')
