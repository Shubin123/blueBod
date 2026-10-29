// Camera teacher: MediaPipe Pose world landmarks (metres, hip-centred; x right, y down, z away) turned
// into per-window training targets. The camera only teaches; live tracking never uses it.
// Only the joints the figure draws are kept: nose, arms, hips, legs and feet.
export const JOINTS=[0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];
// A window's motion is kept as 12 frames 0.25 s apart, covering the radio's 3 s window.
export const STEPS=12,STEP_MS=250;
const CORE=[11,12,23,24];

// One camera frame -> flat [x,y,z,...] over JOINTS, or null unless shoulders and hips are clearly seen.
export function compactPose(world,minVisibility=.5){
 if(!world||world.length<33||CORE.some(i=>(world[i].visibility??1)<minVisibility))return null;
 return JOINTS.flatMap(i=>[world[i].x,world[i].y,world[i].z]);
}
export function expandPose(flat){
 const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
 JOINTS.forEach((j,i)=>{p[j]={x:flat[3*i],y:flat[3*i+1],z:flat[3*i+2],visibility:1};});
 return p;
}

// Camera frames over the window ending at `now`: the share that saw a person, and the motion resampled
// to STEPS frames (the nearest seen frame to each step), or no motion when too little of it was seen.
export function teachWindow(frames,now,minCoverage=.6){
 const w=frames.filter(f=>f.t>now-STEPS*STEP_MS&&f.t<=now),seen=w.filter(f=>f.pose);
 const coverage=w.length?seen.length/w.length:0;
 if(coverage<minCoverage)return {frames:w.length,coverage,seq:null};
 const seq=[];
 for(let s=0;s<STEPS;s++){
 const t=now-(STEPS-s-.5)*STEP_MS;let best=seen[0];
 for(const f of seen)if(Math.abs(f.t-t)<Math.abs(best.t-t))best=f;
 seq.push(best.pose.map(v=>Math.round(v*1000)/1000));
 }
 return {frames:w.length,coverage,seq};
}
export const validSequence=seq=>Array.isArray(seq)&&seq.length===STEPS&&seq.every(f=>Array.isArray(f)&&f.length===JOINTS.length*3&&f.every(Number.isFinite));

export function meanPose(seq){const out=new Array(seq[0].length).fill(0);for(const f of seq)f.forEach((v,i)=>out[i]+=v/seq.length);return out;}
// Mean distance per joint, in metres.
export function poseError(a,b){let sum=0;for(let i=0;i<a.length;i+=3)sum+=Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]);return sum/(a.length/3);}
// Pose at `t` ms into a looping sequence, interpolated between frames.
export function poseAt(seq,t){
 const p=((t/STEP_MS)%seq.length+seq.length)%seq.length,i=Math.floor(p),f=p-i,a=seq[i],b=seq[(i+1)%seq.length];
 return a.map((v,k)=>v+(b[k]-v)*f);
}
