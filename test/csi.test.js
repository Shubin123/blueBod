import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VALID,N_SC,amplitudes,parseEspCsiLine,parseRuViewFrame,RUVIEW_MAGIC,LinkStore,fitModel,predict,evaluate,leaveOneRoundOut,syntheticFrame} from '../public/csi.js';
import {MOVEMENTS,templatePose} from '../public/movements.js';
import {validPacket} from '../public/network.js';
const iqFrame=fill=>Array.from({length:128},(_,i)=>fill(i));
test('amplitudes keep 52 real subcarriers and normalise gain away',()=>{
 assert.equal(N_SC,52);assert.ok(!VALID.includes(0)&&!VALID.includes(32));
 const a=amplitudes(iqFrame(i=>i%2?3:4)),b=amplitudes(iqFrame(i=>i%2?30:40));
 assert.equal(a.length,52);assert.ok(Math.abs(a[0]-20)<1e-3);assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-4));
 assert.equal(amplitudes([1,2,3]),null);
});
test('parses esp-csi serial lines and rejects noise',()=>{
 const data=iqFrame(i=>i%7-3).join(',');
 const f=parseEspCsiLine(`CSI_DATA,12,AA:BB:CC:DD:EE:FF,-47,11,1,0,0,0,0,0,0,0,0,-96,0,6,0,123456,0,92,0,128,0,"[${data}]"`);
 assert.equal(f.tx,'aa:bb:cc:dd:ee:ff');assert.equal(f.rssi,-47);assert.equal(f.iq.length,128);
 assert.equal(parseEspCsiLine('I (123) wifi: connected'),null);
 assert.equal(parseEspCsiLine('CSI_DATA,1,AA:BB:CC:DD:EE:FF,-40,"[1,2,3]"'),null);
});
test('parses RuView binary frames with and without transmitter tag',()=>{
 const frame=(tagged)=>{const b=new Uint8Array(20+128+(tagged?6:0)),v=new DataView(b.buffer);v.setUint32(0,RUVIEW_MAGIC,true);b[4]=2;v.setUint16(6,64,true);v.setUint32(12,99,true);v.setInt8(16,-52);if(tagged){b[19]=0x80;b.set([1,2,3,4,5,0xab],148);}for(let i=0;i<128;i++)v.setInt8(20+i,(i%5)-2);return b;};
 const plain=parseRuViewFrame(frame(false)),tagged=parseRuViewFrame(frame(true));
 assert.equal(plain.tx,'router');assert.equal(plain.rssi,-52);assert.equal(plain.seq,99);assert.equal(plain.iq.length,128);assert.equal(plain.iq[1],-1);
 assert.equal(tagged.tx,'01:02:03:04:05:ab');assert.equal(tagged.iq.length,128);
 assert.equal(parseRuViewFrame(new Uint8Array(200)),null);
});
test('link features cover mean, spread and change per link',()=>{
 const store=new LinkStore();
 for(let i=0;i<60;i++){store.add('R>1',amplitudes(iqFrame(k=>k%2?3+((i+k)%4):4)),i*20);store.add('R>2',amplitudes(iqFrame(()=>5)),i*20);}
 assert.deepEqual(store.active(1200),['R>1','R>2']);
 const f=store.feature(['R>1','R>2'],1200);assert.equal(f.length,2*3*52);
 assert.ok(f[52]>0&&f[104]>0,'moving link has spread and change');assert.ok(Math.abs(f[156+52])<1e-4,'still link has none');
 assert.ok(store.feature(['R>1','R>9'],1200)===null);
 assert.ok(store.feature(['R>1','R>2'],3000)!==null,'recent feature reused for a brief gap');
});
test('synthetic room trains a model that beats chance on a separate test round',()=>{
 const links=['R>S1','R>S2','R>S3','S1>S2'],labels=MOVEMENTS.map(m=>m.id);
 const record=(session,round)=>{const out=[],store=new LinkStore();let t=round*1e6;
 for(const y of labels){for(let i=0;i<300;i++){t+=40;for(const l of links)store.add(l,amplitudes(syntheticFrame(l,y,t)),t);if(i>75&&i%12===0)out.push({x:store.feature(links,t),y,session,round});}}
 return out;};
 const train=[...record('train',1),...record('train',2)],test=record('test',3);
 const model=fitModel(train),score=evaluate(model,test);
 assert.ok(score.acc>.8,`synthetic accuracy ${score.acc}`);
 assert.ok(leaveOneRoundOut(train)>.8);
 assert.equal(Object.values(predict(model,test[0].x).probs).reduce((a,b)=>a+b,0).toFixed(6),'1.000000');
 assert.equal(fitModel(train.slice(0,5)),null);
});
test('k-NN averages camera-taught poses of the winning movement',()=>{
 const pose=v=>Array.from({length:33},()=>({x:v,y:0,z:0,visibility:1}));
 const samples=[...Array(10)].map((_,i)=>({x:[i<5?0:10,0],y:i<5?'standing':'sitting',pose:pose(i<5?1:3)}));
 const p=predict(fitModel(samples),[0.2,0]);assert.equal(p.best,'standing');assert.equal(p.pose[0].x,1);
 assert.equal(predict(fitModel(samples.map(s=>({...s,pose:undefined}))),[9,0]).pose,null);
});
test('templates exist for every movement and stay finite',()=>{
 assert.equal(templatePose('nobody'),null);
 for(const m of MOVEMENTS.filter(m=>m.id!=='nobody'))for(const t of [0,333,1700]){const p=templatePose(m.id,t);assert.equal(p.length,33);assert.ok(p.every(q=>[q.x,q.y,q.z].every(Number.isFinite)));assert.ok(p[0].y<p[27].y,'head above feet');}
 assert.notDeepEqual(templatePose('squatting',0)[25],templatePose('squatting',1000)[25]);
});
test('CSI packets for LAN peers are validated',()=>{
 const base={type:'csi',id:'a',packetId:'b',time:1},frame={link:'R>ab12·USB1',t:5,rssi:-40,amp:Array(52).fill(20)};
 assert.ok(validPacket({...base,frames:[frame]}));
 assert.equal(validPacket({...base,frames:[{...frame,amp:Array(51).fill(1)}]}),false);
 assert.equal(validPacket({...base,frames:Array(65).fill(frame)}),false);
});
