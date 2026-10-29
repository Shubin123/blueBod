// k-nearest-neighbour movement model over standardised radio features, with honest scoring.
export function fitModel(samples,k=7){
 if(samples.length<10||new Set(samples.map(s=>s.y)).size<2)return null;
 const d=samples[0].x.length,mu=new Float32Array(d),sd=new Float32Array(d);
 for(const s of samples)for(let j=0;j<d;j++)mu[j]+=s.x[j]/samples.length;
 for(const s of samples)for(let j=0;j<d;j++)sd[j]+=(s.x[j]-mu[j])**2/samples.length;
 // The floor stops a feature that never varied in training (no lost probes, say) from swamping the distance.
 for(let j=0;j<d;j++)sd[j]=Math.max(.05,Math.sqrt(sd[j]));
 const Z=samples.map(s=>standardize(s.x,mu,sd));
 return {mu,sd,Z,y:samples.map(s=>s.y),labels:[...new Set(samples.map(s=>s.y))].sort(),k};
}
function standardize(x,mu,sd){const z=new Float32Array(x.length);for(let j=0;j<x.length;j++)z[j]=(x[j]-mu[j])/sd[j];return z;}

// Returns label probabilities from the k nearest training windows.
export function predict(model,x){
 const z=standardize(x,model.mu,model.sd);
 const near=model.Z.map((r,i)=>{let d=0;for(let j=0;j<z.length;j++)d+=(r[j]-z[j])**2;return [d,i];}).sort((a,b)=>a[0]-b[0]).slice(0,model.k);
 const probs=Object.fromEntries(model.labels.map(l=>[l,0]));for(const [,i] of near)probs[model.y[i]]+=1/near.length;
 return {best:model.labels.reduce((a,b)=>probs[b]>probs[a]?b:a),probs};
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
