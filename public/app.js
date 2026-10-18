import {Pose3D} from './pose3d.js';
import {DeviceNetwork} from './network.js';
import {amplitudes,parseEspCsiLine,parseRuViewFrame,LinkStore,fitModel,predict,evaluate,leaveOneRoundOut,syntheticFrame,N_SC} from './csi.js';
import {MOVEMENTS,movementName,templatePose} from './movements.js';
const $=id=>document.getElementById(id);
const store=new LinkStore();
let records=[],devices=[],peers=0,outbox=[],remotePose=null;
let samples=[],linkIds=null,model=null,recent=[],estimate=null,recorder=null;
let sim=null,serialCount=0,bleCount=0;const sources=new Map();
let stream,poseModel,cameraOn=false,busy=false,lastVideo=-1,lastFrame=0,cameraPose=null,cameraPoseAt=0;
const figure=new Pose3D($('pose3d'),$('pose-state'));
$('front-view').onclick=()=>figure.view(0,0);
$('side-view').onclick=()=>figure.view(Math.PI/2,0);
$('reset-view').onclick=()=>figure.view();
$('zoom-in').onclick=()=>figure.zoom(-.3);
$('zoom-out').onclick=()=>figure.zoom(.3);
const edges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[0,11],[0,12]];
function notice(message){$('notice').textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('notice').textContent='',9000);}
function record(data){records.push(data);if(records.length>18000)records.shift();}
const shortMac=mac=>mac==='router'?'R':mac.replace(/:/g,'').slice(-4);

// ---- CSI sources: USB serial, Bluetooth, LAN peers, synthetic room ----
function ingest(rx,tx,iq,rssi,share=true){
 const amp=amplitudes(iq);if(!amp)return;
 const link=`${shortMac(tx)}>${rx}`,t=performance.now();store.add(link,amp,t,rssi);
 if(share&&peers)outbox.push({link,t:Math.round(t),rssi,amp:Array.from(amp,v=>Math.round(v*10)/10)});
}
setInterval(()=>{while(outbox.length)network.send({type:'csi',frames:outbox.splice(0,64)});},100);
function setSource(key,label){if(label)sources.set(key,label);else sources.delete(key);renderSources();}
function renderSources(){const list=[...sources.values()];if(peers)list.push(`${peers} LAN peer${peers===1?'':'s'}`);$('sources').textContent=list.length?list.join(' · '):'No WiFi sensors connected';}
const rxName=source=>`${network.id.slice(0,4)}·${source}`;

$('serial').onclick=async()=>{
 try{
 if(!navigator.serial)throw Error('Web Serial is unavailable. Use desktop Chrome or Edge over HTTPS or localhost.');
 const port=await navigator.serial.requestPort();await port.open({baudRate:Number($('baud').value),bufferSize:1<<16});
 const name=`USB${++serialCount}`;setSource(name,`${name} streaming`);notice(`${name} connected. Waiting for CSI_DATA lines from the board.`);readSerial(port,name);
 }catch(e){if(e.name!=='NotFoundError')notice(e.message);}
};
async function readSerial(port,name){
 const decoder=new TextDecoderStream(),piped=port.readable.pipeTo(decoder.writable).catch(()=>{}),reader=decoder.readable.getReader();let buffer='';
 try{for(;;){const {value,done}=await reader.read();if(done)break;buffer+=value;let i;while((i=buffer.indexOf('\n'))>=0){const f=parseEspCsiLine(buffer.slice(0,i).trim());buffer=buffer.slice(i+1);if(f)ingest(rxName(name),f.tx,f.iq,f.rssi);}if(buffer.length>65536)buffer='';}}
 catch(e){notice(`${name} stopped: ${e.message}`);}
 finally{reader.releaseLock();await piped;await port.close().catch(()=>{});setSource(name);}
}

$('bluetooth').onclick=async()=>{
 let device;
 try{
 if(!navigator.bluetooth)throw Error('Web Bluetooth is unavailable. Use a supported Chromium browser over HTTPS or localhost.');
 const service=$('service').value.trim().toLowerCase(),characteristic=$('characteristic').value.trim().toLowerCase();
 if(!service||!characteristic)throw Error('Enter the service and characteristic UUIDs supplied by your board.');
 device=await navigator.bluetooth.requestDevice({filters:[{services:[service]}]});
 const ch=await(await(await device.gatt.connect()).getPrimaryService(service)).getCharacteristic(characteristic);
 const name=`BLE${++bleCount}`,text=new TextDecoder();await ch.startNotifications();
 ch.addEventListener('characteristicvaluechanged',e=>{
 const v=e.target.value,bytes=new Uint8Array(v.buffer,v.byteOffset,v.byteLength),frame=parseRuViewFrame(bytes);
 if(frame)return ingest(rxName(name),frame.tx,frame.iq,frame.rssi);
 const line=parseEspCsiLine(text.decode(bytes).trim());if(line)return ingest(rxName(name),line.tx,line.iq,line.rssi);
 const m={type:'sensor',name:device.name||name,bytes:Array.from(bytes).slice(0,512)};record({...m,id:network.id,time:Date.now()});network.send(m);
 });
 device.addEventListener('gattserverdisconnected',()=>{setSource(name);notice(`${device.name||name} disconnected.`);});
 setSource(name,`${device.name||name} via Bluetooth`);notice(`Connected to ${device.name||'board'}. CSI frames feed the movement model.`);
 }catch(e){device?.gatt?.disconnect();if(e.name!=='NotFoundError')notice(e.message);}
};

const SIM_LINKS=['R>S1','R>S2','R>S3','S1>S2','S2>S3','S3>S1'];
for(const m of MOVEMENTS)$('sim-label').append(new Option(m.name,m.id));
$('sim').onclick=()=>{
 clearInterval(sim);
 sim=setInterval(()=>{const t=performance.now(),label=recorder?recorder.queue[recorder.index]:$('sim-label').value;for(const link of SIM_LINKS){const [tx,rx]=link.split('>');ingest(`sim·${rx}`,tx==='R'?'router':`00:00:00:00:00:${tx.slice(1).padStart(2,'0')}`,syntheticFrame(link,label,t),-50,false);}},40);
 $('sim-controls').hidden=false;setSource('sim','Synthetic room (not real data)');notice('Synthetic room running. While you record, the simulated person follows the prompts. This data is never shared with peers.');
};
$('sim-stop').onclick=()=>{clearInterval(sim);sim=null;$('sim-controls').hidden=true;setSource('sim');};

const network=new DeviceNetwork({name:()=>$('name').value,onerror:notice,
 ondata:m=>{
 if(m.type==='csi'){const last=Math.max(...m.frames.map(f=>f.t)),now=performance.now();for(const f of m.frames)store.add(f.link,Float32Array.from(f.amp),now-(last-f.t),f.rssi);}
 if(m.type==='pose'){record(m);remotePose={points:m.worldLandmarks||m.landmarks,world:!!m.worldLandmarks,at:performance.now()};}
 if(m.type==='sensor')record(m);
 },
 onchange:list=>{peers=list.length;devices=[{id:network.id,name:$('name').value},...list];$('device-count').textContent=`${peers} direct peer${peers===1?'':'s'} online`;$('status').textContent=peers?'Device network connected':'Ready to connect';$('devices').replaceChildren(...list.map(p=>{const el=document.createElement('div');el.textContent=`● ${p.name}`;return el;}));if(!peers)$('devices').textContent='No devices connected yet';renderSources();}
});
async function pairing(action){$('offer').disabled=true;$('accept').disabled=true;try{const code=await action();if(code){$('outgoing').value=code;notice('Pairing code ready. Copy it to the other device.');}else{$('outgoing').value='';notice('Answer applied. Connecting directly over LAN…');}}catch(e){notice(e.message);}finally{$('offer').disabled=false;$('accept').disabled=false;}}
$('offer').onclick=()=>pairing(()=>network.offer());
$('accept').onclick=()=>pairing(()=>network.accept($('incoming').value.trim()));
$('copy').onclick=async()=>{try{if(!$('outgoing').value)return notice('Create or accept an offer first.');await navigator.clipboard.writeText($('outgoing').value);notice('Pairing code copied.');}catch{$('outgoing').select();notice('Select and copy the pairing code manually.');}};

// ---- Guided training: the prompt is the label, so no camera is needed ----
for(const m of MOVEMENTS){const label=document.createElement('label');label.className='check';label.innerHTML=`<input type="checkbox" value="${m.id}" checked> ${m.name}`;$('movement-list').append(label);}
const chosen=()=>[...$('movement-list').querySelectorAll('input:checked')].map(i=>i.value);
const leadTime=label=>label==='nobody'?8000:3000;
function speak(text){try{if(!$('voice').checked||!window.speechSynthesis)return;speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}catch{}}
function startRecording(session){
 const queue=chosen(),now=performance.now();
 if(queue.length<2)return notice('Choose at least two movements.');
 const active=store.active(now);if(!active.length)return notice('No WiFi links are streaming. Connect a board or the synthetic room first.');
 if(linkIds&&!linkIds.every(id=>store.rate(id,now)>=.5))return notice(`The links changed since training (${linkIds.join(', ')}). Reconnect the same boards, or clear the training data.`);
 if(session==='test'&&!model)return notice('Record a training round first.');
 linkIds=linkIds||active;
 recorder={session,round:session==='train'?1+Math.max(0,...samples.filter(s=>s.session==='train').map(s=>s.round)):1,queue,index:-1,phaseStart:0,n:0,missing:0};
 if(session==='test')samples=samples.filter(s=>s.session!=='test');
 $('record-train').disabled=$('record-test').disabled=true;$('record-stop').disabled=false;nextPhase(now);
}
function nextPhase(now){
 const r=recorder;r.index++;if(r.index>=r.queue.length)return stopRecording(true);
 r.phaseStart=now;const m=MOVEMENTS.find(m=>m.id===r.queue[r.index]);speak(m.prompt);
}
function stopRecording(finished){
 const r=recorder;if(!r)return;recorder=null;window.speechSynthesis?.cancel();
 $('record-train').disabled=$('record-test').disabled=false;$('record-stop').disabled=true;$('prompt-progress').style.width='0';
 $('prompt-text').textContent=finished?`${r.session==='train'?'Training':'Test'} round ${r.round} saved · ${r.n} windows`:'Recording stopped';
 $('prompt-detail').textContent=r.missing?`${r.missing} windows skipped because a link went quiet.`:r.session==='train'?'Record more rounds for a steadier model, then a test round for an honest score.':'Test windows are scored by a model that never saw them.';
 if(finished)speak('Done.');retrain();persist();
}
function recordTick(now){
 const r=recorder,label=r.queue[r.index],elapsed=now-r.phaseStart,lead=leadTime(label),total=lead+Number($('seconds').value||20)*1000;
 if(elapsed>=total)return nextPhase(now);
 const m=MOVEMENTS.find(m=>m.id===label);$('prompt-progress').style.width=`${((r.index+elapsed/total)/r.queue.length)*100}%`;
 $('prompt-text').textContent=elapsed<lead?`Get ready: ${m.name} in ${Math.ceil((lead-elapsed)/1000)} s`:`${m.name} · ${Math.ceil((total-elapsed)/1000)} s left`;
 $('prompt-detail').textContent=`${r.session==='train'?'Training':'Test'} round ${r.round} · movement ${r.index+1} of ${r.queue.length} · ${m.prompt}`;
 if(elapsed<lead)return;
 const x=store.feature(linkIds,now);if(!x){r.missing++;return;}
 const pose=cameraOn&&cameraPose&&now-cameraPoseAt<500?cameraPose.map(p=>({x:+p.x.toFixed(3),y:+p.y.toFixed(3),z:+p.z.toFixed(3),visibility:+(p.visibility??1).toFixed(2)})):undefined;
 samples.push({x,y:label,session:r.session,round:r.round,pose});r.n++;
}
$('record-train').onclick=()=>startRecording('train');
$('record-test').onclick=()=>startRecording('test');
$('record-stop').onclick=()=>stopRecording(false);

function retrain(){
 const train=samples.filter(s=>s.session==='train'),test=samples.filter(s=>s.session==='test');
 if(!samples.length)linkIds=null;
 model=fitModel(train);recent=[];estimate=null;
 const counts={};for(const s of samples)(counts[s.session]??={})[s.y]=(counts[s.session][s.y]||0)+1;
 $('counts').textContent=samples.length?Object.entries(counts).map(([session,c])=>`${session}: ${Object.entries(c).map(([l,n])=>`${movementName(l)} ${n}`).join(', ')}`).join(' — '):'No windows recorded yet.';
 $('model-state').textContent=model?`Trained · ${train.length} windows · ${linkIds.length} links`:'Not trained';
 const scores=$('scores');scores.replaceChildren();if(!model)return;
 const result=evaluate(model,test),lor=leaveOneRoundOut(train),line=text=>{const p=document.createElement('p');p.textContent=text;scores.append(p);};
 if(lor!=null)line(`Leave-one-round-out: ${Math.round(lor*100)}% (chance ${Math.round(100/model.labels.length)}%)`);
 if(!result)return line('Record a test round for an honest accuracy score.');
 line(`Test round: ${Math.round(result.acc*100)}% of ${result.n} windows correct`);
 const table=document.createElement('table'),labels=Object.keys(result.confusion);
 table.innerHTML=`<caption>Rows: what you did · columns: what WiFi guessed</caption><tr><th></th>${labels.map(l=>`<th>${movementName(l).slice(0,4)}</th>`).join('')}<th>✓</th></tr>`+labels.filter(l=>result.per[l]!=null).map(l=>`<tr><th>${movementName(l)}</th>${labels.map(q=>`<td class="${l===q?'hit':''}">${result.confusion[l][q]||''}</td>`).join('')}<td>${Math.round(result.per[l]*100)}%</td></tr>`).join('');
 scores.append(table);
}
$('clear-test').onclick=()=>{samples=samples.filter(s=>s.session!=='test');retrain();persist();};
$('clear-data').onclick=()=>{if(!confirm('Delete all recorded training and test windows?'))return;samples=[];linkIds=null;retrain();persist();};
$('save-data').onclick=()=>{if(!samples.length)return notice('Nothing recorded yet.');download(`bluebod-training-${Date.now()}.json`,{format:'bluebod-training-v1',linkIds,samples:samples.map(s=>({...s,x:Array.from(s.x,v=>+v.toFixed(3))}))});};
$('load-data').onchange=async e=>{
 try{const data=JSON.parse(await e.target.files[0].text());if(data.format!=='bluebod-training-v1'||!Array.isArray(data.linkIds)||!Array.isArray(data.samples))throw Error('Not a BlueBod training file.');
 const size=data.linkIds.length*3*N_SC;if(!data.samples.every(s=>Array.isArray(s.x)&&s.x.length===size&&s.x.every(Number.isFinite)&&MOVEMENTS.some(m=>m.id===s.y)))throw Error('Training file has malformed windows or unknown movements.');
 linkIds=data.linkIds.map(String);samples=data.samples.map(s=>({x:Float32Array.from(s.x),y:s.y,session:s.session==='test'?'test':'train',round:Number(s.round)||1,pose:Array.isArray(s.pose)&&s.pose.length===33?s.pose:undefined}));
 retrain();persist();notice(`Loaded ${samples.length} windows for links ${linkIds.join(', ')}.`);
 }catch(err){notice(err.message);}finally{e.target.value='';}
};
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('bluebod',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function persist(){try{(await database()).transaction('kv','readwrite').objectStore('kv').put({linkIds,samples},'dataset');}catch{}}
async function restore(){try{const req=(await database()).transaction('kv').objectStore('kv').get('dataset');req.onsuccess=()=>{if(req.result?.samples?.length){({linkIds,samples}=req.result);retrain();notice(`Restored ${samples.length} recorded windows from this browser.`);}};}catch{}}
restore();

// ---- Live estimate every 0.5 s, averaged over the last 3 s ----
setInterval(()=>{
 const now=performance.now(),active=store.active(now,.5);
 $('link-rate').textContent=active.length?`${active.length} link${active.length===1?'':'s'} · ${Math.round(active.reduce((n,k)=>n+store.rate(k,now),0))} frames/s`:'— links';
 $('signal-empty').hidden=active.length>0;
 if(recorder)recordTick(now);
 const x=model&&linkIds?store.feature(linkIds,now):null;
 if(!x){estimate=null;$('prediction').hidden=true;if(model&&active.length&&!recorder)$('model-state').textContent='Waiting for the trained links';return;}
 const p=predict(model,x);recent.push(p.probs);if(recent.length>6)recent.shift();
 const probs=Object.fromEntries(model.labels.map(l=>[l,recent.reduce((s,r)=>s+r[l],0)/recent.length])),best=model.labels.reduce((a,b)=>probs[b]>probs[a]?b:a);
 estimate={best,confidence:probs[best],pose:p.best===best?p.pose:null};
 $('prediction').hidden=false;$('prediction-label').textContent=probs[best]>=.5?movementName(best):`Unsure · ${movementName(best)}?`;$('prediction-confidence').textContent=`${Math.round(probs[best]*100)}% of nearest windows`;
 record({type:'movement',id:network.id,time:Date.now(),movement:best,confidence:+probs[best].toFixed(2),synthetic:!!sim});
},500);

function animateFigure(t){
 const badge=text=>{$('pose-badge').textContent=text;};
 if(cameraOn){badge('CAMERA');}
 else if(recorder){const label=recorder.queue[recorder.index];badge('GUIDE');if(label==='nobody'){if(figure.mode!=='empty')figure.clear('Guide · leave the room');}else figure.update(templatePose(label,t),{mode:'guide',label:`Guide · ${movementName(label)}`});}
 else if(estimate){badge('WIFI ESTIMATE');if(estimate.best==='nobody'){if(figure.mode!=='empty')figure.clear('WiFi estimate · nobody in the room');}else figure.update(estimate.pose||templatePose(estimate.best,t),{mode:'wifi',label:estimate.pose?'WiFi estimate · mean of camera-recorded poses for this movement':'WiFi estimate · animated template of the predicted movement'});}
 else if(remotePose&&performance.now()-remotePose.at<1500){badge('LAN POSE');figure.update(remotePose.points,{world:remotePose.world,mode:'remote',label:'Pose from a linked device camera'});}
 else if(figure.mode!=='reference'){badge('REFERENCE');figure.reset();}
 requestAnimationFrame(animateFigure);
}
requestAnimationFrame(animateFigure);

// ---- Signal heat map: one strip per link, time left to right, subcarriers top to bottom ----
const heat=document.createElement('canvas');
function renderSignals(){
 const canvas=$('signals'),ctx=canvas.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight,now=performance.now();
 if(w&&h){canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
 const ids=store.active(now,.5).slice(0,8),cols=150;
 if(ids.length){
 heat.width=cols;heat.height=ids.length*N_SC;const hctx=heat.getContext('2d'),img=hctx.createImageData(cols,ids.length*N_SC);
 ids.forEach((id,row)=>{const amp=store.links.get(id).amp.slice(-cols),off=cols-amp.length;amp.forEach((frame,c)=>{for(let k=0;k<N_SC;k++){const v=Math.max(0,Math.min(1,(frame[k]-8)/26)),i=4*((row*N_SC+k)*cols+c+off);img.data[i]=40+215*v*v;img.data[i+1]=60+180*v;img.data[i+2]=110+145*Math.sqrt(v);img.data[i+3]=255;}});});
 hctx.putImageData(img,0,0);ctx.imageSmoothingEnabled=false;
 const gap=6,band=(h-24-gap*(ids.length-1))/ids.length;
 ids.forEach((id,row)=>{const y=12+row*(band+gap);ctx.drawImage(heat,0,row*N_SC,cols,N_SC,80,y,w-96,band);ctx.fillStyle='#9fb2d0';ctx.font='10px DM Sans, sans-serif';ctx.fillText(id.replace(/>.*·/,'>'),12,y+band/2);ctx.fillStyle='#64748d';ctx.fillText(`${Math.round(store.rate(id,now))}/s`,12,y+band/2+13);});
 }}
 setTimeout(()=>requestAnimationFrame(renderSignals),100);
}
renderSignals();

// ---- Optional camera teacher (MediaPipe runs locally; video never leaves the page) ----
function draw(points){const canvas=$('overlay'),ctx=canvas.getContext('2d');canvas.width=canvas.clientWidth*devicePixelRatio;canvas.height=canvas.clientHeight*devicePixelRatio;ctx.clearRect(0,0,canvas.width,canvas.height);if(!points)return;
 let w=canvas.width,h=canvas.height,ox=0,oy=0;if(stream&&$('video').videoWidth){const v=$('video'),s=Math.min(w/v.videoWidth,h/v.videoHeight);w=v.videoWidth*s;h=v.videoHeight*s;ox=(canvas.width-w)/2;oy=(canvas.height-h)/2;}
 ctx.strokeStyle='#91b5ff';ctx.lineWidth=3*devicePixelRatio;ctx.shadowColor='#81aaff';ctx.shadowBlur=10;for(const [a,b]of edges){const p=points[a],q=points[b];if(!p||!q||(p.visibility??1)<.4||(q.visibility??1)<.4)continue;ctx.beginPath();ctx.moveTo(ox+p.x*w,oy+p.y*h);ctx.lineTo(ox+q.x*w,oy+q.y*h);ctx.stroke();}for(const p of points){if((p.visibility??1)<.4)continue;ctx.beginPath();ctx.arc(ox+p.x*w,oy+p.y*h,3*devicePixelRatio,0,Math.PI*2);ctx.fillStyle='#d5e4ff';ctx.fill();}}
async function loadModel(){if(poseModel)return poseModel;notice('Loading the pose model. The first download may take a moment.');const {FilesetResolver,PoseLandmarker}=await import('./vendor/vision_bundle.mjs');const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href);poseModel=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./models/pose_landmarker_lite.task',import.meta.url).href},runningMode:'VIDEO',numPoses:1});return poseModel;}
function stopCamera(){cameraOn=false;cameraPose=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;draw();$('empty').style.display='flex';$('stop').disabled=true;$('start').disabled=false;$('capture-label').textContent='CAMERA OFF';$('tracking').textContent='Camera off';$('fps').textContent='— FPS';lastVideo=-1;}
$('start').onclick=async()=>{if(busy)return;busy=true;stopCamera();$('start').disabled=true;$('teacher').open=true;try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access requires localhost or trusted HTTPS.');stream=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720,facingMode:'user'},audio:false});$('video').srcObject=stream;await $('video').play();await loadModel();cameraOn=true;$('empty').style.display='none';$('stop').disabled=false;$('capture-label').textContent='LIVE · CAMERA TEACHER';notice('Camera teacher on. Recorded windows now include your 3D pose.');requestAnimationFrame(loop);}catch(e){stopCamera();notice(e.message);}finally{busy=false;}};
function loop(t){if(!cameraOn)return;try{if($('video').currentTime!==lastVideo&&t-lastFrame>65){lastVideo=$('video').currentTime;const result=poseModel.detectForVideo($('video'),t),points=result.landmarks[0],worldLandmarks=result.worldLandmarks[0];draw(points);$('fps').textContent=`${Math.round(1000/(t-lastFrame))} FPS`;lastFrame=t;$('tracking').textContent=points?'Tracking 33 landmarks':'Looking for a person';if(points){cameraPose=worldLandmarks||null;cameraPoseAt=performance.now();figure.update(worldLandmarks||points,{world:!!worldLandmarks,aspect:$('video').videoWidth/$('video').videoHeight,label:'Camera teacher · estimated 3D pose'});const m={type:'pose',landmarks:points,worldLandmarks,id:network.id,time:Date.now()};record(m);network.send(m);}}requestAnimationFrame(loop);}catch(e){stopCamera();notice(`Tracking stopped: ${e.message}`);}}
$('stop').onclick=stopCamera;

function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>{if(!records.length)return notice('No data to export yet. Connect a sensor and train a model.');download(`bluebod-${Date.now()}.json`,{format:'bluebod-v2',exportedAt:new Date().toISOString(),devices,linkIds,coordinateSystem:'movement: WiFi CSI k-NN estimate; landmarks: normalized image coordinates; worldLandmarks: hip-centered estimated meters per camera',frames:records});notice(`Exported ${records.length} records. The session retains the latest 18,000 records.`);};
window.addEventListener('beforeunload',()=>{stream?.getTracks().forEach(t=>t.stop());network.close();figure.destroy();});
