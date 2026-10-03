import pathfinderModule from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';
import {setTimeout as delay} from 'node:timers/promises';
const point=p=>({x:p.x,y:p.y,z:p.z}),vec=p=>new Vec3(p.x,p.y,p.z);
export function allowOpenDoorPassage(movement){
  const getBlock=movement.getBlock.bind(movement);
  movement.getBlock=(...args)=>{
    const block=getBlock(...args);
    if(block.name?.endsWith('_door')&&block.getProperties?.().open===true){block.safe=true;block.physical=false;block.openable=false;block.height=block.position?.y??block.height;}
    return block;
  };
}
export function correctOpenDoorWaypoints(bot,path){
  for(const node of path){
    const block=bot.blockAt(new Vec3(Math.floor(node.x),Math.floor(node.y),Math.floor(node.z))),properties=block?.getProperties?.();
    if(block?.name.endsWith('_door')&&properties.open===true){node.x=Math.floor(node.x)+.5;node.z=Math.floor(node.z)+.5;node.y=block.position.y-(properties.half==='upper'?1:0);}
  }
}
export function installDoorNavigation(bot){
  const getPathTo=bot.pathfinder.getPathTo.bind(bot.pathfinder);
  bot.pathfinder.getPathTo=(...args)=>{const result=getPathTo(...args);correctOpenDoorWaypoints(bot,result.path);return result;};
  bot.on('path_update',result=>correctOpenDoorWaypoints(bot,result.path));
}
export function homeFromBuilding(building){
  if(!building||building.site.size!==4)throw new Error('home_requires_four_block_house');
  const o=building.site.origin,at=(x,y,z)=>({x:o.x+x,y:o.y+y,z:o.z+z});
  const opening=building.openings.find(p=>p[1]===1);if(!opening||opening[2]!==0)throw new Error('home_requires_front_entry');
  return {point:at(1,1,2),door:at(opening[0],1,0),lights:[at(2,1,2),at(1,1,-2),at(4,1,2),at(4,1,-1)]};
}
export function inspectHome(bot,home){
  if(!home||!bot?.entity)return null;
  const q=vec(home.point),feet=bot.blockAt(q),head=bot.blockAt(q.offset(0,1,0)),floor=bot.blockAt(q.offset(0,-1,0)),roof=bot.blockAt(q.offset(0,2,0));
  const door=bot.blockAt(vec(home.door)),properties=door?.getProperties?.()??{};
  const light=bot.world.getBlockLight(q),roomClear=feet?.boundingBox==='empty'&&head?.boundingBox==='empty'&&floor?.boundingBox==='block'&&roof?.boundingBox==='block';
  const interiorTorch=home.lights[0]&&bot.blockAt(vec(home.lights[0]))?.name==='torch';
  return {...home,room_clear:roomClear,reported_block_light:light,interior_light_present:!!interiorTorch,lighting_verification:interiorTorch?'placed_interior_torch':light>0?'packet_light':'unlit',door_present:door?.name==='oak_door',door_open:properties.open===true,
    ready:roomClear&&(light>0||interiorTorch)&&door?.name==='oak_door',at_home:Math.hypot(bot.entity.position.x-q.x-.5,bot.entity.position.y-q.y,bot.entity.position.z-q.z-.5)<.8,
    lights:home.lights.map(p=>({...p,block:bot.blockAt(vec(p))?.name,block_light:bot.world.getBlockLight(vec(p))}))};
}
export function homeActions(bot,home){
  if(!home)return [];const out=[],items=bot.inventory.items(),distance=p=>vec(p).distanceTo(bot.entity.position);
  for(const p of home.lights){const q=vec(p);if(items.some(i=>i.name==='torch')&&distance(p)<4.5&&bot.blockAt(q)?.name==='air'&&bot.blockAt(q.offset(0,-1,0))?.boundingBox==='block')out.push({id:`home:torch:${p.x}:${p.y}:${p.z}`,skill:'place_torch',arguments:p});}
  for(const p of home.lights){const q=vec(p).offset(0,-1,0);if(items.some(i=>i.name==='cobblestone')&&q.distanceTo(bot.entity.position)<4.5&&bot.blockAt(q)?.name==='air'&&[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]].some(d=>bot.blockAt(q.offset(...d))?.boundingBox==='block'))out.push({id:`home:repair-support:${q.x}:${q.y}:${q.z}`,skill:'repair_light_support',arguments:point(q)});}
  const q=vec(home.door);
  if(items.some(i=>i.name==='oak_door')&&distance(home.door)<4.5&&bot.blockAt(q)?.name==='air'&&bot.blockAt(q.offset(0,1,0))?.name==='air')out.push({id:'home:door',skill:'place_door',arguments:home.door});
  const status=inspectHome(bot,home);
  if(status.room_clear&&distance(home.point)<64)out.push({id:'home:enter',skill:'enter_home',arguments:home.point});
  if(status.ready&&distance(home.point)<64)out.push({id:'home:return',skill:'return_home',arguments:home.point});
  return out;
}
export async function prepareHomeDeparture(bot,home,assertActive){
  const state=inspectHome(bot,home);
  if(state?.at_home&&state.door_present&&!state.door_open){await bot.activateBlock(bot.blockAt(vec(home.door)));await delay(200);assertActive();}
}
export async function executeHome(bot,candidate,home,assertActive){
  if(candidate.skill==='repair_light_support'){
    const q=vec(candidate.arguments),item=bot.inventory.items().find(i=>i.name==='cobblestone');if(!item||bot.blockAt(q)?.name!=='air')throw new Error('invalid_light_support');
    const ref=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]].map(d=>bot.blockAt(q.offset(...d))).find(b=>b?.boundingBox==='block');if(!ref)throw new Error('missing_light_support_reference');
    await bot.equip(item,'hand');assertActive();await bot.placeBlock(ref,q.minus(ref.position));await delay(200);assertActive();if(bot.blockAt(q)?.name!=='cobblestone')throw new Error('light_support_not_confirmed');return {skill:candidate.skill,position:point(q)};
  }
  if(['return_home','enter_home'].includes(candidate.skill)){
    if(candidate.skill==='return_home'&&!inspectHome(bot,home)?.ready)throw new Error('home_not_ready');
    const movement=bot.pathfinder.movements,oldDig=movement.canDig;
    if(bot.entity.position.y<home.point.y-2)movement.canDig=true;
    try{
    let door=bot.blockAt(vec(home.door));
    if(!inspectHome(bot,home).at_home&&door.name==='oak_door'&&!door.getProperties().open){
      if(door.position.distanceTo(bot.entity.position)>4)await bot.pathfinder.goto(new pathfinderModule.goals.GoalNear(home.door.x,home.door.y,home.door.z,2));
      assertActive();await bot.activateBlock(door);await delay(200);assertActive();
    }
    const p=home.point;await bot.pathfinder.goto(new pathfinderModule.goals.GoalBlock(p.x,p.y,p.z));assertActive();
    door=bot.blockAt(vec(home.door));if(door.name==='oak_door'&&door.getProperties().open){await bot.activateBlock(door);await delay(200);assertActive();}
    const result=inspectHome(bot,home);if(!result.at_home||result.door_open)throw new Error('home_return_not_confirmed');
    return {skill:candidate.skill,home:result};
    }finally{movement.canDig=oldDig;}
  }
  const q=vec(candidate.arguments),itemName=candidate.skill==='place_torch'?'torch':'oak_door';
  const item=bot.inventory.items().find(i=>i.name===itemName);if(!item)throw new Error('inventory_missing');
  if(bot.blockAt(q)?.name!=='air')throw new Error('home_site_occupied');
  await bot.equip(item,'hand');assertActive();await bot.placeBlock(bot.blockAt(q.offset(0,-1,0)),new Vec3(0,1,0));await delay(200);assertActive();
  if(bot.blockAt(q)?.name!==itemName)throw new Error('home_placement_not_confirmed');
  return {skill:candidate.skill,position:point(q),block:itemName};
}
