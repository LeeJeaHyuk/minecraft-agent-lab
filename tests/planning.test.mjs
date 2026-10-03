import test from 'node:test';
import {Vec3} from 'vec3';
import assert from 'node:assert/strict';
import {validateTaskPlan} from '../planners/qwen.mjs';
import {TaskPlanner,stepActions,stepComplete} from '../planners/task-runner.mjs';
import {executeExtra,resourceBlocks} from '../environment/skills.mjs';
const steps=[{subgoal:'Gather wood',method:'collect',item:'oak_log',count:1},{subgoal:'Make planks',method:'craft',item:'oak_planks',count:4}];
test('iron scanning retains a loaded deep vein after the agent returns to the surface',()=>{
 const ore={name:'iron_ore',id:1,diggable:true,drops:[2]},p=new Vec3(1,40,1);
 const bot={entity:{position:new Vec3(0,72,0)},registry:{blocksByName:{iron_ore:ore},blocksByStateId:{}},world:{getColumn:()=>null},game:{minY:-64},findBlocks:()=>[p],blockAt:q=>({...ore,position:q}),pathfinder:{movements:{exclusionAreasBreak:[]}}};
 assert.equal(resourceBlocks(bot)[0].position.y,40);
});
test('Plans reject arbitrary methods, item syntax and unbounded counts',()=>{
  assert.equal(validateTaskPlan({goal:'test',steps}).steps.length,2);
  for(const patch of [{method:'eval'},{item:'../../code'},{count:0},{count:65}])assert.throws(()=>validateTaskPlan({goal:'test',steps:[{...steps[0],...patch}]}),/invalid_plan/);
});
test('Stage completion uses inventory and filters actions by the accepted target',()=>{
  assert.equal(stepComplete({inventory:[{name:'oak_log',count:1}]},steps[0]),true);
  assert.equal(stepComplete({inventory:[{name:'dirt',count:64}]},steps[0]),false);
  const actions=[{id:'a',skill:'mine_and_collect',arguments:{block:'oak_log'}},{id:'b',skill:'mine_and_collect',arguments:{block:'dirt'}},
    {id:'c',skill:'craft_item',arguments:{item:'oak_planks'}},{id:'d',skill:'wait',arguments:{}}];
  assert.deepEqual(stepActions(actions,steps[0]).map(a=>a.id),['a']);assert.deepEqual(stepActions(actions,steps[1]).map(a=>a.id),['c']);
});
test('Asynchronous plans from an old milestone are discarded without blocking actions',async()=>{
  let finish;const events=[],manager=new TaskPlanner({taskPlan:()=>new Promise(r=>{finish=r;})},{onEvent:t=>events.push(t)});
  const pending=manager.refresh({}, {},true);assert(manager.pending);manager.advance();finish({goal:'test',steps});
  assert.equal(await pending,null);assert.equal(manager.latest,undefined);assert.deepEqual(events,['planner_request','planner_discarded']);
});
test('Refresh cannot change accepted completion targets',async()=>{
  const events=[],manager=new TaskPlanner({taskPlan:async()=>({goal:'test',steps:[{...steps[0],count:2}]})},{onEvent:(type,data)=>events.push({type,data})});
  assert.equal(await manager.refresh({}, {accepted_steps:[steps[0]]},true),null);
  assert.equal(events.find(e=>e.type==='planner_error').data.error,'planner_changed_completion_contract');
});
test('A drop collected during digging does not cause a second unreachable path attempt',async()=>{
  let items=[],moves=0;
  const p={x:0,y:64,z:0,clone(){return this;},set(){return this;}};
  const bot={inventory:{items:()=>items},entity:{position:p},entities:{},registry:{blocksByName:{oak_log:{drops:[1]}},items:{1:{name:'oak_log'}}},
    pathfinder:{movements:{canDig:false},goto:async()=>{moves++;if(moves>1)throw new Error('unreachable');},bestHarvestTool:()=>null},
    blockAt:()=>({name:'oak_log'}),canDigBlock:()=>moves>0,dig:async()=>{items=[{name:'oak_log',count:1}];}};
  const result=await executeExtra(bot,{skill:'mine_and_collect',arguments:{block:'oak_log',x:0,y:64,z:0}},()=>{});
  assert.equal(moves,1);assert.equal(result.inventory_delta.oak_log,1);assert.equal(bot.pathfinder.movements.canDig,false);
});
test('Craft success requires the observed output increase',async()=>{
  let items=[{name:'oak_log',count:1}];
  const bot={inventory:{items:()=>items},registry:{blocksByName:{crafting_table:{id:1}},itemsByName:{oak_planks:{id:2}}},findBlock:()=>null,
    recipesFor:()=>[{result:{count:4},requiresTable:false}],craft:async()=>{items=[{name:'oak_planks',count:4}];}};
  const result=await executeExtra(bot,{skill:'craft_item',arguments:{item:'oak_planks',count:1}},()=>{});assert.equal(result.inventory_delta.oak_planks,4);
  bot.craft=async()=>{};await assert.rejects(executeExtra(bot,{skill:'craft_item',arguments:{item:'oak_planks',count:1}},()=>{}),/craft_not_confirmed/);
});
test('Quarry pickup can access a lower untyped item and restores movement permissions',async()=>{
  let items=[{name:'wooden_pickaxe',count:1}],fail=false;
  const bot={inventory:{items:()=>items},entity:{position:new Vec3(0,70,0)},
    entities:{1:{name:'item',position:new Vec3(1,68,0)}},
    registry:{blocksByName:{stone:{drops:[35]}},items:{35:{name:'cobblestone'}}},
    blockAt:()=>({name:'stone'}),canDigBlock:()=>true,dig:async()=>{},
    pathfinder:{movements:{canDig:false},bestHarvestTool:()=>null,goto:async()=>{
      assert.equal(bot.pathfinder.movements.canDig,true);if(fail)throw new Error('No path');
      items=[{name:'wooden_pickaxe',count:1},{name:'cobblestone',count:1}];
    }}};
  const action={skill:'mine_and_collect',arguments:{block:'stone',x:1,y:68,z:0}};
  assert.equal((await executeExtra(bot,action,()=>{})).inventory_delta.cobblestone,1);
  assert.equal(bot.pathfinder.movements.canDig,false);
  items=[{name:'wooden_pickaxe',count:1}];fail=true;
  await assert.rejects(executeExtra(bot,action,()=>{}),/No path/);
  assert.equal(bot.pathfinder.movements.canDig,false);
});
test('coal and raw iron drop pickup can excavate access and always restores permission',async()=>{
 for(const name of ['coal','raw_iron']){
  let items=[{name:'stone_pickaxe',count:1}];const bot={inventory:{items:()=>items},entity:{position:new Vec3(0,70,0)},entities:{1:{name:'item',position:new Vec3(1,70,0)}},pathfinder:{movements:{canDig:false},goto:async()=>{assert.equal(bot.pathfinder.movements.canDig,true);items.push({name,count:1});}}};
  assert.equal((await executeExtra(bot,{skill:'collect_item',arguments:{entity_id:1,item:name}},()=>{})).inventory_delta[name],1);assert.equal(bot.pathfinder.movements.canDig,false);
 }
});
test('resource approach rejects pathfinder resolution without arrival and restores digging',async()=>{
 const bot={inventory:{items:()=>[{name:'stone_pickaxe',count:1}]},entity:{position:new Vec3(0,70,0)},pathfinder:{movements:{canDig:false},goto:async()=>{}}};
 await assert.rejects(executeExtra(bot,{skill:'approach_resource',arguments:{block:'coal_ore',x:20,y:70,z:0}},()=>{}),/navigation_not_confirmed/);assert.equal(bot.pathfinder.movements.canDig,false);
});
test('mineral approach requires a side position instead of stopping directly above the ore',async()=>{
 const bot={inventory:{items:()=>[{name:'stone_pickaxe',count:1}]},entity:{position:new Vec3(20,72,0)},pathfinder:{movements:{canDig:false},goto:async()=>{}}};
 const action={skill:'approach_resource',arguments:{block:'iron_ore',x:20,y:70,z:0}};
 await assert.rejects(executeExtra(bot,action,()=>{}),/navigation_not_confirmed/);
 bot.pathfinder.goto=async()=>{bot.entity.position=new Vec3(19,71,0);};await executeExtra(bot,action,()=>{});assert.equal(bot.pathfinder.movements.canDig,false);
});
