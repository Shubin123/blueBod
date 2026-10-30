// Bluetooth prior learnt offline from WiMANS (Huang et al., ECCV 2024; CC BY-NC-SA 4.0): WiFi signal
// strength recorded while six people stood, walked, turned, jumped and waved in three rooms, plus the
// rooms empty, turned into the same features this app computes for Bluetooth (see scripts/wimans).
// Signal levels differ from room to room and radio to radio, so once a room has training windows the
// prior is re-expressed in that room's terms: every room's features are standardised by its own
// per-movement averages. Before any training it is used as recorded. It also carries, per movement, the
// most typical MediaPipe Pose motion from the dataset's videos, so the figure can show recorded human
// motion the camera never taught.
import {fitModel,nearest} from './model.js';
import {FEATURES} from './radio.js';
import {validSequence} from './teacher.js';
// The Bluetooth features the dataset can teach: signal wobble and level shifts. Not the device count,
// which depends on what happens to be nearby rather than on movement.
export const PRIOR_FEATURES=[1,2,3,4,5];
const K=15;

export async function loadPrior(url=new URL('./models/wimans-prior.json',import.meta.url)){
 const response=await fetch(url);if(!response.ok)throw Error(`Dataset model unavailable (${response.status})`);
 return preparePrior(await response.json());
}
export function preparePrior(data){
 if(data?.format!=='bluebod-prior-v1'||!data.x?.every(x=>x.length===PRIOR_FEATURES.length&&x.every(Number.isFinite))||!Object.values(data.motion||{}).every(validSequence))throw Error('Not a BlueBod dataset model');
 const samples=data.x.map((x,i)=>({x,y:data.y[i],domain:data.domain[i]}));
 return {samples,labels:[...new Set(data.y)].sort(),motion:data.motion,source:data.source};
}
// Per-movement averages, then the spread around them, giving every movement equal weight.
export function classStats(samples){
 const groups=[...new Set(samples.map(s=>s.y))].map(l=>samples.filter(s=>s.y===l)),d=samples[0].x.length,mu=Array(d).fill(0),sd=Array(d).fill(0);
 for(const g of groups)for(let j=0;j<d;j++)mu[j]+=g.reduce((a,s)=>a+s.x[j],0)/g.length/groups.length;
 for(const g of groups)for(let j=0;j<d;j++)sd[j]+=g.reduce((a,s)=>a+(s.x[j]-mu[j])**2,0)/g.length/groups.length;
 return {mu,sd:sd.map(v=>Math.max(.05,Math.sqrt(v)))};
}
const standardise=(x,st)=>x.map((v,j)=>(v-st.mu[j])/st.sd[j]);
// The prior's view of a window: its Bluetooth features, wherever they sit in the vector.
function bluetooth(x,sources){let at=0;for(const s of sources){if(s==='ble')return PRIOR_FEATURES.map(j=>x[at+j]);at+=FEATURES[s];}return null;}

// Attaches the prior to a model trained on `train`, or with no model makes a prior-only one. Without
// Bluetooth it can't vote, but still supplies recorded motion. (Picking the motion of the nearest dataset
// window instead of the typical one fitted held-out people slightly worse: see scripts/wimans/train.js.)
export function withPrior(model,prior,train,sources){
 if(!prior)return model;
 const labels=model?model.labels.filter(l=>prior.labels.includes(l)):prior.labels,pose=(x,label)=>prior.motion[label]||null;
 if(!sources?.includes('ble')||labels.length<2)return model&&{...model,prior:{pose}};
 const pool=prior.samples.filter(s=>labels.includes(s.y)),mine=train.filter(s=>labels.includes(s.y)).map(s=>({x:bluetooth(s.x,sources),y:s.y}));
 const calibrated=new Set(mine.map(s=>s.y)).size>=2;let fit,view;
 if(calibrated){
 const stats=new Map([...new Set(pool.map(s=>s.domain))].map(d=>[d,classStats(pool.filter(s=>s.domain===d))])),here=classStats(mine);
 fit=fitModel(pool.map(s=>({...s,x:standardise(s.x,stats.get(s.domain))})),K);view=x=>standardise(bluetooth(x,sources),here);
 }else{fit=fitModel(pool,K);view=x=>bluetooth(x,sources);}
 const probs=x=>{const p=Object.fromEntries(labels.map(l=>[l,0]));for(const [,i] of nearest(fit,view(x)).slice(0,K))p[fit.y[i]]+=1/K;return p;};
 const attached={probs,pose,calibrated};
 return model?{...model,prior:attached}:{labels,prior:attached};
}
