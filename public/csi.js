// WiFi CSI pipeline, after the RuView / wifi-sensing-kit approach: per-link subcarrier amplitude
// windows -> mean / spread / frame-to-frame change features -> k-nearest-neighbour movement model.
const range=(a,b)=>Array.from({length:b-a},(_,i)=>a+i);
// 802.11 20 MHz LLTF: bin 0 (DC) and 27-37 (guard band) carry nothing; the other 52 are real subcarriers.
export const VALID=[...range(1,27),...range(38,64)];
export const N_SC=VALID.length;
export const RUVIEW_MAGIC=0xC5110001;

// iq: ESP-IDF CSI buffer order, imaginary then real per subcarrier. Each frame is divided by its own
// mean level because the receiver's automatic gain jumps packet to packet; only the shape is kept.
export function amplitudes(iq){
 if(!iq||iq.length<128)return null;
 const out=new Float32Array(N_SC);let sum=0;
 VALID.forEach((k,i)=>{sum+=out[i]=Math.hypot(iq[2*k],iq[2*k+1]);});
 const scale=20/(sum/N_SC+1e-6);for(let i=0;i<N_SC;i++)out[i]*=scale;
 return out;
}

// Espressif esp-csi serial line: CSI_DATA,<seq>,<mac>,<rssi>,...,"[i0,r0,i1,r1,...]"
export function parseEspCsiLine(line){
 if(typeof line!=='string'||!line.startsWith('CSI_DATA'))return null;
 const a=line.indexOf('"['),b=line.lastIndexOf(']');if(a<0||b<a)return null;
 const head=line.slice(0,a).split(','),iq=line.slice(a+2,b).split(',').map(Number);
 if(!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(head[2]||'')||iq.length<128||!iq.every(Number.isFinite))return null;
 return {tx:head[2].toLowerCase(),rssi:Number(head[3])||0,iq};
}

// RuView ADR-018 frame: [u32 magic][u8 node][u8 antennas][u16 subcarriers][u32 freq][u32 seq][i8 rssi][i8 noise][2 flags]
// then int8 I/Q pairs, then a 6-byte transmitter MAC when byte 19 bit 7 is set.
export function parseRuViewFrame(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<20+128)return null;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==RUVIEW_MAGIC)return null;
 const tagged=(bytes[19]&0x80)!==0&&bytes.length>=20+128+6;
 const iq=Array.from(new Int8Array(bytes.buffer,bytes.byteOffset+20,bytes.length-20-(tagged?6:0)));
 const tx=tagged?[...bytes.subarray(bytes.length-6)].map(b=>b.toString(16).padStart(2,'0')).join(':'):'router';
 return {node:bytes[4],rssi:view.getInt8(16),seq:view.getUint32(12,true),tx,iq};
}

export class LinkStore{
 constructor(size=500){this.links=new Map();this.size=size;this.last=new Map();}
 add(key,amp,t,rssi=0){
 let l=this.links.get(key);if(!l)this.links.set(key,l={key,t:[],amp:[],rssi});
 l.t.push(t);l.amp.push(amp);l.rssi=rssi;if(l.t.length>this.size){l.t.shift();l.amp.shift();}
 }
 rate(key,now,span=2000){const l=this.links.get(key);if(!l)return 0;let n=0;for(let i=l.t.length-1;i>=0&&l.t[i]>now-span;i--)n++;return n*1000/span;}
 active(now,minRate=5){return [...this.links.keys()].filter(k=>this.rate(k,now)>=minRate).sort();}
 // Per link over the last window: mean band shape, per-band spread, mean frame-to-frame change.
 feature(ids,now,win=1500,minFrames=8){
 const parts=[];
 for(const id of ids){
 const l=this.links.get(id);let start=l?l.t.length:0;
 while(start>0&&l.t[start-1]>now-win)start--;
 const w=l?l.amp.slice(start):[];
 if(w.length<minFrames){const kept=this.last.get(id);if(kept&&now-kept.t<3000){parts.push(kept.f);continue;}return null;}
 const f=new Float32Array(3*N_SC);
 for(let k=0;k<N_SC;k++){
 let sum=0,sq=0,diff=0;
 for(let i=0;i<w.length;i++){const v=w[i][k];sum+=v;sq+=v*v;if(i)diff+=Math.abs(v-w[i-1][k]);}
 const mean=sum/w.length;f[k]=mean;f[N_SC+k]=Math.sqrt(Math.max(0,sq/w.length-mean*mean));f[2*N_SC+k]=diff/(w.length-1);
 }
 this.last.set(id,{t:now,f});parts.push(f);
 }
 const out=new Float32Array(parts.length*3*N_SC);parts.forEach((p,i)=>out.set(p,i*3*N_SC));return out;
 }
}

export function fitModel(samples,k=7){
 if(samples.length<10||new Set(samples.map(s=>s.y)).size<2)return null;
 const d=samples[0].x.length,mu=new Float32Array(d),sd=new Float32Array(d);
 for(const s of samples)for(let j=0;j<d;j++)mu[j]+=s.x[j]/samples.length;
 for(const s of samples)for(let j=0;j<d;j++)sd[j]+=(s.x[j]-mu[j])**2/samples.length;
 for(let j=0;j<d;j++)sd[j]=Math.sqrt(sd[j])+1e-6;
 const Z=samples.map(s=>standardize(s.x,mu,sd));
 return {mu,sd,Z,y:samples.map(s=>s.y),poses:samples.map(s=>s.pose||null),labels:[...new Set(samples.map(s=>s.y))].sort(),k};
}
function standardize(x,mu,sd){const z=new Float32Array(x.length);for(let j=0;j<x.length;j++)z[j]=(x[j]-mu[j])/sd[j];return z;}

// Returns label probabilities from the k nearest training windows, plus the mean of their recorded
// camera poses (only when the camera taught those windows).
export function predict(model,x){
 const z=standardize(x,model.mu,model.sd);
 const near=model.Z.map((r,i)=>{let d=0;for(let j=0;j<z.length;j++)d+=(r[j]-z[j])**2;return [d,i];}).sort((a,b)=>a[0]-b[0]).slice(0,model.k);
 const probs=Object.fromEntries(model.labels.map(l=>[l,0]));for(const [,i] of near)probs[model.y[i]]+=1/near.length;
 const best=model.labels.reduce((a,b)=>probs[b]>probs[a]?b:a);
 const poses=near.filter(([,i])=>model.y[i]===best&&model.poses[i]).map(([,i])=>model.poses[i]);
 return {best,probs,pose:poses.length?averagePose(poses):null};
}
export function averagePose(poses){
 return poses[0].map((_,j)=>{const p={x:0,y:0,z:0,visibility:0};for(const pose of poses)for(const key in p)p[key]+=(pose[j][key]??1)/poses.length;return p;});
}

export function evaluate(model,samples){
 if(!model||!samples.length)return null;
 const labels=[...new Set([...model.labels,...samples.map(s=>s.y)])].sort();
 const confusion=Object.fromEntries(labels.map(l=>[l,Object.fromEntries(labels.map(q=>[q,0]))]));
 let hits=0;for(const s of samples){const p=predict(model,s.x).best;confusion[s.y][p]++;if(p===s.y)hits++;}
 const per=Object.fromEntries(labels.filter(l=>samples.some(s=>s.y===l)).map(l=>[l,confusion[l][l]/samples.filter(s=>s.y===l).length]));
 return {acc:hits/samples.length,n:samples.length,per,confusion};
}

// Each training round is predicted by a model that only saw the other rounds; scoring on random
// windows would let the model "recognise" a moment it saw half a second earlier.
export function leaveOneRoundOut(samples){
 const rounds=[...new Set(samples.map(s=>s.round))];if(rounds.length<2)return null;
 let hits=0,n=0;
 for(const r of rounds){const model=fitModel(samples.filter(s=>s.round!==r));if(!model)continue;for(const s of samples.filter(s=>s.round===r)){n++;if(predict(model,s.x).best===s.y)hits++;}}
 return n?hits/n:null;
}

// Synthetic room for trying the pipeline without hardware. Every movement gets its own static
// multipath shape and motion rhythm per link; nothing here comes from a real sensor.
function seeded(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function hash(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;}
const RHYTHM={nobody:[0,0,.08],standing:[.15,.3,.25],sitting:[.1,.2,.2],squatting:[.5,2.2,.35],walking:[1.4,1.5,.45],jumping:[2,3,.5],waving:[1.6,.7,.3],spinning:[.6,1.6,.4]};
export function syntheticFrame(link,label,t){
 const rand=seeded(hash(link+'|'+label)),noise=Math.random,[hz,size,jitter]=RHYTHM[label]||RHYTHM.standing;
 const linkRand=seeded(hash(link)),iq=new Array(128).fill(0);
 for(let k=0;k<64;k++){
 const base=18+6*Math.sin(k*.21+linkRand()*6)+3*linkRand(),shape=label==='nobody'?0:(rand()-.5)*5;
 const motion=size*Math.sin(2*Math.PI*hz*t/1000+rand()*6)*rand(),amp=Math.max(1,base+shape+motion+(noise()-.5)*2*jitter*3);
 const phase=noise()*Math.PI*2;iq[2*k]=amp*Math.sin(phase);iq[2*k+1]=amp*Math.cos(phase);
 }
 return iq;
}
