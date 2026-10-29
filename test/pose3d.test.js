import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toScene,project,referencePose,Pose3D} from '../public/pose3d.js';
test('world coordinates center the hips and invert vertical/depth axes',()=>{
 const input=referencePose();for(const p of input){p.x+=2;p.y+=3;p.z+=4;}
 const points=toScene(input);
 assert.ok(Math.abs((points[23].x+points[24].x)/2)<1e-9);
 assert.ok(Math.abs(points[23].y)<1e-9);
 assert.ok(points[0].y>points[27].y);
 assert.ok(points[16].z>0);
});
test('perspective responds to depth and orbit direction',()=>{
 const front=project({x:1,y:0,z:0},0,0,3,600,400);
 const side=project({x:1,y:0,z:0},Math.PI/2,0,3,600,400);
 assert.ok(front.x>300);assert.ok(Math.abs(side.x-300)<1e-8);
 assert.ok(project({x:1,y:0,z:1},0,0,3,600,400).x>front.x);
});
test('reference figure stays finite with visible limbs',()=>{
 const world=referencePose(100);
 assert.ok(world[16].y!==referencePose(500)[16].y);
 for(const p of toScene(world))assert.ok(Object.values(project(p,.4,.2,3.5,600,400)).every(Number.isFinite));
});
test('renderer draws startup reference figure without a camera or WebGL',()=>{
 const previous={ResizeObserver:globalThis.ResizeObserver,requestAnimationFrame:globalThis.requestAnimationFrame,document:globalThis.document,devicePixelRatio:globalThis.devicePixelRatio};
 let lines=0,circles=0;
 try{
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.requestAnimationFrame=()=>1;globalThis.document={hidden:false};globalThis.devicePixelRatio=1;
 const ctx=new Proxy({},{get:(_,key)=>key==='arc'?()=>circles++:key==='lineTo'?()=>lines++:()=>{},set:()=>true});
 const canvas={clientWidth:600,clientHeight:400,getContext:()=>ctx,addEventListener(){}};
 const figure=new Pose3D(canvas,{textContent:''});
 assert.equal(figure.mode,'reference');assert.ok(lines>30);assert.ok(circles>10);
 }finally{Object.assign(globalThis,previous);}
});
