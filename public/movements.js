// Movements the WiFi model learns, and an animated template skeleton for each one. Templates are
// illustrations of the predicted movement, not measured joint positions.
export const MOVEMENTS=[
 {id:'standing',name:'Standing',prompt:'Stand still facing the room'},
 {id:'walking',name:'Walking',prompt:'Walk around the room'},
 {id:'sitting',name:'Sitting',prompt:'Sit down and stay still'},
 {id:'squatting',name:'Squatting',prompt:'Squat up and down'},
 {id:'jumping',name:'Jumping',prompt:'Jump on the spot'},
 {id:'waving',name:'Waving',prompt:'Wave one hand above your head'},
 {id:'spinning',name:'Spinning',prompt:'Turn slowly on the spot'},
 {id:'nobody',name:'Nobody',prompt:'Leave the room now'}
];
export const movementName=id=>MOVEMENTS.find(m=>m.id===id)?.name||id;

const THIGH=.43,SHIN=.43,UPPER=.28,FORE=.26;
const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
// MediaPipe world axes: x right, y down, z away from the viewer (forward is -z). Hip-centred.
const legDir=a=>({x:0,y:Math.cos(a),z:-Math.sin(a)});
const armDir=(side,raise,forward)=>({x:side*Math.sin(raise),y:Math.cos(raise)*Math.cos(forward),z:-Math.cos(raise)*Math.sin(forward)});

export function templatePose(id,time=0){
 if(id==='nobody')return null;
 const t=time/1000,sw=Math.sin(t*2*Math.PI*.9);
 let lean=0,yaw=0,legs=[[0,0],[0,0]],arms=[[.15,0,.15,.1],[.15,0,.15,.1]];
 if(id==='standing'){const s=Math.sin(t*1.2)*.02;arms=[[.12+s,0,.12+s,.12],[.12-s,0,.12-s,.12]];}
 if(id==='walking'){legs=[[.4*sw,Math.max(0,-sw)*.6],[-.4*sw,Math.max(0,sw)*.6]];arms=[[.1,-.4*sw,.1,-.4*sw+.3],[.1,.4*sw,.1,.4*sw+.3]];}
 if(id==='sitting'){legs=[[1.5,1.5],[1.5,1.5]];lean=.15;arms=[[.1,.5,.1,1.3],[.1,.5,.1,1.3]];}
 if(id==='squatting'){const d=.5-.5*Math.cos(t*2*Math.PI*.5);legs=[[1.4*d,2.3*d],[1.4*d,2.3*d]];lean=.5*d;arms=[[.1,1.3*d,.1,1.4*d],[.1,1.3*d,.1,1.4*d]];}
 if(id==='jumping'){const d=Math.max(0,Math.sin(t*2*Math.PI*1.1));legs=[[.5*(1-d),1*(1-d)],[.5*(1-d),1*(1-d)]];arms=[[.3+2*d,0,.3+2.2*d,0],[.3+2*d,0,.3+2.2*d,0]];}
 if(id==='waving'){const w=Math.sin(t*2*Math.PI*1.4)*.45;arms[1]=[2.4-w,0,2.9-w,0];}
 if(id==='spinning')yaw=t*2*Math.PI/3;
 const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
 const put=(i,v)=>{p[i]={...v,visibility:1};};
 // Upper body leans forward around the hips.
 const torso=v=>({x:v.x,y:v.y*Math.cos(lean),z:v.z+v.y*Math.sin(lean)});
 for(const [side,hip,knee,ankle,heel,toe,leg] of [[-1,23,25,27,29,31,legs[0]],[1,24,26,28,30,32,legs[1]]]){
 const h={x:side*.1,y:0,z:0};put(hip,h);
 const k=add(h,legDir(leg[0]),THIGH);put(knee,k);
 const a=add(k,legDir(leg[0]-leg[1]),SHIN);put(ankle,a);
 put(heel,add(a,{x:0,y:.05,z:.05}));put(toe,add(a,{x:0,y:.06,z:-.15}));
 }
 for(const [side,shoulder,elbow,wrist,arm] of [[-1,11,13,15,arms[0]],[1,12,14,16,arms[1]]]){
 const s=torso({x:side*.2,y:-.5,z:0});put(shoulder,s);
 const e=add(s,armDir(side,arm[0],arm[1]),UPPER);put(elbow,e);
 put(wrist,add(e,armDir(side,arm[2],arm[3]),FORE));
 }
 put(0,torso({x:0,y:-.75,z:-.04}));
 if(yaw)for(const q of p){const x=q.x*Math.cos(yaw)+q.z*Math.sin(yaw),z=-q.x*Math.sin(yaw)+q.z*Math.cos(yaw);q.x=x;q.z=z;}
 return p;
}
