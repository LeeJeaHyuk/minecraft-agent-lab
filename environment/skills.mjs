import {setTimeout as delay} from 'node:timers/promises';
import pathfinderModule from 'mineflayer-pathfinder';
const {goals}=pathfinderModule;
const point=p=>({x:p.x,y:p.y,z:p.z});
export const inventoryCounts=bot=>Object.fromEntries(bot.inventory.items().map(i=>i.name).map(name=>[name,bot.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0)]));

// Each loaded block type gets a representative; common ground does not hide trees.
const resourceCache=new WeakMap();
export function resourceBlocks(bot){
  if(!bot.findBlocks || !bot.registry)return [];
  const origin=bot.entity.position.floored(),key=origin.toString(),cached=resourceCache.get(bot);
  if(cached?.key===key&&Date.now()-cached.time<1000&&cached.blocks.every(b=>bot.blockAt(origin.clone().set(b.position.x,b.position.y,b.position.z))?.name===b.name))return cached.blocks;
  const out=[];
  const present=new Map();
  for(const name of ['iron_ore','deepslate_iron_ore']){const definition=bot.registry.blocksByName[name];if(definition)present.set(definition.id,definition);}
  for(let x=(origin.x-48)>>4;x<=(origin.x+48)>>4;x++)for(let z=(origin.z-48)>>4;z<=(origin.z+48)>>4;z++){
    const column=bot.world.getColumn(x,z);if(!column)continue;
    for(let y=(origin.y-12)>>4;y<=(origin.y+12)>>4;y++)for(const stateId of column.sections[y-(bot.game.minY>>4)]?.palette??[]){
      const definition=bot.registry.blocksByStateId[stateId];if(definition)present.set(definition.id,definition);
    }
  }
  for(const definition of present.values()){
    if(!definition.diggable || !definition.drops?.length)continue;
    const positions=bot.findBlocks({matching:definition.id,maxDistance:48,count:/_log$/.test(definition.name)?128:32})
      .filter(p=>!(bot.pathfinder?.movements?.exclusionAreasBreak??[]).some(fn=>fn(bot.blockAt(p))>=100))
      .sort((a,b)=>Math.max(0,a.y-origin.y-2)*12+a.distanceTo(origin)-(Math.max(0,b.y-origin.y-2)*12+b.distanceTo(origin)));
    if(!positions.length)continue;
    const block=bot.blockAt(positions[0]);
    const verticalRange=['iron_ore','deepslate_iron_ore'].includes(definition.name)?48:12;
    if(!block || Math.abs(block.position.y-bot.entity.position.y)>verticalRange)continue;
    out.push({name:block.name,position:point(block.position),distance:+block.position.distanceTo(bot.entity.position).toFixed(2),
      alternatives:positions.slice(1,8).map(p=>bot.blockAt(p)).filter(b=>b&&Math.abs(b.position.y-bot.entity.position.y)<=verticalRange)
        .map(b=>({position:point(b.position),distance:+b.position.distanceTo(bot.entity.position).toFixed(2)}))});
  }
  const blocks=out.sort((a,b)=>a.distance-b.distance||a.name.localeCompare(b.name)).slice(0,24);
  resourceCache.set(bot,{key,time:Date.now(),blocks});return blocks;
}
export function craftOptions(bot){
  if(!bot.registry || !bot.findBlock)return [];
  const table=bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:4});
  const out=[];
  for(const item of bot.registry.itemsArray){
    const recipe=bot.recipesFor(item.id,null,1,table)[0];
    if(recipe)out.push({id:`craft:${item.name}`,skill:'craft_item',arguments:{item:item.name,count:1},
      output_count:recipe.result.count,requires_table:recipe.requiresTable});
  }
  return out;
}
export function extraActions(bot,resources){
  const workstation=[];
  if(bot.inventory.items().some(i=>i.name==='crafting_table')&&!bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:4})){
    const o=bot.entity.position.floored();
    for(const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2]]){
      const q=o.offset(dx,0,dz),block=bot.blockAt(q),floor=bot.blockAt(q.offset(0,-1,0));
      if(block?.boundingBox==='empty'&&!['water','lava'].includes(block.name)&&floor?.boundingBox==='block')workstation.push({id:`workstation:${q.x}:${q.y}:${q.z}`,skill:'place_workstation',arguments:{x:q.x,y:q.y,z:q.z}});
    }
  }
  return [
    ...workstation,
    ...[[16,0],[-16,0],[0,16],[0,-16],[12,12],[-12,12],[12,-12],[-12,-12]].map(([dx,dz])=>({
      id:`explore:${Math.floor(bot.entity.position.x)+dx}:${Math.floor(bot.entity.position.z)+dz}`,skill:'explore',
      arguments:{x:Math.floor(bot.entity.position.x)+dx,z:Math.floor(bot.entity.position.z)+dz}})),
    ...resources.flatMap(b=>[b,...(b.alternatives??[]).map(p=>({...p,name:b.name}))]).filter(b=>!(b.position.x===Math.floor(bot.entity.position.x)&&b.position.z===Math.floor(bot.entity.position.z)&&b.position.y<bot.entity.position.y))
      .filter(b=>b.distance>12||/_log$/.test(b.name)&&Math.abs(b.position.y-bot.entity.position.y)>3||(b.position.y>=Math.floor(bot.entity.position.y)-1&&bot.canSeeBlock(bot.blockAt(bot.entity.position.clone().set(b.position.x,b.position.y,b.position.z))))||
        /_log$/.test(b.name)&&b.position.y>=Math.floor(bot.entity.position.y)-1&&b.position.y<=Math.floor(bot.entity.position.y)+3||
        bot.inventory.items().some(i=>/pickaxe$/.test(i.name))&&(['stone','granite','diorite','cobblestone','coal_ore'].includes(b.name)||['iron_ore','deepslate_iron_ore'].includes(b.name)&&bot.inventory.items().some(i=>/^(stone|iron|diamond|netherite)_pickaxe$/.test(i.name))))
      .map(b=>({id:`${b.distance>12||/_log$/.test(b.name)&&Math.abs(b.position.y-bot.entity.position.y)>3?'approach':'gather'}:${b.name}:${b.position.x}:${b.position.y}:${b.position.z}`,
      skill:b.distance>12||/_log$/.test(b.name)&&Math.abs(b.position.y-bot.entity.position.y)>3?'approach_resource':'mine_and_collect',arguments:{block:b.name,...b.position},
      output_items:(bot.registry.blocksByName[b.name]?.drops??[]).map(id=>bot.registry.items[id]?.name).filter(Boolean)})),
    ...Object.values(bot.entities).filter(e=>e.name==='item'&&e.position.distanceTo(bot.entity.position)<12&&e.position.y>=Math.floor(bot.entity.position.y)-1&&e.getDroppedItem?.())
      .sort((a,b)=>a.id-b.id).slice(0,32).map(e=>({id:`collect:${e.id}`,skill:'collect_item',arguments:{entity_id:e.id,item:e.getDroppedItem().name}})),
    ...craftOptions(bot)
  ];
}
export async function executeExtra(bot,candidate,assertActive){
  const before=inventoryCounts(bot),a=candidate.arguments;
  const startPosition=['mine_and_collect','collect_item'].includes(candidate.skill)?bot.entity.position.clone():null;
  if(candidate.skill==='place_workstation'){
    const q=bot.entity.position.clone().set(a.x,a.y,a.z),block=bot.blockAt(q);
    if(block?.name!=='air'&&block?.diggable){await bot.dig(block);assertActive();}
    const item=bot.inventory.items().find(i=>i.name==='crafting_table');if(!item)throw new Error('inventory_missing');
    await bot.equip(item,'hand');assertActive();await bot.placeBlock(bot.blockAt(q.offset(0,-1,0)),q.clone().set(0,1,0));assertActive();
    if(bot.blockAt(q)?.name!=='crafting_table')throw new Error('workstation_not_confirmed');
    return {skill:candidate.skill,position:point(q)};
  }else if(candidate.skill==='explore'){
    const movement=bot.pathfinder.movements,oldDig=movement.canDig;if(bot.inventory.items().some(i=>/pickaxe$/.test(i.name)))movement.canDig=true;
    const goal=new goals.GoalNearXZ(a.x,a.z,3);try{await bot.pathfinder.goto(goal);assertActive();if(!goal.isEnd(bot.entity.position.floored()))throw new Error('navigation_not_confirmed');}finally{movement.canDig=oldDig;}
    return {skill:candidate.skill,position:point(bot.entity.position)};
  }else if(candidate.skill==='approach_resource'){
    const vertical=(Math.abs(bot.entity.position.y-a.y)>3||['stone','coal_ore','iron_ore','deepslate_iron_ore'].includes(a.block))&&bot.inventory.items().some(i=>/pickaxe$/.test(i.name));
    if(vertical)bot.pathfinder.movements.canDig=true;
    const near=vertical?new goals.GoalNear(a.x,a.y,a.z,2):new goals.GoalNearXZ(a.x,a.z,2);
    const goal=['coal_ore','iron_ore','deepslate_iron_ore'].includes(a.block)?new goals.GoalCompositeAll([near,new goals.GoalInvert(new goals.GoalXZ(a.x,a.z))]):near;
    try{await bot.pathfinder.goto(goal);assertActive();if(!goal.isEnd(bot.entity.position.floored()))throw new Error('navigation_not_confirmed');}
    finally{if(vertical)bot.pathfinder.movements.canDig=false;}
    assertActive();
    return {skill:candidate.skill,position:point(bot.entity.position)};
  }else if(candidate.skill==='craft_item'){
    const table=bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:4});
    const recipe=bot.recipesFor(bot.registry.itemsByName[a.item].id,null,1,table)[0];
    if(!recipe)throw new Error('inventory_missing');
    assertActive();await bot.craft(recipe,1,recipe.requiresTable?table:null);assertActive();
    if((inventoryCounts(bot)[a.item]??0)<(before[a.item]??0)+recipe.result.count)throw new Error('craft_not_confirmed');
  }else{
    let destination,drop;
    const expected=candidate.skill==='collect_item'?[a.item]:(bot.registry.blocksByName[a.block]?.drops??[])
      .map(id=>bot.registry.items[id]?.name).filter(Boolean);
    const gained=()=>Object.entries(inventoryCounts(bot)).some(([name,count])=>(!expected.length||expected.includes(name))&&count>(before[name]??0));
    if(candidate.skill==='mine_and_collect'){
      destination=bot.entity.position.clone().set(a.x,a.y,a.z);
      let block=bot.blockAt(destination);
      if(!block||!bot.canDigBlock(block)){
        const miningAccess=/_log$/.test(a.block)||['stone','granite','diorite','cobblestone','coal_ore','iron_ore','deepslate_iron_ore'].includes(a.block)&&bot.inventory.items().some(i=>/pickaxe$/.test(i.name));
        if(miningAccess)bot.pathfinder.movements.canDig=true;
        try{await bot.pathfinder.goto(new goals.GoalNear(a.x,a.y,a.z,2));}finally{if(miningAccess)bot.pathfinder.movements.canDig=false;}
        assertActive();block=bot.blockAt(destination);
      }
      if(block?.name!==a.block)throw new Error('target_not_found');
      if(!bot.canDigBlock(block))throw new Error('target_unreachable');
      const tool=bot.pathfinder.bestHarvestTool(block);if(tool){await bot.equip(tool,'hand');assertActive();}
      await bot.dig(block);assertActive();
      for(let i=0;i<10;i++){
        drop=Object.values(bot.entities).filter(e=>e.name==='item'&&e.position.distanceTo(destination)<3)
          .sort((x,y)=>x.position.distanceTo(destination)-y.position.distanceTo(destination))[0];
        if(drop || gained())break;
        await delay(100);assertActive();
      }
    }else drop=bot.entities[a.entity_id];
    if(drop&&!gained()){
      const p=drop.position;
      const miningAccess=(['stone','granite','diorite','cobblestone','coal_ore','iron_ore','deepslate_iron_ore'].includes(a.block)||candidate.skill==='collect_item'&&['coal','raw_iron'].includes(a.item))&&bot.inventory.items().some(i=>/pickaxe$/.test(i.name));
      if(miningAccess)bot.pathfinder.movements.canDig=true;
      try{await bot.pathfinder.goto(new goals.GoalBlock(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)));}catch(error){if(!gained())throw error;}
      finally{if(miningAccess)bot.pathfinder.movements.canDig=false;}
      assertActive();
      for(let i=0;i<15&&!gained();i++){await delay(100);assertActive();}
    }
    if(!gained())throw new Error('pickup_not_confirmed');
    if(bot.entity.position.y<startPosition.y-0.5){
      const start=startPosition.floored();await bot.pathfinder.goto(new goals.GoalBlock(start.x,start.y,start.z));assertActive();
    }
  }
  const after=inventoryCounts(bot);
  return {skill:candidate.skill,inventory_before:before,inventory_after:after,
    inventory_delta:Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])].map(name=>[name,(after[name]??0)-(before[name]??0)]).filter(([,n])=>n))};
}
