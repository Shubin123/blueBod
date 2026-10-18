export const BONES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32]];
export function referencePose(time=0){
 const points=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
 const wave=Math.sin(time/700)*.08;
 for(const [i,x,y,z] of [[0,0,-.79,-.02],[11,-.23,-.51,0],[12,.23,-.51,0],[13,-.43,-.28,-.03],[14,.43,-.38,-.08],[15,-.52,-.05,-.08],[16,.48,-.65+wave,-.2],[23,-.14,0,0],[24,.14,0,0],[25,-.17,.43,.03],[26,.18,.43,-.02],[27,-.19,.86,0],[28,.2,.86,0],[29,-.19,.9,.04],[30,.2,.9,.04],[31,-.19,.9,-.15],[32,.2,.9,-.15]])points[i]={x,y,z,visibility:1};
 return points;
}
export function toScene(points,world=true,aspect=1){
 if(!points?.length)return [];
 const hipA=points[23],hipB=points[24];
 const cx=hipA&&hipB?(hipA.x+hipB.x)/2:world?0:.5;
 const cy=hipA&&hipB?(hipA.y+hipB.y)/2:world?0:.5;
 const cz=hipA&&hipB?(hipA.z+hipB.z)/2:0;
 return points.map(p=>({x:(p.x-cx)*(world?1:2*aspect),y:-(p.y-cy)*(world?1:2),z:-(p.z-cz)*(world?1:2*aspect),visibility:p.visibility??1}));
}
export function project(p,yaw,pitch,distance,width,height){
 const x=p.x*Math.cos(yaw)+p.z*Math.sin(yaw),z=-p.x*Math.sin(yaw)+p.z*Math.cos(yaw);
 const y=p.y*Math.cos(pitch)-z*Math.sin(pitch),depth=p.y*Math.sin(pitch)+z*Math.cos(pitch);
 const scale=Math.min(width,height)*1.45/Math.max(.2,distance-depth);
 return {x:width/2+x*scale,y:height*.47-y*scale,depth,scale};
}
export class Pose3D{
 constructor(canvas,label){
 this.canvas=canvas;this.label=label;this.ctx=canvas.getContext('2d');this.yaw=-.35;this.pitch=.12;this.distance=3.5;this.points=toScene(referencePose());this.mode='reference';this.updated=0;this.dirty=true;
 this.resize=new ResizeObserver(()=>this.dirty=true);this.resize.observe(canvas);
 let drag=null;
 canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointermove',e=>{if(!drag)return;this.yaw+=(e.clientX-drag.x)*.01;this.pitch=Math.max(-1.1,Math.min(1.1,this.pitch+(e.clientY-drag.y)*.008));drag={x:e.clientX,y:e.clientY};this.dirty=true;});
 const release=()=>drag=null;canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
 canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY*.002);},{passive:false});
 canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')this.yaw-=.12;if(e.key==='ArrowRight')this.yaw+=.12;if(e.key==='ArrowUp')this.pitch=Math.max(-1.1,this.pitch-.1);if(e.key==='ArrowDown')this.pitch=Math.min(1.1,this.pitch+.1);if(e.key==='+')this.zoom(-.2);if(e.key==='-')this.zoom(.2);this.dirty=true;}});
 const animate=()=>{if(this.mode==='live'&&performance.now()-this.updated>1200){this.mode='stale';this.label.textContent='Tracking lost · last estimated pose';this.dirty=true;}if(this.dirty&&!document.hidden){this.render();this.dirty=false;}this.frame=requestAnimationFrame(animate);};animate();
 }
 update(points,{world=true,aspect=1,mode='live',label}={}){if(!points?.length)return;this.points=toScene(points,world,aspect);this.mode=mode;this.updated=performance.now();this.label.textContent=label||(mode==='demo'?'Demo · synthetic movement':mode==='reference'?'Reference figure · connect a WiFi sensor to track':world?'Live · estimated 3D pose':'Live · approximate depth (older peer)');this.dirty=true;}
 clear(label){this.points=[];this.mode='empty';this.label.textContent=label;this.dirty=true;}
 reset(){this.update(referencePose(),{mode:'reference'});}
 view(yaw=-.35,pitch=.12){this.yaw=yaw;this.pitch=pitch;this.distance=3.5;this.dirty=true;}
 zoom(amount){this.distance=Math.max(2,Math.min(7,this.distance+amount));this.dirty=true;}
 render(){
 const c=this.canvas,ctx=this.ctx,dpr=Math.min(devicePixelRatio||1,2),w=c.clientWidth,h=c.clientHeight;if(!w||!h)return;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
 const proj=p=>project(p,this.yaw,this.pitch,this.distance,w,h);
 const line=(a,b,color,width=1)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();};
 for(let i=-6;i<=6;i++){const t=i*.25;line(proj({x:t,y:-.94,z:-1.5}),proj({x:t,y:-.94,z:1.5}),'#34486255');line(proj({x:-1.5,y:-.94,z:t}),proj({x:1.5,y:-.94,z:t}),'#34486255');}
 const origin={x:-.85,y:-.93,z:0};for(const [p,color,text]of [[{x:-.5,y:-.93,z:0},'#eb9aab','X'],[{x:-.85,y:-.58,z:0},'#7edbc0','Y'],[{x:-.85,y:-.93,z:.35},'#91afff','Z']]){const end=proj(p);line(proj(origin),end,color,2);ctx.fillStyle=color;ctx.font='10px sans-serif';ctx.fillText(text,end.x+5,end.y);}
 const points=this.points.map(proj),visible=i=>this.points[i]&&this.points[i].visibility>=.4;
 const bones=BONES.filter(([a,b])=>visible(a)&&visible(b)).map(([a,b])=>({a:points[a],b:points[b],left:a%2===1,depth:(points[a].depth+points[b].depth)/2}));
 if(visible(0)&&visible(11)&&visible(12)){const neck={x:(this.points[11].x+this.points[12].x)/2,y:(this.points[11].y+this.points[12].y)/2,z:(this.points[11].z+this.points[12].z)/2};bones.push({a:proj(neck),b:points[0],depth:points[0].depth,left:false});}
 ctx.lineCap='round';for(const bone of bones.sort((a,b)=>a.depth-b.depth)){line(bone.a,bone.b,'#101d31',10);line(bone.a,bone.b,bone.left?'#8ab4ff':'#7edbc0',5);}
 for(const i of [...new Set(BONES.flat())].filter(visible).sort((a,b)=>points[a].depth-points[b].depth)){const p=points[i];ctx.beginPath();ctx.arc(p.x,p.y,Math.max(3,p.scale*.022),0,Math.PI*2);ctx.fillStyle='#e0edff';ctx.fill();}
 if(visible(0)){const p=points[0];ctx.beginPath();ctx.arc(p.x,p.y,p.scale*.105,0,Math.PI*2);ctx.fillStyle='#192c45';ctx.fill();ctx.strokeStyle='#adc9ff';ctx.lineWidth=3;ctx.stroke();const nose=proj({...this.points[0],z:this.points[0].z+.12});line(p,nose,'#adc9ff',2);}
 }
 destroy(){cancelAnimationFrame(this.frame);this.resize.disconnect();}
}
