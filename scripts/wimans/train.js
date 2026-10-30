// Builds public/models/wimans-prior.json from WiMANS signal strength (rssi.py) and poses (poses.py), and
// first checks, one held-out room at a time with the app's own code, whether it beats training on the fly.
// Usage: node scripts/wimans/train.js rssi.json poses.json
import {readFileSync,writeFileSync} from 'node:fs';
import {load,withFeatures,rng} from './simulate.js';
import {fitModel,evaluate,nearest} from '../../public/model.js';
import {PRIOR_FEATURES,preparePrior,withPrior} from '../../public/prior.js';
import {templatePose} from '../../public/movements.js';
import {STEPS,STEP_MS,compactPose,meanPose,poseError} from '../../public/teacher.js';
const [rssiPath,posePath]=process.argv.slice(2);
const poses=JSON.parse(readFileSync(posePath,'utf8')),clips=withFeatures(load(rssiPath));
for(const c of clips)c.pose=poses[c.label]?.seq||null;
const ENVS=[...new Set(clips.map(c=>c.env))];
// The most typical recorded motion of a movement: the clip whose mean pose is closest to all the others'.
function typical(seqs){
 const means=seqs.map(meanPose);let best=null,score=Infinity;
 means.forEach((m,i)=>{const d=means.reduce((t,o)=>t+poseError(m,o),0);if(d<score){score=d;best=seqs[i];}});
 return best;
}

// The shipped file: every clip's prior features, and one typical motion per movement.
function build(clips){
 const domains=[...new Set(clips.map(c=>c.domain))].sort(),motion={};
 for(const y of new Set(clips.map(c=>c.y))){const seqs=clips.filter(c=>c.y===y&&c.pose).map(c=>c.pose);if(seqs.length)motion[y]=typical(seqs);}
 return {format:'bluebod-prior-v1',
 source:{name:'WiMANS',url:'https://github.com/huangshk/WiMANS',license:'CC BY-NC-SA 4.0',citation:'Huang et al., WiMANS: A Benchmark Dataset for WiFi-based Multi-user Activity Sensing, ECCV 2024'},
 features:['signal sd','max signal sd','signal change','level shift','min level shift'].join(', '),
 domains,x:clips.map(c=>PRIOR_FEATURES.map(j=>+c.x[j].toFixed(3))),y:clips.map(c=>c.y),domain:clips.map(c=>domains.indexOf(c.domain)),
 motion};
}

// ---- Movement: on-the-fly training alone vs. with the prior, in a room the prior never saw ----
const DEFAULT=['standing','walking','waving','nobody'],ALL=['standing','walking','spinning','jumping','waving','nobody'];
const balanced=(model,test)=>{if(!model)return 1/new Set(test.map(c=>c.y)).size;const per=Object.values(evaluate(model,test).per);return per.reduce((a,b)=>a+b,0)/per.length;};
const scores={},add=(key,v)=>(scores[key]??=[]).push(v);
for(const env of ENVS){
 const prior=preparePrior(build(clips.filter(c=>c.env!==env))),zero=withPrior(null,prior,[],['ble']);
 for(const classes of [DEFAULT,ALL])for(const domain of new Set(clips.filter(c=>c.env===env).map(c=>c.domain))){
 const target=clips.filter(c=>c.domain===domain&&classes.includes(c.y)),empty=target.filter(c=>c.users===0);
 // One person trains with k windows per movement (and k of the empty room); the model is then scored
 // on everyone else in that room, and on that person's remaining windows.
 for(const user of [1,2,3,4,5,6]){
 const r=rng(user*31+classes.length),mine=target.filter(c=>c.user===user);
 for(const k of [3,5,10]){
 const shots=classes.flatMap(y=>(y==='nobody'?empty:mine).filter(c=>c.y===y).map(c=>[r(),c]).sort((a,b)=>a[0]-b[0]).slice(0,k).map(p=>p[1]));
 const rest=target.filter(c=>!shots.includes(c)),other=rest.filter(c=>c.user!==user),same=rest.filter(c=>c.user===user||c.users===0);
 const base=fitModel(shots),both=withPrior(base,prior,shots,['ble']);
 for(const [name,model] of [['on the fly',base],['on the fly + WiMANS',both],['WiMANS only, untrained',zero]]){
 add(`${classes.length}|${k}|${name}|other`,balanced(model,other));
 // Same-person windows run out at k=10 (about one left per movement), too few to score.
 if(k<10)add(`${classes.length}|${k}|${name}|same`,balanced(model,same));
 }
 }
 }
 }
}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length,pct=v=>v==null?'   —':(100*v).toFixed(1).padStart(5);
console.log('Balanced accuracy (%), held-out room, mean over 3 rooms x 2 bands x 6 people');
for(const n of [4,6]){
 console.log(`\n${n} movements (chance ${(100/n).toFixed(0)}%)${n===4?' — the app defaults':''}`);
 console.log('windows per movement'.padEnd(26),'   3     5    10   │ same person 3   5');
 for(const name of ['on the fly','on the fly + WiMANS','WiMANS only, untrained'])
 console.log(name.padEnd(26),[3,5,10].map(k=>pct(mean(scores[`${n}|${k}|${name}|other`]))).join(' '),'  │      ',[3,5].map(k=>pct(mean(scores[`${n}|${k}|${name}|same`]))).join(' '));
}

// ---- Motion: what the figure shows for a correctly recognised movement, vs. the person's real motion ----
// Posture is the mean pose over the window; motion compares frame by frame at the best phase alignment.
// "nearest WiMANS window" is the alternative of replaying the dataset clip whose Bluetooth features
// sit closest to the window, among that movement's clips.
const template=y=>Array.from({length:STEPS},(_,s)=>compactPose(templatePose(y,(s+.5)*STEP_MS)));
const motionError=(a,b)=>Math.min(...a.map((_,shift)=>mean(b.map((f,t)=>poseError(a[(t+shift)%a.length],f)))));
const err={};
for(const env of ENVS){
 const prior=preparePrior(build(clips.filter(c=>c.env!==env)));
 for(const domain of new Set(clips.filter(c=>c.env===env).map(c=>c.domain))){
 const others=clips.filter(c=>c.env!==env&&c.pose),here=clips.filter(c=>c.domain===domain&&c.pose&&c.y!=='nobody');
 const near=fitModel(others.map(c=>({x:PRIOR_FEATURES.map(j=>c.x[j]),y:c.y,pose:c.pose})));
 for(const c of here){
 const hit=nearest(near,PRIOR_FEATURES.map(j=>c.x[j])).find(([,i])=>near.y[i]===c.y);
 for(const [name,seq] of [['animated template',template(c.y)],['typical WiMANS motion',prior.motion[c.y]],['nearest WiMANS window',near.poses[hit[1]]]]){
 (err[name]??={})[c.y]??=[];err[name][c.y].push([poseError(meanPose(seq),meanPose(c.pose)),motionError(seq,c.pose)]);
 }
 }
 }
}
console.log('\nFigure vs. the person\'s MediaPipe pose in a held-out room, cm per joint (posture / motion)');
for(const [name,by] of Object.entries(err))console.log(name.padEnd(24),Object.entries(by).map(([y,v])=>`${y} ${(100*mean(v.map(e=>e[0]))).toFixed(0)}/${(100*mean(v.map(e=>e[1]))).toFixed(0)}`).join('  '),' │ all',(100*mean(Object.values(by).map(v=>mean(v.map(e=>e[0]))))).toFixed(1),'/',(100*mean(Object.values(by).map(v=>mean(v.map(e=>e[1]))))).toFixed(1));

const file=new URL('../../public/models/wimans-prior.json',import.meta.url),data=build(clips);
writeFileSync(file,JSON.stringify(data));
console.log(`\nWrote ${file.pathname}: ${data.x.length} windows, motion for ${Object.keys(data.motion).join(', ')}, ${(JSON.stringify(data).length/1024).toFixed(0)} KB`);
