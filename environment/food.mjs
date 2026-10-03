import pathfinderModule from 'mineflayer-pathfinder';
import {setTimeout as delay} from 'node:timers/promises';
import {inventoryCounts} from './skills.mjs';
const animals=new Set(['cow','pig','sheep','chicken']);
const foods=new Set(['beef','porkchop','mutton','chicken','cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','apple','bread']);
export function completedHuntAfterDefense(bot,candidate,before){
  const expected={pig:'porkchop',cow:'beef',sheep:'mutton',chicken:'chicken'}[candidate?.arguments.mob];
  const after=inventoryCounts(bot);
  if(candidate?.skill!=='hunt_food'||!expected||bot.entities[candidate.arguments.entity_id]||(after[expected]??0)<=(before[expected]??0))return null;
  return {skill:'hunt_food',mob:candidate.arguments.mob,inventory_before:before,inventory_after:after,completion_verified_after_defense:true};
}
export function foodActions(bot){
  const out=bot.food<20?bot.inventory.items().filter(i=>foods.has(i.name)).map(i=>({id:`eat:${i.name}`,skill:'eat_food',arguments:{item:i.name}})):[];
  for(const e of Object.values(bot.entities).filter(e=>animals.has(e.name)&&e.position.distanceTo(bot.entity.position)<=48).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position)).slice(0,4))out.push({id:`hunt:${e.id}`,skill:'hunt_food',arguments:{entity_id:e.id,mob:e.name,x:e.position.x,y:e.position.y,z:e.position.z}});
  return out;
}
export async function executeFood(bot,candidate,assertActive){
  if(candidate.skill==='eat_food'){
    const item=bot.inventory.items().find(i=>i.name===candidate.arguments.item);if(!item||!foods.has(item.name))throw new Error('inventory_missing');
    const before=inventoryCounts(bot),food=bot.food;bot.deactivateItem?.();await bot.equip(item,'hand');assertActive();
    let transportError;try{await bot.consume();}catch(error){transportError=error;}assertActive();
    for(let i=0;i<25&&((inventoryCounts(bot)[item.name]??0)!==before[item.name]-1||bot.food<=food);i++){await delay(100);assertActive();}
    bot.deactivateItem?.();
    if((inventoryCounts(bot)[item.name]??0)!==before[item.name]-1||bot.food<=food)throw transportError??new Error('food_not_consumed');
    return {skill:'eat_food',item:item.name,food_before:food,food_after:bot.food,...(transportError?{consume_event_error:transportError.message,verified_by_inventory_and_food:true}: {})};
  }
  const target=bot.entities[candidate.arguments.entity_id];if(!target||!animals.has(target.name))throw new Error('invalid_food_target');
  const weapon=bot.inventory.items().find(i=>i.name==='iron_sword')??bot.inventory.items().find(i=>i.name==='stone_sword');if(!weapon)throw new Error('inventory_missing');await bot.equip(weapon,'hand');
  const before=inventoryCounts(bot);let last=target.position.clone();
  for(let i=0;i<6;i++){
    assertActive();const e=bot.entities[target.id];if(!e)break;last=e.position.clone();
    if(e.position.distanceTo(bot.entity.position)>12)await bot.pathfinder.goto(new pathfinderModule.goals.GoalNearXZ(last.x,last.z,6));assertActive();
    await bot.pathfinder.goto(new pathfinderModule.goals.GoalNear(last.x,last.y,last.z,2));assertActive();
    if(e.position.distanceTo(bot.entity.position)>3)continue;await bot.lookAt(e.position.offset(0,.6,0),true);bot.attack(e);await delay(750);
  }
  if(bot.entities[target.id])throw new Error('hunt_not_completed');await delay(700);
  await bot.pathfinder.goto(new pathfinderModule.goals.GoalNear(last.x,last.y,last.z,0));assertActive();await delay(700);
  const after=inventoryCounts(bot);if(![...foods].some(name=>(after[name]??0)>(before[name]??0)))throw new Error('food_pickup_not_confirmed');
  return {skill:'hunt_food',mob:target.name,inventory_before:before,inventory_after:after};
}
