import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {foodActions,executeFood,completedHuntAfterDefense} from '../environment/food.mjs';
test('food hunting excludes players and hostile mobs and orders nearby food animals',()=>{
 const bot={food:20,inventory:{items:()=>[]},entity:{position:new Vec3(0,64,0)},entities:{1:{id:1,name:'player',position:new Vec3(1,64,0)},2:{id:2,name:'zombie',position:new Vec3(2,64,0)},3:{id:3,name:'pig',position:new Vec3(8,64,0)},4:{id:4,name:'cow',position:new Vec3(4,64,0)}}};
 assert.deepEqual(foodActions(bot).map(a=>a.arguments.entity_id),[4,3]);
});
test('interrupted hunt is complete only when the original animal is gone and its food was obtained',()=>{
 const candidate={skill:'hunt_food',arguments:{entity_id:1,mob:'pig'}};let count=1;
 const bot={entities:{},inventory:{items:()=>[{name:'porkchop',count}]}};
 assert.equal(completedHuntAfterDefense(bot,candidate,{}).completion_verified_after_defense,true);
 assert.equal(completedHuntAfterDefense(bot,candidate,{porkchop:1}),null);
 bot.entities[1]={};assert.equal(completedHuntAfterDefense(bot,candidate,{}),null);
});
test('late consume completion succeeds only with actual inventory loss and food gain',async()=>{
 let count=1;const bot={food:11,inventory:{items:()=>count?[{name:'porkchop',count}]:[]},equip:async()=>{},consume:async()=>{count--;bot.food=14;throw Error('Promise timed out.');}};
 const r=await executeFood(bot,{skill:'eat_food',arguments:{item:'porkchop'}},()=>{});
 assert.equal(r.verified_by_inventory_and_food,true);assert.equal(r.food_after,14);
});
test('eating requires actual food consumption and rejects phantom success',async()=>{
 let count=2;const bot={food:14,inventory:{items:()=>[{name:'porkchop',count}]},equip:async()=>{},consume:async()=>{}};
 const action={skill:'eat_food',arguments:{item:'porkchop'}};
 await assert.rejects(executeFood(bot,action,()=>{}),/food_not_consumed/);
 bot.consume=async()=>{count--;bot.food+=3;};const r=await executeFood(bot,action,()=>{});assert.equal(r.food_after,17);
});
