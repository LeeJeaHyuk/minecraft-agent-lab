import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldWakeForDamage,combatActions,executeCombat} from '../environment/combat.mjs';
test('damage wakes only idle living connected agents, once and while recent',()=>{
  const state={connected:true,dead:false,goal:null,current_action:null,last_damage:{time:1000}};
  assert.equal(shouldWakeForDamage(state,0,1500),true);
  for(const changed of [{goal:'build'},{current_action:'move'},{dead:true},{connected:false}])assert.equal(shouldWakeForDamage({...state,...changed},0,1500),false);
  assert.equal(shouldWakeForDamage(state,1000,1500),false);
  assert.equal(shouldWakeForDamage(state,0,12000),false);
});
test('combat excludes players, passive mobs, creepers and distant targets',async()=>{
  const entity=(name,d)=>({name,id:d,position:{distanceTo:()=>d}});
  const bot={entity:{position:{}},entities:{1:entity('zombie',1),2:entity('player',2),3:entity('creeper',3),4:entity('skeleton',4),5:entity('cow',2)}};
  assert.deepEqual(combatActions(bot).map(a=>a.arguments.mob),['zombie']);
  await assert.rejects(executeCombat(bot,{arguments:{entity_id:3}},()=>{}),/invalid_hostile_target/);
});
