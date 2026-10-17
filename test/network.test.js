import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePairing,validPacket,DeviceNetwork} from '../public/network.js';
test('pairing accepts descriptions and rejects invalid codes',()=>{
 assert.deepEqual(parsePairing(JSON.stringify({version:1,type:'offer',sdp:'test'})),{type:'offer',sdp:'test'});
 assert.throws(()=>parsePairing('{}'));
 assert.throws(()=>parsePairing(JSON.stringify({version:1,type:'answer',sdp:42})));
});
test('packets validate pose and sensor payloads',()=>{
 const base={id:'a',packetId:'b',time:1};
 assert.ok(validPacket({...base,type:'pose',landmarks:[{x:0,y:0,z:0}]}));
 assert.ok(validPacket({...base,type:'sensor',name:'IMU',bytes:[0,255]}));
 assert.equal(validPacket({...base,type:'sensor',name:'IMU',bytes:[256]}),false);
 assert.equal(validPacket({...base,type:'pose',landmarks:[{x:null,y:0,z:0}]}),false);
});
test('chain forwards each packet once and excludes incoming channel',()=>{
 let received=0,forwarded=0;
 const net=new DeviceNetwork({name:()=> 'test',ondata:()=>received++,onchange:()=>{},onerror:()=>{}});
 const a={pc:{},channel:null},b={channel:{readyState:'open',bufferedAmount:0,send:()=>forwarded++}};
 const channel={readyState:'open',bufferedAmount:0,send:()=>assert.fail('echo')};
 net.peers.add(a);net.peers.add(b);net.attach(a,channel);
 const data=JSON.stringify({type:'sensor',id:'remote',packetId:'unique',time:1,name:'IMU',bytes:[2]});
 channel.onmessage({data});channel.onmessage({data});
 assert.equal(received,1);assert.equal(forwarded,1);
});
