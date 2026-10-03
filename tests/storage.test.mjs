import test from 'node:test';
import assert from 'node:assert/strict';
import {depositCount,executeStorage} from '../environment/storage.mjs';
import {Vec3} from 'vec3';
test('storage keeps reserved inventory and deposits only the excess',()=>{
  assert.equal(depositCount({oak_planks:23},{oak_planks:8},'oak_planks'),15);
  assert.equal(depositCount({wooden_pickaxe:1},{wooden_pickaxe:1},'wooden_pickaxe'),0);
  assert.equal(depositCount({dirt:7},{},'dirt'),7);
  assert.equal(depositCount({stick:1},{stick:2},'stick'),0);
});
test('deposit verifies active container inventory rather than stale player window',async()=>{
  let held=7,stored=0,closed=false;
  const chest={items:()=>held?[{name:'dirt',count:held}]:[],containerItems:()=>stored?[{name:'dirt',count:stored,slot:0}]:[],deposit:async()=>{held=0;stored=7;},close:()=>{closed=true;}};
  const bot={entity:{position:new Vec3(0,0,0)},registry:{itemsByName:{dirt:{id:1}}},inventory:{items:()=>[{name:'dirt',count:7}]},blockAt:()=>({name:'chest'}),canSeeBlock:()=>true,openContainer:async()=>chest};
  const result=await executeStorage(bot,{skill:'deposit_item',arguments:{x:1,y:0,z:0,item:'dirt',count:7}},()=>{});
  assert.equal(result.chest_inventory.dirt,7);assert.equal(result.inventory.dirt,undefined);assert.ok(closed);
});
test('withdraw verifies both container and held inventory, and closes on insufficient stock',async()=>{
  let held=0,stored=1,closed=false;
  const chest={items:()=>held?[{name:'coal',count:held}]:[],containerItems:()=>stored?[{name:'coal',count:stored,slot:0}]:[],withdraw:async()=>{held=1;stored=0;},close:()=>{closed=true;}};
  const bot={entity:{position:new Vec3(0,0,0)},registry:{itemsByName:{coal:{id:1}}},blockAt:()=>({name:'chest'}),canSeeBlock:()=>true,openContainer:async()=>chest};
  const candidate={skill:'withdraw_item',arguments:{x:1,y:0,z:0,item:'coal',count:1}};
  const result=await executeStorage(bot,candidate,()=>{});assert.equal(result.inventory.coal,1);assert.equal(result.chest_inventory.coal,undefined);assert.ok(closed);
  closed=false;await assert.rejects(executeStorage(bot,candidate,()=>{}),/chest_material_missing/);assert.ok(closed);
});
