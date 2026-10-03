import {inventoryCounts} from './skills.mjs';
import pathfinderModule from 'mineflayer-pathfinder';
const point=p=>({x:p.x,y:p.y,z:p.z});
export function depositCount(inventory,keep,item){return Math.max(0,(inventory[item]??0)-(keep[item]??0));}
export function storageActions(bot,plan,building){
  if(!plan)return [];
  const origin=bot.entity.position.floored(),out=[];
  const chests=bot.findBlocks({matching:bot.registry.blocksByName.chest.id,maxDistance:4,count:8}).map(p=>bot.blockAt(p));
  if(!chests.length&&bot.inventory.items().some(i=>i.name==='chest')){
    for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){
      const q=origin.offset(dx,0,dz);if(q.distanceTo(bot.entity.position)<1.5||q.distanceTo(bot.entity.position)>4)continue;
      if(building?.cells.some(p=>p.x===q.x&&p.z===q.z))continue;
      if(bot.blockAt(q)?.name!=='air'||bot.blockAt(q.offset(0,1,0))?.name!=='air'||bot.blockAt(q.offset(0,-1,0))?.boundingBox!=='block')continue;
      if([[1,0],[-1,0],[0,1],[0,-1]].some(([x,z])=>bot.blockAt(q.offset(x,0,z))?.name==='chest'))continue;
      out.push({id:`chest:place:${q.x}:${q.y}:${q.z}`,skill:'place_chest',arguments:point(q)});
    }
    return out.slice(0,12);
  }
  const counts=inventoryCounts(bot);
  for(const b of chests){
    out.push({id:`chest:inspect:${b.position.x}:${b.position.y}:${b.position.z}`,skill:'inspect_chest',arguments:point(b.position)});
    for(const [name,target] of Object.entries(plan.withdraw??{})){
      const count=Math.max(0,target-(counts[name]??0));if(count)out.push({id:`chest:withdraw:${name}:${b.position.x}:${b.position.y}:${b.position.z}`,skill:'withdraw_item',arguments:{...point(b.position),item:name,count}});
    }
    for(const name of Object.keys(counts).sort()){
      const count=depositCount(counts,plan.keep,name);if(!count)continue;
      out.push({id:`chest:deposit:${name}:${b.position.x}:${b.position.y}:${b.position.z}`,skill:'deposit_item',arguments:{...point(b.position),item:name,count}});
    }
  }
  return out;
}
export async function executeStorage(bot,candidate,assertActive){
  const a=candidate.arguments,q=bot.entity.position.clone().set(a.x,a.y,a.z);
  if(candidate.skill==='place_chest'){
    if(bot.blockAt(q)?.name!=='air'||bot.blockAt(q.offset(0,1,0))?.name!=='air')throw new Error('chest_site_occupied');
    const item=bot.inventory.items().find(i=>i.name==='chest');if(!item)throw new Error('inventory_missing');
    await bot.equip(item,'hand');assertActive();await bot.placeBlock(bot.blockAt(q.offset(0,-1,0)),q.clone().set(0,1,0));assertActive();
    if(bot.blockAt(q)?.name!=='chest')throw new Error('chest_not_confirmed');
    return {skill:candidate.skill,position:point(q)};
  }
  const block=bot.blockAt(q);if(block?.name!=='chest')throw new Error('target_not_found');
  if(!bot.canSeeBlock(block)){await bot.pathfinder.goto(new pathfinderModule.goals.GoalNear(a.x,a.y,a.z,1));assertActive();}
  const chest=await bot.openContainer(block);
  try{
    const playerCounts=()=>inventoryCounts({inventory:chest});
    assertActive();const before=playerCounts();
    const counts=()=>Object.fromEntries([...new Set(chest.containerItems().map(i=>i.name))].map(name=>[name,chest.containerItems().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0)]));
    const old=counts();
    if(candidate.skill==='deposit_item'){
      await chest.deposit(bot.registry.itemsByName[a.item].id,null,a.count);assertActive();
      if((playerCounts()[a.item]??0)!==(before[a.item]??0)-a.count||(counts()[a.item]??0)!==(old[a.item]??0)+a.count)throw new Error('deposit_not_confirmed');
    }else if(candidate.skill==='withdraw_item'){
      if((old[a.item]??0)<a.count)throw new Error('chest_material_missing');
      await chest.withdraw(bot.registry.itemsByName[a.item].id,null,a.count);assertActive();
      if((playerCounts()[a.item]??0)!==(before[a.item]??0)+a.count||(counts()[a.item]??0)!==(old[a.item]??0)-a.count)throw new Error('withdraw_not_confirmed');
    }
    return {skill:candidate.skill,position:point(q),chest_inventory:counts(),inventory:playerCounts(),slots:chest.containerItems().map(i=>({slot:i.slot,item:i.name,count:i.count}))};
  }finally{chest.close();}
}
