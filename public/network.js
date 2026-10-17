export function parsePairing(text){
 const data=JSON.parse(text);
 if(data.version!==1||!['offer','answer'].includes(data.type)||typeof data.sdp!=='string'||data.sdp.length>100000)throw Error('Invalid pairing code. Paste the complete code from the other device.');
 return {type:data.type,sdp:data.sdp};
}
export function validPacket(m){
 if(!m||typeof m.packetId!=='string'||m.packetId.length>80||typeof m.id!=='string'||typeof m.time!=='number')return false;
 if(m.type==='pose')return Array.isArray(m.landmarks)&&m.landmarks.length<=33&&m.landmarks.every(p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])));
 if(m.type==='sensor')return typeof m.name==='string'&&Array.isArray(m.bytes)&&m.bytes.length<=512&&m.bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
 return m.type==='hello'&&typeof m.name==='string'&&m.name.length<=40;
}
export class DeviceNetwork{
 constructor({name,ondata,onchange,onerror}){this.id=crypto.randomUUID();this.name=name;this.ondata=ondata;this.onchange=onchange;this.onerror=onerror;this.peers=new Set();this.seen=new Set();this.pending=null;}
 send(data){const m={...data,id:this.id,time:Date.now(),packetId:crypto.randomUUID()};this.seen.add(m.packetId);this.forward(m);}
 forward(m,source){const raw=JSON.stringify(m);for(const peer of this.peers)if(peer!==source&&peer.channel?.readyState==='open'&&peer.channel.bufferedAmount<262144)peer.channel.send(raw);}
 changed(){this.onchange([...this.peers].filter(p=>p.channel?.readyState==='open').map(p=>({id:p.id,name:p.name||'Paired device'})));}
 attach(peer,channel){peer.channel=channel;channel.onopen=()=>{if(this.pending===peer)this.pending=null;this.changed();channel.send(JSON.stringify({type:'hello',name:this.name().slice(0,40),id:this.id,time:Date.now(),packetId:crypto.randomUUID()}));};channel.onclose=()=>{peer.pc.close();this.peers.delete(peer);this.changed();};channel.onerror=()=>this.onerror('Device channel error. Pair again if the connection closes.');channel.onmessage=e=>{try{if(typeof e.data!=='string'||e.data.length>100000)return;const m=JSON.parse(e.data);if(!validPacket(m)||this.seen.has(m.packetId))return;this.seen.add(m.packetId);if(this.seen.size>20000)this.seen.delete(this.seen.values().next().value);if(m.type==='hello'&&m.id!==this.id){peer.id=m.id;peer.name=m.name;this.changed();return;}else this.ondata(m);this.forward(m,peer);}catch{this.onerror('Ignored an invalid device packet.');}};}
 create(){if(this.pending){this.pending.pc.close();this.peers.delete(this.pending);}const peer={pc:new RTCPeerConnection({iceServers:[]}),id:crypto.randomUUID()};this.pending=peer;this.peers.add(peer);peer.pc.ondatachannel=e=>this.attach(peer,e.channel);peer.pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(peer.pc.connectionState)){this.peers.delete(peer);this.changed();if(peer.pc.connectionState==='failed')this.onerror('Direct connection failed. Use the same LAN with device isolation disabled, then pair again.');}};return peer;}
 async description(peer){const pc=peer.pc;if(pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);reject(Error('Pairing timed out. Try again.'));},15000);function check(){if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();}}pc.addEventListener('icegatheringstatechange',check);check();});return JSON.stringify({version:1,type:pc.localDescription.type,sdp:pc.localDescription.sdp});}
 async offer(){const peer=this.create();this.attach(peer,peer.pc.createDataChannel('bluebod'));await peer.pc.setLocalDescription(await peer.pc.createOffer());return this.description(peer);}
 async accept(text){const desc=parsePairing(text);if(desc.type==='offer'){const peer=this.create();await peer.pc.setRemoteDescription(desc);await peer.pc.setLocalDescription(await peer.pc.createAnswer());return this.description(peer);}if(!this.pending||this.pending.pc.signalingState!=='have-local-offer')throw Error('Create an offer on this device before applying an answer.');await this.pending.pc.setRemoteDescription(desc);this.pending=null;return null;}
 close(){for(const peer of this.peers)peer.pc.close();this.peers.clear();}
}
