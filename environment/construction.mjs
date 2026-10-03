import pathfinderModule from 'mineflayer-pathfinder';
const {goals}=pathfinderModule;
const p=(bot,x,y,z)=>bot.entity.position.clone().set(x,y,z);
const key=q=>`${q.x}:${q.y}:${q.z}`;
const replaceable=b=>b&&b.boundingBox==='empty'&&!['water','lava'].includes(b.name);
export const buildingMaterials=['dirt','oak_planks','oak_log','oak_wood','birch_planks','birch_log','cobblestone','granite','diorite','polished_granite','polished_diorite'];
export function surveySites(bot){
  if(!bot?.entity)return [];
  const o=bot.entity.position.floored(),sites=[];
  for(const size of [4,3])for(let dx=-14;dx<=14;dx+=2)for(let dz=-14;dz<=14;dz+=2){
    if(Math.hypot(dx,dz)<4)continue;
    for(let y=o.y-2;y<=o.y+2;y++){
      let valid=true;
      for(let x=0;x<size&&valid;x++)for(let z=0;z<size&&valid;z++){
        if(bot.blockAt(p(bot,o.x+dx+x,y-1,o.z+dz+z))?.boundingBox!=='block')valid=false;
        for(let h=0;h<5&&valid;h++)if(!replaceable(bot.blockAt(p(bot,o.x+dx+x,y+h,o.z+dz+z))))valid=false;
      }
      if(valid){sites.push({id:`site:${o.x+dx}:${y-1}:${o.z+dz}:${size}`,origin:{x:o.x+dx,y:y-1,z:o.z+dz},size,distance:+Math.hypot(dx,dz).toFixed(2)});break;}
    }
  }
  return sites.sort((a,b)=>b.size-a.size||a.distance-b.distance||a.id.localeCompare(b.id)).filter((s,i,all)=>i===all.findIndex(t=>t.origin.x===s.origin.x&&t.origin.z===s.origin.z)).slice(0,8);
}
export function compileBlueprint(plan,sites){
  const site=sites.find(s=>s.id===plan.site_id);
  if(!site||!buildingMaterials.includes(plan.material)||!Array.isArray(plan.cuboids)||plan.cuboids.length<1||plan.cuboids.length>24)throw new Error('invalid_blueprint');
  const cells=new Map(),n=site.size;
  for(const box of plan.cuboids){
    const material=box.material??plan.material;
    if(!buildingMaterials.includes(material))throw new Error('invalid_blueprint_material');
    for(const a of [box.from,box.to])if(!Array.isArray(a)||a.length!==3||!a.every(Number.isInteger)||a[0]<0||a[0]>=n||a[2]<0||a[2]>=n||a[1]<0||a[1]>4)throw new Error('invalid_blueprint_bounds');
    if(box.from.some((v,i)=>v>box.to[i]))throw new Error('invalid_blueprint_bounds');
    for(let x=box.from[0];x<=box.to[0];x++)for(let y=box.from[1];y<=box.to[1];y++)for(let z=box.from[2];z<=box.to[2];z++)cells.set(`${x}:${y}:${z}`,{x,y,z,material});
  }
  const openings=plan.openings;
  if(!Array.isArray(openings)||openings.length!==2)throw new Error('invalid_entrance');
  const [a,b]=openings;
  if(![a,b].every(q=>Array.isArray(q)&&q.length===3&&q.every(Number.isInteger))||a[0]!==b[0]||a[2]!==b[2]||[a[1],b[1]].sort().join()!=='1,2'||
    !((a[0]===0||a[0]===n-1)&&a[2]>0&&a[2]<n-1||(a[2]===0||a[2]===n-1)&&a[0]>0&&a[0]<n-1))throw new Error('invalid_entrance');
  for(const q of openings)cells.delete(q.join(':'));
  for(let x=0;x<n;x++)for(let z=0;z<n;z++)for(let y=0;y<=3;y++){
    const boundary=x===0||z===0||x===n-1||z===n-1,entrance=openings.some(q=>q[0]===x&&q[1]===y&&q[2]===z);
    const required=y===0||y===3||boundary&&!entrance;
    if(cells.has(`${x}:${y}:${z}`)!==required)throw new Error('incomplete_house_blueprint');
  }
  return {site,material:plan.material,description:plan.description??'',cuboids:plan.cuboids,openings,
    cells:[...cells.values()].map(q=>({x:q.x+site.origin.x,y:q.y+site.origin.y,z:q.z+site.origin.z,material:q.material})).sort((a,b)=>a.y-b.y||a.x-b.x||a.z-b.z)};
}
export function inspectConstruction(bot,blueprint){
  if(!blueprint)return null;
  const cells=blueprint.cells.map(q=>({...q,actual:bot.blockAt(p(bot,q.x,q.y,q.z))?.name??null}));
  const missing=cells.filter(q=>q.actual!==(q.material??blueprint.material));
  const entry=blueprint.openings.map(q=>p(bot,q[0]+blueprint.site.origin.x,q[1]+blueprint.site.origin.y,q[2]+blueprint.site.origin.z));
  let interiorClear=true;
  for(let x=1;x<blueprint.site.size-1;x++)for(let z=1;z<blueprint.site.size-1;z++)for(let y=1;y<=2;y++)
    if(!replaceable(bot.blockAt(p(bot,blueprint.site.origin.x+x,blueprint.site.origin.y+y,blueprint.site.origin.z+z))))interiorClear=false;
  return {blueprint,expected_blocks:cells.length,matched_blocks:cells.length-missing.length,missing,entry_clear:entry.every(q=>replaceable(bot.blockAt(q))),
    interior_clear:interiorClear,complete:missing.length===0&&interiorClear&&entry.every(q=>replaceable(bot.blockAt(q)))};
}
export function constructionActions(bot,blueprint){
  const distance=Math.hypot(bot.entity.position.x-blueprint.site.origin.x,bot.entity.position.z-blueprint.site.origin.z);
  if(distance>12)return [{id:`return-build:${blueprint.site.id}`,skill:'approach_build_site',arguments:{x:blueprint.site.origin.x-1,z:blueprint.site.origin.z}}];
  const status=inspectConstruction(bot,blueprint);if(!status?.missing.length)return [];
  const y=status.missing[0].y,out=[];
  for(const q of status.missing.filter(q=>q.y===y)){
    const block=bot.blockAt(p(bot,q.x,q.y,q.z));
    if(!block)continue;
    if(!replaceable(block)){if(block.diggable)out.push({id:`clear-build:${key(q)}`,skill:'clear_build_cell',arguments:{x:q.x,y:q.y,z:q.z}});}
    else if(bot.inventory.items().some(i=>i.name===(q.material??blueprint.material))){
      const adjacent=[[0,-1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,1,0]].some(d=>bot.blockAt(p(bot,q.x+d[0],q.y+d[1],q.z+d[2]))?.boundingBox==='block');
      const material=q.material??blueprint.material;
      if(adjacent)out.push({id:`place:${material}:${key(q)}`,skill:'place_block',arguments:{item:material,x:q.x,y:q.y,z:q.z}});
    }
  }
  return out.slice(0,8);
}
export async function executeConstruction(bot,candidate,blueprint,assertActive){
  if(candidate.skill==='approach_build_site'){
    const a=candidate.arguments,start=Math.hypot(bot.entity.position.x-a.x,bot.entity.position.z-a.z);
    const underground=bot.entity.position.y<blueprint.site.origin.y-1;
    if(underground)bot.pathfinder.movements.canDig=true;
    try{await bot.pathfinder.goto(underground?new goals.GoalNear(a.x,blueprint.site.origin.y+1,a.z,2):new goals.GoalNearXZ(a.x,a.z,2));}catch(error){if(Math.hypot(bot.entity.position.x-a.x,bot.entity.position.z-a.z)>start-4)throw error;}
    finally{if(underground)bot.pathfinder.movements.canDig=false;}
    assertActive();return {skill:candidate.skill,position:{x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z}};
  }
  const a=candidate.arguments,target=p(bot,a.x,a.y,a.z),site=blueprint.site;
  const standing=[];
  for(let x=-1;x<=site.size;x++)for(let z=-1;z<=site.size;z++){
    if(x!==-1&&z!==-1&&x!==site.size&&z!==site.size)continue;
    const feet=p(bot,site.origin.x+x,site.origin.y+1,site.origin.z+z);
    if(bot.blockAt(feet.offset(0,-1,0))?.boundingBox==='block'&&replaceable(bot.blockAt(feet))&&replaceable(bot.blockAt(feet.offset(0,1,0)))&&feet.offset(.5,1.62,.5).distanceTo(target.offset(.5,.5,.5))<4.3)standing.push(feet);
  }
  standing.sort((x,y)=>x.distanceTo(bot.entity.position)-y.distanceTo(bot.entity.position));
  if(!standing.length)throw new Error('target_unreachable');
  const stand=standing[0];await bot.pathfinder.goto(new goals.GoalBlock(stand.x,stand.y,stand.z));assertActive();
  let block=bot.blockAt(target);
  if(candidate.skill==='clear_build_cell'){
    await bot.dig(block);assertActive();if(bot.blockAt(target)?.boundingBox==='block')throw new Error('clear_not_confirmed');
    return {skill:candidate.skill,position:{x:a.x,y:a.y,z:a.z},previous_block:block.name};
  }
  if(block.name!=='air'&&block.diggable){await bot.dig(block);assertActive();}
  const item=bot.inventory.items().find(i=>i.name===a.item);if(!item)throw new Error('inventory_missing');
  await bot.equip(item,'hand');assertActive();
  const vectors=[[0,-1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,1,0]];
  const references=vectors.map(d=>({block:bot.blockAt(target.offset(...d)),face:p(bot,-d[0],-d[1],-d[2])})).filter(r=>r.block?.boundingBox==='block');
  let last;
  for(const reference of references){
    try{await bot.placeBlock(reference.block,reference.face);assertActive();if(bot.blockAt(target)?.name===a.item)return {skill:candidate.skill,placed_block:a.item,position:{x:a.x,y:a.y,z:a.z}};}
    catch(error){last=error;assertActive();if(bot.blockAt(target)?.name===a.item)return {skill:candidate.skill,placed_block:a.item,position:{x:a.x,y:a.y,z:a.z}};}
  }
  throw last??new Error('placement_not_confirmed');
}
