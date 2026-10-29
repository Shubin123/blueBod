import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROUTERS,FEATURES,cleanHost,findRouter,probe,wifiFeatures,bleFeatures,RadioStore} from '../public/radio.js';
import {fitModel,predict,evaluate,leaveOneRoundOut} from '../public/model.js';
const wait=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));});});
test('finds the router that answers and gives up when none do',async()=>{
 const fake=answer=>(url,{signal})=>url===`http://${answer}/`?wait(5):url.includes('10.0.0.1')?Promise.reject(TypeError('Failed to fetch')):wait(1e6,signal);
 assert.equal((await findRouter(ROUTERS,{fetchImpl:fake('192.168.68.1')})).host,'192.168.68.1');
 assert.equal(await findRouter(['10.0.0.1','192.168.9.9'],{timeout:50,fetchImpl:fake('nothing')}),null);
 assert.equal(cleanHost(' http://192.168.1.1:8080/admin '),'192.168.1.1:8080');
});
test('probe times answers and reports timeouts and refusals as unanswered',async()=>{
 const answered=await probe('r',{fetchImpl:()=>wait(3)});assert.ok(answered.ok&&answered.ms>=2);
 assert.equal((await probe('r',{timeout:20,fetchImpl:(_,{signal})=>wait(1e6,signal)})).ok,false);
 assert.equal((await probe('r',{fetchImpl:()=>Promise.reject(TypeError('refused'))})).ok,false);
});
const series=(fn,n=60)=>Array.from({length:n},(_,i)=>({t:i*50,ms:fn(i)}));
test('WiFi features separate a steady link from a disturbed one',()=>{
 const steady=wifiFeatures(series(i=>2+(i%3)*.05),2950),busy=wifiFeatures(series(i=>i%7===0?12:2+(i%5)*.6),2950);
 assert.equal(steady.length,FEATURES.wifi);assert.ok(steady.every(Number.isFinite));
 for(const j of [1,2,3,4])assert.ok(busy[j]>steady[j],`feature ${j}`);
 assert.equal(steady[5],0);assert.ok(Math.abs(wifiFeatures(series(i=>i%4?2:null),2950)[5]-.25)<1e-9,'lost share');
 assert.equal(wifiFeatures(series(()=>2,10),450),null);
});
test('Bluetooth features pool devices, so rotating addresses do not matter',()=>{
 const a={t:[0,1000,2000,3000,4000,5000,6000],rssi:[-60,-60,-61,-60,-62,-70,-71]},b={t:[3500,4200,4900,5600],rssi:[-80,-79,-81,-80]};
 const one=bleFeatures(new Map([['a',a],['b',b]]),6100),two=bleFeatures(new Map([['y',b],['x',a]]),6100);
 assert.equal(one.length,FEATURES.ble);one.forEach((v,j)=>assert.ok(Math.abs(v-two[j])<1e-9));
 assert.ok(one[5]<0,'a body in the way lowers a device below its own level');
 assert.equal(bleFeatures(new Map([['c',{t:[0,100],rssi:[-50,-50]}]]),200),null);
});
test('store joins sources in a fixed order, waits for each and forgets old devices',()=>{
 const store=new RadioStore();
 for(let t=0;t<=4000;t+=50)store.addWifi(t,2+Math.sin(t)*.1);
 assert.deepEqual(store.active(4000),['wifi']);
 assert.equal(store.feature(['wifi'],4000).length,FEATURES.wifi);assert.equal(store.feature(['wifi','ble'],4000),null);
 for(let t=1000;t<=4000;t+=300)store.addBle('phone',t,t%900?-60:-68);
 assert.deepEqual(store.active(4000),['wifi','ble']);assert.equal(store.feature(['wifi','ble'],4000).length,FEATURES.wifi+FEATURES.ble);
 store.addBle('watch',70000,-50);assert.ok(!store.ble.has('phone'));
});

// Synthetic link timing: each movement disturbs the link by its own amount. Nothing here is real data.
function seeded(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const LINK={nobody:[2,.04,0,0],standing:[2.2,.12,.01,0],walking:[3,.5,.12,.03],waving:[2.4,.3,.05,0]};// median ms, spread, spikes, losses
function session(round,label='train'){
 const rand=seeded(round*7919),gauss=()=>Math.sqrt(-2*Math.log(rand()+1e-12))*Math.cos(2*Math.PI*rand()),store=new RadioStore(),out=[];let t=round*1e7;
 for(const [y,[med,spread,spike,loss]] of Object.entries(LINK))for(let i=0;i<400;i++){
 t+=50;store.addWifi(t,rand()<loss?null:med*Math.exp(spread*gauss())*(rand()<spike?4:1));
 if(i>=60&&i%10===0)out.push({x:store.feature(['wifi'],t),y,session:label,round});
 }
 return out;
}
test('k-NN on synthetic link timing beats chance on a separate round',()=>{
 const train=[...session(1),...session(2)],test=session(3,'test');
 const model=fitModel(train),score=evaluate(model,test);
 assert.ok(score.acc>.8,`synthetic accuracy ${score.acc}`);assert.ok(leaveOneRoundOut(train)>.8);
 assert.equal(Object.values(predict(model,test[0].x).probs).reduce((a,b)=>a+b,0).toFixed(6),'1.000000');
 assert.equal(fitModel(train.slice(0,5)),null);
});
