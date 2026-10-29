import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENTS,templatePose} from '../public/movements.js';
test('templates exist for every movement and stay finite',()=>{
 assert.equal(templatePose('nobody'),null);
 for(const m of MOVEMENTS.filter(m=>m.id!=='nobody'))for(const t of [0,333,1700]){const p=templatePose(m.id,t);assert.equal(p.length,33);assert.ok(p.every(q=>[q.x,q.y,q.z].every(Number.isFinite)));assert.ok(p[0].y<p[27].y,'head above feet');}
 assert.notDeepEqual(templatePose('squatting',0)[25],templatePose('squatting',1000)[25]);
});
