import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {homeFromBuilding,inspectHome,homeActions,allowOpenDoorPassage,correctOpenDoorWaypoints,executeHome} from '../environment/home.mjs';
import {MinecraftEnvironment} from '../environment/adapter.mjs';
const home=homeFromBuilding({site:{size:4,origin:{x:13,y:71,z:232}},openings:[[1,1,0],[1,2,0]]});
test('torch support repair requires confirmed placement at the missing support',async()=>{
 const q=new Vec3(17,71,234);let placed=false;const bot={inventory:{items:()=>[{name:'cobblestone',count:1}]},equip:async()=>{},placeBlock:async()=>{},blockAt:p=>({position:p,name:p.equals(q)?placed?'cobblestone':'air':'cobblestone',boundingBox:p.equals(q)&&!placed?'empty':'block'})};
 const candidate={skill:'repair_light_support',arguments:{x:q.x,y:q.y,z:q.z}};
 await assert.rejects(executeHome(bot,candidate,home,()=>{}),/light_support_not_confirmed/);bot.placeBlock=async()=>{placed=true;};await executeHome(bot,candidate,home,()=>{});
});
test('safe idle requires an intact room, artificial light and an entrance door',()=>{
  let lit=0,roof=true,door=true,torch=false;
  const bot={entity:{position:new Vec3(14.5,72,234.5)},inventory:{items:()=>[]},world:{getBlockLight:()=>lit},blockAt:p=>{
    if(p.equals(new Vec3(14,72,232)))return {name:door?'oak_door':'air',getProperties:()=>({open:false})};
    if(p.equals(new Vec3(15,72,234)))return {name:torch?'torch':'air',boundingBox:'empty'};
    return {name:'air',boundingBox:p.y===71||p.y===74&&roof?'block':'empty'};
  }};
  assert.equal(inspectHome(bot,home).ready,false);
  assert.ok(!homeActions(bot,home).some(a=>a.skill==='return_home'));
  lit=12;assert.equal(inspectHome(bot,home).ready,true);assert.equal(inspectHome(bot,home).at_home,true);
  lit=0;torch=true;assert.equal(inspectHome(bot,home).ready,true);assert.equal(inspectHome(bot,home).lighting_verification,'placed_interior_torch');
  roof=false;assert.equal(inspectHome(bot,home).ready,false);roof=true;door=false;assert.equal(inspectHome(bot,home).ready,false);
});
test('unsupported house entrances cannot silently become a safe waiting point',()=>{
  assert.throws(()=>homeFromBuilding({site:{size:3},openings:[]}),/four_block_house/);
  assert.throws(()=>homeFromBuilding({site:{size:4,origin:{}},openings:[[0,1,1]]}),/front_entry/);
});
test('a resolved pathfinder promise cannot report success without arrival',async()=>{
  const env=new MinecraftEnvironment();env.ready=true;env.actions=()=>[{id:'move:test',skill:'move_to',arguments:{x:2,y:0,z:0}}];
  env.bot={entity:{position:new Vec3(0,0,0)},pathfinder:{goto:async()=>{},setGoal(){}},clearControlStates(){}};
  const result=await env.act('move:test');assert.equal(result.status,'failure');assert.equal(result.error_details,'navigation_not_confirmed');
});
test('only open door blocks become passable to the pathfinder',()=>{
  let name='oak_door',open=false;
  const movement={getBlock:()=>({name,safe:false,physical:true,openable:false,getProperties:()=>({open})})};allowOpenDoorPassage(movement);
  assert.equal(movement.getBlock().safe,false);open=true;assert.equal(movement.getBlock().safe,true);assert.equal(movement.getBlock().physical,false);
  name='oak_planks';assert.equal(movement.getBlock().safe,false);
});
test('path postprocessing walks through an open doorway instead of jumping onto its panel',()=>{
  const bot={blockAt:p=>({name:'oak_door',position:p,getProperties:()=>({open:true,half:p.y===73?'upper':'lower'})})},path=[{x:14.296875,y:73,z:232.5}];
  correctOpenDoorWaypoints(bot,path);assert.deepEqual(path,[{x:14.5,y:72,z:232.5}]);correctOpenDoorWaypoints(bot,path);assert.deepEqual(path,[{x:14.5,y:72,z:232.5}]);
});
