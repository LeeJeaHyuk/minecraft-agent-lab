import {setTimeout as delay} from 'node:timers/promises';
import pathfinderModule from 'mineflayer-pathfinder';
const {goals}=pathfinderModule;
export const hostileNames=new Set(['zombie','husk','drowned','skeleton','stray','bogged','spider','cave_spider','creeper','witch','phantom','slime','magma_cube','endermite','silverfish','pillager','vindicator','ravager','zoglin','hoglin']);
export function shouldWakeForDamage(state,seen=0,now=Date.now()){
  return state.connected&&!state.dead&&!state.goal&&!state.current_action&&state.last_damage?.time>seen&&now-state.last_damage.time<10000;
}
export function combatActions(bot){
  return Object.values(bot.entities).filter(e=>hostileNames.has(e.name)&&e.name!=='creeper'&&e.position.distanceTo(bot.entity.position)<=3)
    .map(e=>({id:`defend:${e.id}`,skill:'attack_entity',arguments:{entity_id:e.id,mob:e.name}}));
}
export function visibleThreats(bot,radius=10){
  return Object.values(bot?.entities??{}).filter(e=>{
    if(!hostileNames.has(e.name)||e.position.distanceTo(bot.entity.position)>radius)return false;
    const eye=bot.entity.position.offset(0,1.62,0),delta=e.position.offset(0,1,0).minus(eye),distance=delta.norm();
    const hit=bot.world.raycast(eye,delta.scaled(1/Math.max(distance,.01)),distance);
    return !hit;
  }).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position));
}
export function safetyActions(bot,threats,home){
  const unsafe=bot.health<=8||threats.some(e=>e.name==='creeper');
  const actions=unsafe?[]:threats.filter(e=>e.name!=='creeper').slice(0,3).map(e=>({id:`defend:${e.id}`,skill:'attack_entity',arguments:{entity_id:e.id,mob:e.name}}));
  if(home)actions.push({id:'safety:home',skill:'return_home',arguments:{}});
  if(unsafe||!home)actions.push({id:'safety:retreat',skill:'retreat_threat',arguments:{entity_id:threats[0].id}});
  return actions;
}
export async function retreatThreat(bot,candidate,assertActive){
  const e=bot.entities[candidate.arguments.entity_id];if(!e)return;
  const delta=bot.entity.position.minus(e.position),length=Math.hypot(delta.x,delta.z)||1;
  const goal=new goals.GoalNearXZ(bot.entity.position.x+delta.x/length*10,bot.entity.position.z+delta.z/length*10,2);
  bot.deactivateItem();await bot.pathfinder.goto(goal);assertActive();
}
export async function executeCombat(bot,candidate,assertActive){
  const target=bot.entities[candidate.arguments.entity_id];if(!target||!hostileNames.has(target.name)||target.name==='creeper')throw new Error('invalid_hostile_target');
  const items=bot.inventory.items(),rank=name=>['wooden','golden','stone','iron','diamond','netherite'].indexOf(name.split('_')[0]);
  const best=suffix=>items.filter(i=>i.name.endsWith(suffix)).sort((a,b)=>rank(b.name)-rank(a.name))[0];
  const weapon=best('_sword')??best('_axe')??best('_pickaxe');
  if(weapon)await bot.equip(weapon,'hand');assertActive();let attacks=0;
  const shield=bot.inventory.slots[45]?.name==='shield';
  if(target.position.distanceTo(bot.entity.position)>3){
    if(shield)bot.activateItem(true);
    await bot.pathfinder.goto(new goals.GoalNear(target.position.x,target.position.y,target.position.z,2));assertActive();
  }
  try{
  for(let i=0;i<3;i++){
    assertActive();const entity=bot.entities[target.id];if(!entity||entity.position.distanceTo(bot.entity.position)>3)break;
    await bot.lookAt(entity.position.offset(0,1,0),true);assertActive();bot.deactivateItem();bot.attack(entity);attacks++;
    if(shield)bot.activateItem(true);await delay(700);
  }
  }finally{bot.deactivateItem();}
  return {skill:'attack_entity',entity_id:target.id,mob:target.name,attacks,target_present:!!bot.entities[target.id],health:bot.health};
}
