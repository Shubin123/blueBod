import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIOR_FEATURES,preparePrior,withPrior,classStats} from '../public/prior.js';
import {fitModel,predict,evaluate,leaveOneRoundOut} from '../public/model.js';
import {JOINTS,STEPS,validSequence} from '../public/teacher.js';
const seq=v=>Array.from({length:STEPS},()=>Array(JOINTS.length*3).fill(v));
// Two rooms whose Bluetooth features differ in scale; in each, movements sit at the same relative place.
const LEVEL={nobody:0,standing:1,waving:2,walking:4};
function dataset(){
 const x=[],y=[],domain=[];
 for(const [d,scale] of [[0,1],[1,3]])for(const [label,level] of Object.entries(LEVEL))for(let i=0;i<20;i++){x.push(PRIOR_FEATURES.map((_,j)=>scale*(level+(i%5)*.05)+j));y.push(label);domain.push(d);}
 return {format:'bluebod-prior-v1',source:{name:'test'},domains:['a','b'],x,y,domain,motion:{standing:seq(.1),waving:seq(.2),walking:seq(.4)}};
}
// A window in a room scaled by `scale`, with the six Bluetooth features (device count first).
const ble=(label,scale,i=0)=>[Math.log(4),...PRIOR_FEATURES.map((_,j)=>scale*(LEVEL[label]+(i%5)*.05)+j)];
const prior=preparePrior(dataset());

test('the shipped WiMANS model loads, with recorded motion for every movement but nobody',()=>{
 const shipped=preparePrior(JSON.parse(readFileSync(new URL('../public/models/wimans-prior.json',import.meta.url))));
 assert.deepEqual(shipped.labels,['jumping','nobody','spinning','standing','walking','waving']);
 assert.ok(shipped.samples.length>2000);
 for(const label of shipped.labels.filter(l=>l!=='nobody'))assert.ok(validSequence(shipped.motion[label]),label);
 assert.equal(shipped.motion.nobody,undefined);
 assert.throws(()=>preparePrior({format:'other'}));
});

test('untrained, the prior alone recognises Bluetooth windows and supplies motion',()=>{
 const model=withPrior(null,prior,[],['ble']);
 assert.deepEqual(model.labels,['nobody','standing','walking','waving']);
 const p=predict(model,ble('walking',1));
 assert.equal(p.best,'walking');assert.equal(p.poseSource,'dataset');assert.equal(p.pose[0][0],.4);
 assert.equal(predict(model,ble('nobody',1)).pose,null);
 const asked=predict(model,ble('walking',1),'standing');assert.equal(asked.best,'walking');assert.equal(asked.pose[0][0],.1,'motion for the movement asked about');
 assert.equal(withPrior(null,prior,[],['wifi']),null,'no Bluetooth, no untrained model');
});

test('training windows calibrate the prior to a room on a different scale',()=>{
 // This room's signal is 6x the first dataset room's: as recorded, the prior misreads it.
 const train=Object.keys(LEVEL).flatMap(label=>[0,1,2].map(i=>({x:ble(label,6,i),y:label,round:1})));
 const raw=withPrior(null,prior,[],['ble']);
 assert.notEqual(predict(raw,ble('standing',6,3)).best,'standing');
 const model=withPrior(fitModel(train),prior,train,['ble']);
 assert.ok(model.prior.calibrated);
 for(const label of Object.keys(LEVEL))assert.equal(predict(model,ble(label,6,3)).best,label);
 const stats=classStats(train.map(s=>({x:s.x.slice(1),y:s.y})));assert.ok(Math.abs(stats.mu[0]-6*(7/4+.05))<1e-9,'every movement weighs the same');
});

test('the prior reads the Bluetooth part of a WiFi + Bluetooth window and leaves other movements alone',()=>{
 const wifi=[1,2,3,4,5,6],train=[];
 for(const label of [...Object.keys(LEVEL),'sitting'])for(let i=0;i<4;i++)train.push({x:[...wifi.map(v=>v+(label==='sitting'?5:0)),...ble(label==='sitting'?'standing':label,2,i)],y:label,round:1});
 const model=withPrior(fitModel(train),prior,train,['wifi','ble']);
 assert.deepEqual(model.labels,['nobody','sitting','standing','walking','waving']);
 const p=predict(model,[...wifi,...ble('waving',2,4)]);
 assert.equal(p.best,'waving');assert.ok(Math.abs(Object.values(p.probs).reduce((a,b)=>a+b,0)-1)<1e-9);
 assert.equal(predict(model,[...wifi.map(v=>v+5),...ble('standing',2,4)]).best,'sitting','a movement the prior never learnt still wins on its own windows');
 // Without Bluetooth the prior can't vote but still gives the figure recorded motion.
 const wifiOnly=train.map(s=>({...s,x:wifi.map(v=>v+(LEVEL[s.y]??9))})),plain=withPrior(fitModel(wifiOnly),prior,wifiOnly,['wifi']);
 assert.equal(plain.prior.probs,undefined);
 const walk=predict(plain,wifi.map(v=>v+LEVEL.walking));assert.equal(walk.best,'walking');assert.equal(walk.poseSource,'dataset');assert.deepEqual(walk.pose,prior.motion.walking);
 assert.equal(predict(plain,wifi.map(v=>v+9)).pose,null,'nothing recorded for sitting');
});

test('camera-taught motion wins over the dataset, and scores work with the prior attached',()=>{
 const train=Object.keys(LEVEL).flatMap(label=>[0,1,2,3,4,5].map(i=>({x:ble(label,2,i),y:label,round:i%2+1,pose:label==='walking'?seq(.9):undefined})));
 const fit=s=>{const m=fitModel(s);return m&&withPrior(m,prior,s,['ble']);},model=fit(train);
 const p=predict(model,ble('walking',2,1));assert.equal(p.poseSource,'camera');assert.equal(p.pose[0][0],.9);
 assert.equal(predict(model,ble('waving',2,1)).poseSource,'dataset');
 assert.equal(evaluate(model,train).acc,1);assert.ok(leaveOneRoundOut(train,fit)>.9);
});
