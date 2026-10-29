import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JOINTS,STEPS,STEP_MS,compactPose,expandPose,teachWindow,validSequence,meanPose,poseError,poseAt} from '../public/teacher.js';
import {fitModel,predict,evaluate} from '../public/model.js';
import {referencePose} from '../public/pose3d.js';
const flat=(v=0)=>Array(JOINTS.length*3).fill(v);
test('a camera frame only teaches when shoulders and hips are clearly seen',()=>{
 const world=referencePose();for(const p of world)p.visibility=.9;
 const pose=compactPose(world);assert.equal(pose.length,JOINTS.length*3);
 const back=expandPose(pose);assert.deepEqual([back[16].x,back[16].y,back[16].z],[world[16].x,world[16].y,world[16].z]);assert.equal(back[1].visibility,0);
 world[23].visibility=.2;assert.equal(compactPose(world),null);assert.equal(compactPose(undefined),null);
});
test('a window keeps its motion as evenly spaced frames, or none when the person was rarely seen',()=>{
 const frames=Array.from({length:90},(_,i)=>({t:i*1000/30,pose:flat(i)})),now=3000;
 const taught=teachWindow(frames,now);
 assert.equal(taught.seq.length,STEPS);assert.ok(validSequence(taught.seq));assert.ok(taught.coverage>.99);
 assert.ok(taught.seq[0][0]<taught.seq[STEPS-1][0],'frames run forward in time');
 assert.ok(Math.abs(taught.seq[0][0]-(STEP_MS/2)*30/1000)<=1,'first step sits at the start of the window');
 const hidden=frames.map((f,i)=>i%2?f:{...f,pose:null}),half=teachWindow(hidden,now);
 assert.ok(Math.abs(half.coverage-.5)<.02);assert.equal(half.seq,null);
 assert.equal(teachWindow([],now).coverage,0);
});
test('posture helpers measure per-joint distance and loop motion smoothly',()=>{
 assert.equal(poseError(flat(0),flat(0)),0);
 const shifted=flat(0).map((v,i)=>i%3===0?.1:0);assert.ok(Math.abs(poseError(flat(0),shifted)-.1)<1e-9);
 const seq=Array.from({length:STEPS},(_,s)=>flat(s));
 assert.equal(meanPose(seq)[0],(STEPS-1)/2);
 assert.equal(poseAt(seq,STEP_MS*1.5)[0],1.5);
 assert.equal(poseAt(seq,STEPS*STEP_MS)[0],0,'loops back to the first frame');
});
test('the radio student replays the nearest taught motion and is scored against the teacher',()=>{
 const seq=v=>Array.from({length:STEPS},()=>flat(v));
 const train=[...Array(12)].map((_,i)=>({x:[i<6?i*.1:10+i*.1,0],y:i<6?'standing':'sitting',round:1,pose:seq(i<6?0:.3)}));
 const model=fitModel(train),p=predict(model,[0.05,0]);
 assert.equal(p.best,'standing');assert.equal(p.pose[0][0],0);
 const result=evaluate(model,[{x:[0,0],y:'standing',pose:seq(0)},{x:[10.5,0],y:'sitting',pose:seq(.3)}]);
 assert.equal(result.pose.n,2);assert.equal(result.pose.error,0);assert.ok(result.pose.baseline>.1,'guessing the average pose is worse');
 const untaught=fitModel(train.map(s=>({...s,pose:undefined})));
 assert.equal(predict(untaught,[0,0]).pose,null);assert.equal(evaluate(untaught,[{x:[0,0],y:'standing',pose:seq(0)}]).pose,null);
});
