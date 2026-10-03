import test from 'node:test';
import assert from 'node:assert/strict';
import {compileBlueprint,inspectConstruction} from '../environment/construction.mjs';
import {Vec3} from 'vec3';
import {parseModelJson} from '../planners/qwen.mjs';
const sites=[{id:'observed-site',origin:{x:10,y:70,z:20},size:3}];
const plan={site_id:'observed-site',material:'dirt',cuboids:[
  {from:[0,0,0],to:[2,0,2]},{from:[0,3,0],to:[2,3,2]},
  {from:[0,1,0],to:[2,2,0]},{from:[0,1,2],to:[2,2,2]},
  {from:[0,1,0],to:[0,2,2]},{from:[2,1,0],to:[2,2,2]}],openings:[[1,1,0],[1,2,0]]};
test('Accept a single fenced JSON response while rejecting extra text and code',()=>{
  assert.deepEqual(parseModelJson('```json\n{"goal":"house"}\n```'),{goal:'house'});
  assert.throws(()=>parseModelJson('text {"goal":"house"}'));
  assert.throws(()=>parseModelJson('```js\nprocess.exit()\n```'));
});
test('Model cuboids expand to a supported closed shell with a two-block entrance',()=>{
  const blueprint=compileBlueprint(plan,sites);assert.equal(blueprint.cells.length,32);
  assert(blueprint.cells.some(q=>q.x===11&&q.y===73&&q.z===21));
  assert(!blueprint.cells.some(q=>q.x===11&&q.y===71&&q.z===20));
});
test('Reject an unobserved build site, out-of-bounds coordinates and missing roof',()=>{
  assert.throws(()=>compileBlueprint({...plan,site_id:'invented'},sites),/invalid_blueprint/);
  assert.throws(()=>compileBlueprint({...plan,cuboids:[{from:[0,0,0],to:[20,0,20]}]},sites),/bounds/);
  assert.throws(()=>compileBlueprint({...plan,cuboids:plan.cuboids.filter((_,i)=>i!==1)},sites),/incomplete_house/);
});
test('Reject blocked room interiors and corner or noncontiguous entrances',()=>{
  assert.throws(()=>compileBlueprint({...plan,cuboids:[...plan.cuboids,{from:[1,1,1],to:[1,2,1]}]},sites),/incomplete_house/);
  assert.throws(()=>compileBlueprint({...plan,openings:[[0,1,0],[0,2,0]]},sites),/invalid_entrance/);
});
test('Mixed materials use later cuboid overrides and optional raised roof detail',()=>{
  const mixed=compileBlueprint({...plan,material:'oak_planks',cuboids:[...plan.cuboids,
    {from:[0,0,0],to:[2,0,2],material:'cobblestone'},
    {from:[0,1,0],to:[0,2,0],material:'oak_log'},
    {from:[0,4,1],to:[2,4,1],material:'oak_wood'}]},sites);
  assert.equal(mixed.cells.length,35);
  assert.equal(mixed.cells.find(q=>q.x===10&&q.y===70&&q.z===20).material,'cobblestone');
  assert.equal(mixed.cells.find(q=>q.x===10&&q.y===71&&q.z===20).material,'oak_log');
  assert.throws(()=>compileBlueprint({...plan,cuboids:[...plan.cuboids,{from:[0,4,0],to:[0,4,0],material:'command_block'}]},sites),/material/);
});
test('Construction verification rejects a correct shape with the wrong material',()=>{
  const blueprint=compileBlueprint({...plan,material:'oak_planks',cuboids:[...plan.cuboids,{from:[0,0,0],to:[2,0,2],material:'cobblestone'}]},sites);
  const blocks=new Map(blueprint.cells.map(q=>[`${q.x}:${q.y}:${q.z}`,q.material]));
  const bot={entity:{position:new Vec3(0,0,0)},blockAt:q=>({name:blocks.get(`${q.x}:${q.y}:${q.z}`)??'air',boundingBox:blocks.has(`${q.x}:${q.y}:${q.z}`)?'block':'empty'})};
  assert.equal(inspectConstruction(bot,blueprint).complete,true);
  blocks.set('10:70:20','oak_planks');
  assert.equal(inspectConstruction(bot,blueprint).matched_blocks,31);
  assert.equal(inspectConstruction(bot,blueprint).complete,false);
});
