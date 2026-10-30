// k-nearest-neighbour movement model over standardised radio features, with honest scoring. A dataset
// prior (prior.js) can be attached: its probabilities multiply the k-NN's, and it supplies recorded motion.
import {meanPose,poseError} from './teacher.js';
export function fitModel(samples,k=7){
 if(samples.length<10||new Set(samples.map(s=>s.y)).size<2)return null;
 const d=samples[0].x.length,mu=new Float32Array(d),sd=new Float32Array(d);
 for(const s of samples)for(let j=0;j<d;j++)mu[j]+=s.x[j]/samples.length;
 for(const s of samples)for(let j=0;j<d;j++)sd[j]+=(s.x[j]-mu[j])**2/samples.length;
 // The floor stops a feature that never varied in training (no lost probes, say) from swamping the distance.
 for(let j=0;j<d;j++)sd[j]=Math.max(.05,Math.sqrt(sd[j]));
 const Z=samples.map(s=>standardize(s.x,mu,sd));
 return {mu,sd,Z,y:samples.map(s=>s.y),poses:samples.map(s=>s.pose||null),labels:[...new Set(samples.map(s=>s.y))].sort(),k};
}
function standardize(x,mu,sd){const z=new Float32Array(x.length);for(let j=0;j<x.length;j++)z[j]=(x[j]-mu[j])/sd[j];return z;}
// Training windows by distance to x, nearest first, as [squared distance, index].
export function nearest(model,x){
 const z=standardize(x,model.mu,model.sd);
 return model.Z.map((r,i)=>{let d=0;for(let j=0;j<z.length;j++)d+=(r[j]-z[j])**2;return [d,i];}).sort((a,b)=>a[0]-b[0]);
}

// Returns label probabilities from the k nearest training windows (times the prior's, where attached),
// plus the camera-taught motion of the closest taught window of the winning label, or of `label` when
// given (whole sequences: averaging them would blur the motion away), or else the prior's recorded motion.
export function predict(model,x,label){
 let probs=null,ranked=null;
 if(model.Z){
 ranked=nearest(model,x);const near=ranked.slice(0,model.k);
 probs=Object.fromEntries(model.labels.map(l=>[l,0]));for(const [,i] of near)probs[model.y[i]]+=1/near.length;
 }
 const q=model.prior?.probs?.(x);
 if(q)probs=probs?combine(probs,q,model.labels):Object.fromEntries(model.labels.map(l=>[l,q[l]??0]));
 const best=model.labels.reduce((a,b)=>probs[b]>probs[a]?b:a),shown=label||best;
 // Only some windows may have been recorded with the camera on, so look past the k nearest for one.
 const taught=ranked?.find(([,i])=>model.y[i]===shown&&model.poses[i]);
 if(taught)return {best,probs,pose:model.poses[taught[1]],poseSource:'camera'};
 const recorded=model.prior?.pose(x,shown)||null;
 return {best,probs,pose:recorded,poseSource:recorded?'dataset':null};
}
// Product of the two, each smoothed so neither can veto a movement outright. The prior only reorders the
// movements it learnt: one it never saw keeps the share the k-NN gave it.
function combine(p,q,labels){
 const known=labels.filter(l=>l in q),mass=known.reduce((s,l)=>s+p[l],0);
 const w=Object.fromEntries(known.map(l=>[l,(p[l]+.05)*(q[l]+.05)])),sum=known.reduce((s,l)=>s+w[l],0);
 return Object.fromEntries(labels.map(l=>[l,l in q?mass*w[l]/sum:p[l]]));
}

export function evaluate(model,samples){
 if(!model||!samples.length)return null;
 const labels=[...new Set([...model.labels,...samples.map(s=>s.y)])].sort();
 const confusion=Object.fromEntries(labels.map(l=>[l,Object.fromEntries(labels.map(q=>[q,0]))]));
 // Posture against the camera teacher: mean pose of the student's chosen window vs. the teacher's, per
 // joint, next to always guessing the average taught pose.
 const taught=(model.poses||[]).filter(Boolean),average=taught.length?meanPose(taught.map(meanPose)):null;
 let hits=0,err=0,base=0,posed=0;
 for(const s of samples){
 const p=predict(model,s.x);confusion[s.y][p.best]++;if(p.best===s.y)hits++;
 if(average&&s.pose&&p.pose){const truth=meanPose(s.pose);err+=poseError(meanPose(p.pose),truth);base+=poseError(average,truth);posed++;}
 }
 const per=Object.fromEntries(labels.filter(l=>samples.some(s=>s.y===l)).map(l=>[l,confusion[l][l]/samples.filter(s=>s.y===l).length]));
 return {acc:hits/samples.length,n:samples.length,per,confusion,pose:posed?{error:err/posed,baseline:base/posed,n:posed}:null};
}

// Each training round is predicted by a model that only saw the other rounds; scoring on random
// windows would let the model "recognise" a moment it saw half a second earlier.
export function leaveOneRoundOut(samples,fit=fitModel){
 const rounds=[...new Set(samples.map(s=>s.round))];if(rounds.length<2)return null;
 let hits=0,n=0;
 for(const r of rounds){const model=fit(samples.filter(s=>s.round!==r));if(!model)continue;for(const s of samples.filter(s=>s.round===r)){n++;if(predict(model,s.x).best===s.y)hits++;}}
 return n?hits/n:null;
}
