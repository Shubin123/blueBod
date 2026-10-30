// What BlueBod's Bluetooth path would have measured during WiMANS clips. Each of the receiver's three
// antennas becomes one advertising "device": its per-packet signal strength (1 dB steps, like a Bluetooth
// scan's RSSI) is read at a Bluetooth-like 2-10 adverts per second with the 0-10 ms advertising jitter,
// then fed through the app's own bleFeatures. The 60 s per-device history the app keeps (for the "level
// shift" features) is the 19 clips before, drawn from that person's session and the empty room, the
// way a session in the app mixes your movements with times you've left the room.
import {readFileSync} from 'node:fs';
import {bleFeatures,WINDOW} from '../../public/radio.js';
// WiMANS activity -> BlueBod movement. lie_down, pick_up, sit_down and stand_up have no counterpart.
export const LABELS={nothing:'standing',walk:'walking',rotation:'spinning',jump:'jumping',wave:'waving',empty:'nobody'};
export function rng(seed){let s=seed>>>0||1;return()=>((s=Math.imul(s^s>>>15,1|s)+0x6D2B79F5|0,((s^s>>>14)>>>0)/4294967296));}
export function load(path){
 return JSON.parse(readFileSync(path,'utf8')).filter(s=>s.users<=1&&LABELS[s.activity]).map(s=>({...s,y:LABELS[s.activity],domain:`${s.env} ${s.band} GHz`}));
}
// Signal strength of the packet nearest each advertisement over one 3 s clip.
function hear(clip,antenna,rate,offset,r){
 const t=clip.t,v=clip.rssi[antenna],out={t:[],rssi:[]};let j=0;
 for(let tau=offset;tau<WINDOW;tau+=1000/rate+r()*10){
 while(j+1<t.length&&Math.abs(t[j+1]-tau)<=Math.abs(t[j]-tau))j++;
 if(v[j]!=null){out.t.push(tau);out.rssi.push(v[j]);}
 }
 return out;
}
export function features(clip,history,seed){
 const r=rng(seed),devices=new Map(),clips=[...history,clip];
 for(let a=0;a<3;a++){
 if(clip.rssi[a].every(v=>v==null))continue;
 const rate=2+8*r(),d={t:[],rssi:[]};
 clips.forEach((c,i)=>{const h=hear(c,a,rate,r()*1000/rate,r);for(let k=0;k<h.t.length;k++){d.t.push(h.t[k]+(i-clips.length+1)*WINDOW);d.rssi.push(h.rssi[k]);}});
 devices.set(a,d);
 }
 return bleFeatures(devices,WINDOW-.001);
}
// Adds x: the app's six Bluetooth features for every clip.
export function withFeatures(clips){
 const r=rng(7),byDomain=new Map();
 for(const c of clips){if(!byDomain.has(c.domain))byDomain.set(c.domain,[]);byDomain.get(c.domain).push(c);}
 for(const c of clips){
 const pool=byDomain.get(c.domain).filter(o=>o!==c&&(o.group===c.group||o.users===0||c.users===0)),history=[];
 for(let i=0;i<19;i++)history.push(pool[Math.floor(r()*pool.length)]);
 c.x=features(c,history,c.group*1000+c.order);
 }
 return clips.filter(c=>c.x);
}
