import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {MinecraftEnvironment} from '../environment/adapter.mjs';
import {safetyActions} from '../environment/combat.mjs';
test('low health and creepers exclude melee and retain retreat',()=>{
  const entity={id:1,name:'zombie'},bot={health:8};
  assert.equal(safetyActions(bot,[entity],null).some(a=>a.skill==='attack_entity'),false);
  assert.equal(safetyActions({...bot,health:20},[{...entity,name:'creeper'}],null)[0].skill,'retreat_threat');
  assert.equal(safetyActions({...bot,health:20},[entity],null)[0].skill,'attack_entity');
});
test('active task interrupts, defeats hostile, keeps goal and resumes original action',async()=>{
  const env=new MinecraftEnvironment(),target={id:1,name:'zombie',position:new Vec3(1,0,0)};
  let attacks=0,equipped=null;
  env.bot={health:20,food:20,entity:{position:new Vec3(0,0,0)},entities:{},world:{raycast:()=>null},inventory:{slots:{45:{name:'shield'}},items:()=>[{name:'iron_sword'}]},pathfinder:{setGoal(){},stop(){}},stopDigging(){},clearControlStates(){},activateItem(){},deactivateItem(){},lookAt:async()=>{},equip:async item=>{equipped=item.name;},attack:()=>{attacks++;delete env.bot.entities[1];},chat(){}};
  env.ready=true;env.goal='collect wood';env.actions=()=>[{id:'wait',skill:'wait',arguments:{duration_ms:200}}];
  env.safetyLog=async()=>{};
  env.safetyPolicy={decide:async(_state,allowed)=>({action:allowed[0].id})};
  const pending=env.act('wait');
  await new Promise(resolve=>setTimeout(resolve,20));env.bot.entities[1]=target;env.interruptAction();
  const result=await pending;
  assert.equal(result.status,'success');assert.equal(result.result.skill,'wait');assert.equal(env.goal,'collect wood');
  assert.equal(attacks,1);assert.equal(equipped,'iron_sword');assert.equal(env.current,null);assert.equal(env.actionOwner,null);
  assert.ok(result.result.safety.some(e=>e.type==='safety_clear'));
  assert.ok(result.result.safety.some(e=>e.type==='task_resumed'));
});
