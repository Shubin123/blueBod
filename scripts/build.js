import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await cp('public','dist',{recursive:true});
// Optional camera teacher: the MediaPipe runtime and both pose models are served with the app.
await mkdir('dist/vendor',{recursive:true});
await cp('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs','dist/vendor/vision_bundle.mjs');
await cp('node_modules/@mediapipe/tasks-vision/wasm','dist/vendor/wasm',{recursive:true});
await mkdir('dist/models',{recursive:true});
for(const variant of ['full','heavy']){
 const response=await fetch(`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`);
 if(!response.ok)throw Error(`Model download failed: ${response.status}`);
 await writeFile(`dist/models/pose_landmarker_${variant}.task`,Buffer.from(await response.arrayBuffer()));
}
await writeFile('dist/.nojekyll','');
console.log('Static application built in dist/');
