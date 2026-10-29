// Single-machine radio sensing. A web page can't read WiFi CSI or signal strength, but it can time
// round trips over its own WiFi link: a body moving near the path between this device and the router
// changes the signal, which changes retries and rate control, which shows up in the timing. Where the
// browser allows Bluetooth scanning, the signal strength of nearby advertising devices adds more links.

// Common home router addresses, tried in parallel; the first to answer over HTTP is the nearest.
export const ROUTERS=['192.168.1.1','192.168.0.1','10.0.0.1','192.168.1.254','192.168.86.1','192.168.68.1','192.168.50.1','192.168.4.1','192.168.2.1','192.168.8.1','192.168.10.1','10.0.1.1','10.1.1.1','172.16.0.1'];
export const WINDOW=3000;
export const FEATURES={wifi:6,ble:6};
export const SOURCE_NAMES={wifi:'WiFi link',ble:'Bluetooth'};

export const cleanHost=text=>String(text).trim().replace(/^https?:\/\//i,'').replace(/\/.*$/,'');
// HEAD with no-cors: the response stays opaque, only its timing is used. Private IP literals are
// exempt from mixed content once Chrome's local network access permission is granted.
const request=(host,signal,fetchImpl)=>fetchImpl(`http://${host}/`,{method:'HEAD',mode:'no-cors',cache:'no-store',signal,targetAddressSpace:'local'});

export async function findRouter(candidates=ROUTERS,{timeout=30000,fetchImpl=fetch}={}){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
 const attempt=async host=>{const t0=performance.now();await request(host,ctrl.signal,fetchImpl);return {host,ms:performance.now()-t0};};
 try{return await Promise.any(candidates.map(attempt));}catch{return null;}finally{clearTimeout(timer);ctrl.abort();}
}

export async function probe(host,{timeout=600,fetchImpl=fetch}={}){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout),t0=performance.now();
 try{await request(host,ctrl.signal,fetchImpl);return {ok:true,ms:performance.now()-t0};}
 catch{return {ok:false,ms:performance.now()-t0};}
 finally{clearTimeout(timer);}
}

const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;

// WiFi over the last window: typical round trip, its spread, its tail, how much it changes probe to
// probe, how often it spikes, and how many probes were lost. Ratios keep the router's own speed out.
export function wifiFeatures(samples,now,win=WINDOW){
 const w=samples.filter(s=>s.t>now-win&&s.t<=now);if(w.length<15)return null;
 const ms=w.filter(s=>s.ms!=null).map(s=>s.ms);if(ms.length<5)return null;
 const sorted=[...ms].sort((a,b)=>a-b),q=p=>sorted[Math.min(sorted.length-1,Math.floor(p*sorted.length))]+.05,med=q(.5);
 let change=0,n=0;for(let i=1;i<w.length;i++)if(w[i].ms!=null&&w[i-1].ms!=null){change+=Math.abs(w[i].ms-w[i-1].ms);n++;}
 return [Math.log(med),Math.log(q(.75)/q(.25)),Math.log(q(.9)/med),n?change/n/med:0,ms.filter(v=>v>2*med).length/ms.length,1-ms.length/w.length];
}

// Bluetooth over the last window. Phones rotate their addresses every few minutes, so the features
// pool all devices heard instead of tracking any one: how many, how much their signal wobbles, and
// how far it sits from each device's own recent level (a body in the way lowers it).
export function bleFeatures(devices,now,win=WINDOW){
 const stats=[];
 for(const d of devices.values()){
 const w=[];for(let i=0;i<d.t.length;i++)if(d.t[i]>now-win&&d.t[i]<=now)w.push(d.rssi[i]);
 if(w.length<3)continue;
 const mean=avg(w);let change=0;for(let i=1;i<w.length;i++)change+=Math.abs(w[i]-w[i-1]);
 stats.push({sd:Math.sqrt(avg(w.map(v=>(v-mean)**2))),change:change/(w.length-1),dev:mean-avg(d.rssi)});
 }
 if(!stats.length)return null;
 const sd=stats.map(s=>s.sd),dev=stats.map(s=>s.dev);
 return [Math.log(stats.length),avg(sd),Math.max(...sd),avg(stats.map(s=>s.change)),avg(dev),Math.min(...dev)];
}

export class RadioStore{
 constructor(keep=60000){this.keep=keep;this.wifi=[];this.ble=new Map();}
 addWifi(t,ms){this.wifi.push({t,ms});while(this.wifi[0].t<t-this.keep)this.wifi.shift();}
 addBle(id,t,rssi){
 let d=this.ble.get(id);if(!d)this.ble.set(id,d={t:[],rssi:[]});
 d.t.push(t);d.rssi.push(rssi);while(d.t[0]<t-this.keep){d.t.shift();d.rssi.shift();}
 for(const [key,other] of this.ble)if(other.t.at(-1)<t-this.keep)this.ble.delete(key);
 }
 wifiRate(now,span=2000){let n=0;for(let i=this.wifi.length-1;i>=0&&this.wifi[i].t>now-span;i--)n++;return n*1000/span;}
 bleDevices(now,span=WINDOW,min=3){return [...this.ble].filter(([,d])=>d.t.filter(t=>t>now-span).length>=min).map(([id])=>id);}
 active(now){const out=[];if(this.wifiRate(now)>=5)out.push('wifi');if(this.bleDevices(now).length)out.push('ble');return out;}
 feature(sources,now){
 const parts=[];
 for(const s of sources){const f=s==='wifi'?wifiFeatures(this.wifi,now):s==='ble'?bleFeatures(this.ble,now):null;if(!f)return null;parts.push(...f);}
 return Float32Array.from(parts);
 }
}
