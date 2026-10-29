import {Pose3D} from './pose3d.js';
import {ROUTERS,WINDOW,FEATURES,SOURCE_NAMES,cleanHost,findRouter,probe,RadioStore} from './radio.js';
import {fitModel,predict,evaluate,leaveOneRoundOut} from './model.js';
import {MOVEMENTS,movementName,templatePose} from './movements.js';
const $=id=>document.getElementById(id);
const store=new RadioStore();
let records=[],samples=[],sources=null,model=null,recent=[],estimate=null,recorder=null;
let router=null,probing=false,finding=false,lastAnswer=0,bleScan=null;const sensing=new Map(),bleNames=new Map();
const figure=new Pose3D($('pose3d'),$('pose-state'));
$('front-view').onclick=()=>figure.view(0,0);
$('side-view').onclick=()=>figure.view(Math.PI/2,0);
$('reset-view').onclick=()=>figure.view();
$('zoom-in').onclick=()=>figure.zoom(-.3);
$('zoom-out').onclick=()=>figure.zoom(.3);
function notice(message){$('notice').textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('notice').textContent='',9000);}
function record(data){records.push(data);if(records.length>18000)records.shift();}
const sourceList=list=>list.map(s=>SOURCE_NAMES[s]).join(' + ');
function setSource(key,label){
 if(label)sensing.set(key,label);else sensing.delete(key);
 const list=[...sensing.values()];$('sources').textContent=list.length?list.join(' · '):'Not sensing';
 $('status').textContent=list.length?'Sensing with this device':'Ready to sense';$('stop-sensing').hidden=!list.length;
}

// ---- WiFi: time up to 10 round trips per second to the router (gentle on its web server) ----
async function startWifi(){
 if(probing||finding)return;
 const typed=cleanHost($('router').value);finding=true;$('find').disabled=true;
 $('wifi-state').textContent=typed?`Checking ${typed}…`:'Looking for your router…';
 try{
 let permission;try{permission=(await navigator.permissions.query({name:'local-network-access'})).state;}catch{}
 if(permission==='denied')throw Error('Local network access is blocked for this site. Allow it in the site settings (the icon left of the address), then try again.');
 const found=await findRouter(typed?[typed]:ROUTERS,{timeout:permission==='granted'?5000:30000});
 if(!found)throw Error(`${typed?`${typed} didn't answer.`:'No common router address answered.'} Use desktop Chrome or Edge and allow local network access when asked, or type your router's address (it's on the router's label or in your WiFi settings).`);
 router=found.host;$('router').value=router;probing=true;lastAnswer=performance.now();
 setSource('wifi',`WiFi ↔ ${router}`);notice(`Timing the WiFi link to ${router}. Keep this tab in front while sensing.${bleSupported?'':` Bluetooth mode also needs ${FLAG} turned on.`}`);wifiLoop();
 }catch(e){$('wifi-state').textContent='Off';notice(e.message);}
 finally{finding=false;$('find').disabled=false;}
}
async function wifiLoop(){
 while(probing){
 const t=performance.now(),r=await probe(router);if(!probing)break;
 store.addWifi(t,r.ok?r.ms:null);if(r.ok)lastAnswer=performance.now();
 record({type:'wifi',time:Date.now(),ms:r.ok?+r.ms.toFixed(2):null});
 if(performance.now()-lastAnswer>5000){stopWifi();notice(`${router} stopped answering. Check this device is still on its WiFi, then start again.`);break;}
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,100-(performance.now()-t))));
 }
}
function stopWifi(){probing=false;$('wifi-state').textContent='Off';setSource('wifi');}
$('find').onclick=()=>{if(finding)return;stopWifi();startWifi();};

// ---- Bluetooth: signal strength of nearby advertising devices (where the browser allows scanning) ----
// Chrome only exposes Bluetooth scanning behind its experimental flag; without it requestLEScan is missing.
const FLAG='chrome://flags/#enable-experimental-web-platform-features',bleSupported=!!navigator.bluetooth?.requestLEScan;
$('ble-state').textContent=bleSupported?'Off':'Needs Chrome flag';$('ble-flag').hidden=bleSupported;
async function flagNotice(){
 const steps=`set "Experimental Web Platform features" to Enabled, relaunch Chrome and come back.`;
 try{await navigator.clipboard.writeText(FLAG);notice(`Bluetooth mode needs desktop Chrome with ${FLAG} turned on. The address is copied: paste it into the address bar, ${steps}`);}
 catch{notice(`Bluetooth mode needs desktop Chrome with ${FLAG} turned on. Open that address in a new tab, ${steps}`);}
}
async function startBle(){
 if(!bleSupported||bleScan?.active)return;
 try{bleScan=await navigator.bluetooth.requestLEScan({acceptAllAdvertisements:true,keepRepeatedDevices:true});$('ble-state').textContent='Scanning';setSource('ble','Bluetooth scan');}
 catch(e){if(e.name!=='NotFoundError'&&e.name!=='NotAllowedError')notice(e.message);}
}
function stopBle(){bleScan?.stop();bleScan=null;if(bleSupported)$('ble-state').textContent='Off';setSource('ble');}
navigator.bluetooth?.addEventListener?.('advertisementreceived',e=>{if(!Number.isFinite(e.rssi))return;store.addBle(e.device.id,performance.now(),e.rssi);if(e.device.name)bleNames.set(e.device.id,e.device.name);});
$('ble').onclick=()=>!bleSupported?flagNotice():bleScan?.active?stopBle():startBle();

// Bluetooth first: its scan prompt needs the click, which router discovery would outlast.
$('start').onclick=()=>{if(bleSupported)startBle();startWifi();};
$('stop-sensing').onclick=()=>{stopWifi();stopBle();};

// ---- Guided training: the prompt is the label ----
const DEFAULTS=['standing','walking','waving','nobody'];
for(const m of MOVEMENTS){const label=document.createElement('label');label.className='check';label.innerHTML=`<input type="checkbox" value="${m.id}"${DEFAULTS.includes(m.id)?' checked':''}> ${m.name}`;$('movement-list').append(label);}
const chosen=()=>[...$('movement-list').querySelectorAll('input:checked')].map(i=>i.value);
const leadTime=label=>label==='nobody'?8000:3000;
function speak(text){try{if(!$('voice').checked||!window.speechSynthesis)return;speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}catch{}}
function startRecording(session){
 const queue=chosen(),now=performance.now(),live=store.active(now);
 if(queue.length<2)return notice('Choose at least two movements.');
 if(!live.length)return notice('Nothing is sensing yet. Press Start sensing first.');
 if(sources&&!sources.every(s=>live.includes(s)))return notice(`The model was trained with ${sourceList(sources)}. Start the same sources, or clear the training data.`);
 if(session==='test'&&!model)return notice('Record a training round first.');
 sources=sources||live;
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
 $('prompt-detail').textContent=r.missing?`${r.missing} windows skipped because a source went quiet.`:r.session==='train'?'Record more rounds for a steadier model, then a test round for an honest score.':'Test windows are scored by a model that never saw them.';
 if(finished)speak('Done.');retrain();persist();
}
function recordTick(now){
 const r=recorder,label=r.queue[r.index],elapsed=now-r.phaseStart,lead=leadTime(label),total=lead+Number($('seconds').value||20)*1000;
 if(elapsed>=total)return nextPhase(now);
 const m=MOVEMENTS.find(m=>m.id===label);$('prompt-progress').style.width=`${((r.index+elapsed/total)/r.queue.length)*100}%`;
 $('prompt-text').textContent=elapsed<lead?`Get ready: ${m.name} in ${Math.ceil((lead-elapsed)/1000)} s`:`${m.name} · ${Math.ceil((total-elapsed)/1000)} s left`;
 $('prompt-detail').textContent=`${r.session==='train'?'Training':'Test'} round ${r.round} · movement ${r.index+1} of ${r.queue.length} · ${m.prompt}`;
 // Windows start once a full window lies inside this movement.
 if(elapsed<lead+WINDOW)return;
 const x=store.feature(sources,now);if(!x){r.missing++;return;}
 samples.push({x,y:label,session:r.session,round:r.round});r.n++;
}
$('record-train').onclick=()=>startRecording('train');
$('record-test').onclick=()=>startRecording('test');
$('record-stop').onclick=()=>stopRecording(false);

function retrain(){
 const train=samples.filter(s=>s.session==='train'),test=samples.filter(s=>s.session==='test');
 if(!samples.length)sources=null;
 model=fitModel(train);recent=[];estimate=null;
 const counts={};for(const s of samples)(counts[s.session]??={})[s.y]=(counts[s.session][s.y]||0)+1;
 $('counts').textContent=samples.length?Object.entries(counts).map(([session,c])=>`${session}: ${Object.entries(c).map(([l,n])=>`${movementName(l)} ${n}`).join(', ')}`).join(' — '):'No windows recorded yet.';
 $('model-state').textContent=model?`Trained · ${train.length} windows · ${sourceList(sources)}`:'Not trained';
 const scores=$('scores');scores.replaceChildren();if(!model)return;
 const result=evaluate(model,test),lor=leaveOneRoundOut(train),line=text=>{const p=document.createElement('p');p.textContent=text;scores.append(p);};
 if(lor!=null)line(`Leave-one-round-out: ${Math.round(lor*100)}% (chance ${Math.round(100/model.labels.length)}%)`);
 if(!result)return line('Record a test round for an honest accuracy score.');
 line(`Test round: ${Math.round(result.acc*100)}% of ${result.n} windows correct`);
 const table=document.createElement('table'),labels=Object.keys(result.confusion);
 table.innerHTML=`<caption>Rows: what you did · columns: what the radio guessed</caption><tr><th></th>${labels.map(l=>`<th>${movementName(l).slice(0,4)}</th>`).join('')}<th>✓</th></tr>`+labels.filter(l=>result.per[l]!=null).map(l=>`<tr><th>${movementName(l)}</th>${labels.map(q=>`<td class="${l===q?'hit':''}">${result.confusion[l][q]||''}</td>`).join('')}<td>${Math.round(result.per[l]*100)}%</td></tr>`).join('');
 scores.append(table);
}
$('clear-test').onclick=()=>{samples=samples.filter(s=>s.session!=='test');retrain();persist();};
$('clear-data').onclick=()=>{if(!confirm('Delete all recorded training and test windows?'))return;samples=[];sources=null;retrain();persist();};
$('save-data').onclick=()=>{if(!samples.length)return notice('Nothing recorded yet.');download(`bluebod-training-${Date.now()}.json`,{format:'bluebod-training-v2',sources,samples:samples.map(s=>({...s,x:Array.from(s.x,v=>+v.toFixed(4))}))});};
$('load-data').onchange=async e=>{
 try{const data=JSON.parse(await e.target.files[0].text());
 if(data.format!=='bluebod-training-v2'||!Array.isArray(data.sources)||!data.sources.length||!data.sources.every(s=>s in FEATURES)||new Set(data.sources).size!==data.sources.length||!Array.isArray(data.samples))throw Error('Not a BlueBod radio training file. Files from the ESP32 CSI version cannot be loaded.');
 const size=data.sources.reduce((n,s)=>n+FEATURES[s],0);if(!data.samples.every(s=>Array.isArray(s.x)&&s.x.length===size&&s.x.every(Number.isFinite)&&MOVEMENTS.some(m=>m.id===s.y)))throw Error('Training file has malformed windows or unknown movements.');
 sources=data.sources;samples=data.samples.map(s=>({x:Float32Array.from(s.x),y:s.y,session:s.session==='test'?'test':'train',round:Number(s.round)||1}));
 retrain();persist();notice(`Loaded ${samples.length} windows recorded with ${sourceList(sources)}.`);
 }catch(err){notice(err.message);}finally{e.target.value='';}
};
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('bluebod',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function persist(){try{(await database()).transaction('kv','readwrite').objectStore('kv').put({sources,samples},'radio-dataset');}catch{}}
async function restore(){try{const req=(await database()).transaction('kv').objectStore('kv').get('radio-dataset');req.onsuccess=()=>{if(req.result?.samples?.length){({sources,samples}=req.result);retrain();notice(`Restored ${samples.length} recorded windows from this browser.`);}};}catch{}}
restore();

// ---- Live estimate every 0.5 s from the last 3 s, averaged over the last 2 s of estimates ----
setInterval(()=>{
 const now=performance.now(),live=store.active(now),devices=store.bleDevices(now).length;
 const parts=[];if(live.includes('wifi'))parts.push(`WiFi ${Math.round(store.wifiRate(now))}/s`);if(devices)parts.push(`${devices} Bluetooth device${devices===1?'':'s'}`);
 $('link-rate').textContent=parts.join(' · ')||'—';$('radio-count').textContent=parts.join(' · ')||'No radios sensing';
 if(probing){const recent=store.wifi.filter(s=>s.t>now-2000&&s.ms!=null).map(s=>s.ms).sort((a,b)=>a-b);$('wifi-state').textContent=recent.length?`${router} · ${recent[recent.length>>1].toFixed(1)} ms`:`${router} · waiting`;}
 if(bleScan?.active)$('ble-state').textContent=`Scanning · ${devices} heard`;
 $('signal-empty').hidden=sensing.size>0;
 if(recorder)recordTick(now);
 const x=model&&sources?store.feature(sources,now):null;
 if(!x){estimate=null;$('prediction').hidden=true;if(model&&live.length&&!recorder)$('model-state').textContent=`Waiting for ${sourceList(sources)}`;return;}
 const p=predict(model,x);recent.push(p.probs);if(recent.length>4)recent.shift();
 const probs=Object.fromEntries(model.labels.map(l=>[l,recent.reduce((s,r)=>s+r[l],0)/recent.length])),best=model.labels.reduce((a,b)=>probs[b]>probs[a]?b:a);
 estimate={best,confidence:probs[best]};
 $('prediction').hidden=false;$('prediction-label').textContent=probs[best]>=.5?movementName(best):`Unsure · ${movementName(best)}?`;$('prediction-confidence').textContent=`${Math.round(probs[best]*100)}% of nearest windows`;
 record({type:'movement',time:Date.now(),movement:best,confidence:+probs[best].toFixed(2)});
},500);

function animateFigure(t){
 const badge=text=>{$('pose-badge').textContent=text;};
 if(recorder){const label=recorder.queue[recorder.index];badge('GUIDE');if(label==='nobody'){if(figure.mode!=='empty')figure.clear('Guide · leave the room');}else figure.update(templatePose(label,t),{mode:'guide',label:`Guide · ${movementName(label)}`});}
 else if(estimate){badge('RADIO ESTIMATE');if(estimate.best==='nobody'){if(figure.mode!=='empty')figure.clear('Radio estimate · nobody in the room');}else figure.update(templatePose(estimate.best,t),{mode:'radio',label:'Radio estimate · animated template of the predicted movement'});}
 else if(figure.mode!=='reference'){badge('REFERENCE');figure.reset();}
 requestAnimationFrame(animateFigure);
}
requestAnimationFrame(animateFigure);

// ---- Signals: WiFi round trips on a log scale, then one heat strip per Bluetooth device ----
const SPAN=15000,heatColor=v=>`rgb(${40+215*v*v|0},${60+180*v|0},${110+145*Math.sqrt(v)|0})`;
function renderSignals(){
 const canvas=$('signals'),ctx=canvas.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight,now=performance.now();
 if(w&&h){canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
 const x0=86,plot=w-x0-16,xAt=t=>x0+plot*(1-(now-t)/SPAN),label=(text,y,color='#9fb2d0')=>{ctx.fillStyle=color;ctx.font='10px DM Sans, sans-serif';ctx.fillText(text,12,y);};
 const devices=store.bleDevices(now,SPAN,2).map(id=>{const d=store.ble.get(id);return {id,d,mean:d.rssi.reduce((a,b)=>a+b,0)/d.rssi.length};}).sort((a,b)=>b.mean-a.mean).slice(0,6);
 const wifiOn=store.wifi.some(s=>s.t>now-SPAN);let top=12;
 if(wifiOn){
 const H=devices.length?h*.45:h-24,lo=Math.log(.5),hi=Math.log(300),yAt=ms=>top+H*(1-(Math.log(Math.max(.5,Math.min(300,ms)))-lo)/(hi-lo));
 for(const ms of [1,10,100]){ctx.strokeStyle='#26324466';ctx.beginPath();ctx.moveTo(x0,yAt(ms));ctx.lineTo(x0+plot,yAt(ms));ctx.stroke();ctx.fillStyle='#4f5f78';ctx.font='9px DM Sans, sans-serif';ctx.fillText(`${ms} ms`,x0+plot-28,yAt(ms)-3);}
 for(const s of store.wifi){if(s.t<=now-SPAN)continue;const x=xAt(s.t);if(s.ms==null){ctx.fillStyle='#eb9aab';ctx.fillRect(x-1,top,2,6);}else{ctx.fillStyle='#91afff';ctx.fillRect(x-1.5,yAt(s.ms)-1.5,3,3);}}
 label('WiFi ↔ router',top+H/2);label('round trip',top+H/2+13,'#64748d');top+=H+12;
 }
 if(devices.length){
 const gap=4,band=Math.min(26,(h-top-12-gap*(devices.length-1))/devices.length);
 devices.forEach(({id,d,mean},row)=>{const y=top+row*(band+gap);ctx.fillStyle='#141d2b';ctx.fillRect(x0,y,plot,band);
 for(let i=0;i<d.t.length;i++){if(d.t[i]<=now-SPAN)continue;const x=xAt(d.t[i]),next=i+1<d.t.length?xAt(d.t[i+1]):x0+plot;ctx.fillStyle=heatColor(Math.max(0,Math.min(1,(d.rssi[i]+100)/60)));ctx.fillRect(x,y,Math.max(2,Math.min(next-x,20)),band);}
 label(`ᛒ ${(bleNames.get(id)||id).slice(0,9)}`,y+band/2+(band>=22?-1:3));if(band>=22)label(`${Math.round(mean)} dBm`,y+band/2+10,'#64748d');});
 }
 }
 setTimeout(()=>requestAnimationFrame(renderSignals),100);
}
renderSignals();

function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>{if(!records.length)return notice('No data to export yet. Start sensing first.');download(`bluebod-${Date.now()}.json`,{format:'bluebod-v3',exportedAt:new Date().toISOString(),router,sources,description:'wifi: round-trip ms to the router (null = no answer); movement: k-NN estimate from radio features',frames:records});notice(`Exported ${records.length} records. The session retains the latest 18,000 records.`);};
window.addEventListener('beforeunload',()=>{probing=false;bleScan?.stop();figure.destroy();});
