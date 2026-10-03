import {Vec3} from 'vec3';
import {setTimeout as delay} from 'node:timers/promises';
import {inventoryCounts} from './skills.mjs';
const slots={head:5,torso:6,legs:7,feet:8,'off-hand':45};
export function equipment(bot){return {...Object.fromEntries(Object.entries(slots).map(([name,slot])=>[name,bot.inventory.slots?.[slot]?.name??null])),hand:bot.heldItem?.name??null};}
export function equipmentActions(bot,home){
  const counts=inventoryCounts(bot),out=[];
  for(const [suffix,destination] of [['_helmet','head'],['_chestplate','torso'],['_leggings','legs'],['_boots','feet'],['shield','off-hand']])
    for(const item of bot.inventory.items().filter(i=>suffix==='shield'?i.name==='shield':i.name.endsWith(suffix)))if(equipment(bot)[destination]!==item.name)out.push({id:`equip:${item.name}`,skill:'equip_gear',arguments:{item:item.name,destination}});
  const rank=name=>['wooden','golden','stone','iron','diamond','netherite'].indexOf(name.split('_')[0]);
  const sword=bot.inventory.items().filter(i=>i.name.endsWith('_sword')).sort((a,b)=>rank(b.name)-rank(a.name))[0];
  if(sword&&bot.heldItem?.name!==sword.name)out.push({id:`equip:${sword.name}`,skill:'equip_gear',arguments:{item:sword.name,destination:'hand'}});
  const p=bot.entity.position.floored();
  if(counts.furnace){for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){const q=p.offset(dx,0,dz);if(q.distanceTo(bot.entity.position)>4.5||q.distanceTo(bot.entity.position)<1.5)continue;if(home&&q.x>=home.point.x-1&&q.x<=home.point.x+2&&q.z>=home.door.z-1&&q.z<=home.point.z+1)continue;if(bot.blockAt(q)?.name==='air'&&bot.blockAt(q.offset(0,-1,0))?.boundingBox==='block')out.push({id:`furnace:place:${q.x}:${q.y}:${q.z}`,skill:'place_furnace',arguments:{x:q.x,y:q.y,z:q.z}});}}
  const furnace=bot.findBlock({matching:bot.registry.blocksByName.furnace.id,maxDistance:4});
  if(furnace&&counts.raw_iron&&counts.coal)out.push({id:'smelt:iron',skill:'smelt_iron',arguments:{...furnace.position,count:Math.min(3,counts.raw_iron)}});
  if(furnace)out.push({id:'furnace:recover',skill:'recover_furnace',arguments:{...furnace.position}});
  return out;
}
export async function executeEquipment(bot,candidate,assertActive){
  const a=candidate.arguments;
  if(candidate.skill==='equip_gear'){
    const item=bot.inventory.items().find(i=>i.name===a.item);if(!item)throw new Error('inventory_missing');await bot.equip(item,a.destination);assertActive();
    if(equipment(bot)[a.destination]!==a.item)throw new Error('equipment_not_confirmed');return {skill:candidate.skill,equipment:equipment(bot)};
  }
  const p=new Vec3(a.x,a.y,a.z);
  if(candidate.skill==='place_furnace'){
    const item=bot.inventory.items().find(i=>i.name==='furnace');if(!item||bot.blockAt(p)?.name!=='air')throw new Error('invalid_furnace_site');
    await bot.equip(item,'hand');assertActive();await bot.placeBlock(bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));assertActive();if(bot.blockAt(p)?.name!=='furnace')throw new Error('furnace_not_confirmed');return {skill:candidate.skill,position:a};
  }
  const furnace=await bot.openFurnace(bot.blockAt(p));
  try{
    await delay(250);assertActive();
    const before=inventoryCounts({inventory:furnace});
    if(candidate.skill==='smelt_iron'){
      if(furnace.inputItem()||furnace.outputItem())throw new Error('furnace_requires_recovery');
      await furnace.putInput(bot.registry.itemsByName.raw_iron.id,null,a.count);assertActive();
      if(!furnace.fuelItem()&&!furnace.fuel)await furnace.putFuel(bot.registry.itemsByName.coal.id,null,1);
      const deadline=Date.now()+38000;
      while((furnace.outputItem()?.count??0)<a.count){assertActive();if(Date.now()>deadline)throw new Error('smelting_timeout');await delay(250);}
      if(furnace.outputItem().name!=='iron_ingot')throw new Error('unexpected_smelt_output');await furnace.takeOutput();assertActive();
      const after=inventoryCounts({inventory:furnace});if((after.iron_ingot??0)!==(before.iron_ingot??0)+a.count)throw new Error('smelt_not_confirmed');
      return {skill:candidate.skill,iron_ingots:a.count,inventory:after};
    }
    if(furnace.outputItem())await furnace.takeOutput();assertActive();if(furnace.inputItem())await furnace.takeInput();assertActive();
    return {skill:candidate.skill,inventory:inventoryCounts({inventory:furnace})};
  }finally{furnace.close();}
}
