import {constructionActions} from './construction.mjs';
const position=(bot,q)=>bot.entity.position.clone().set(q.x,q.y,q.z);
export function corridorBlueprint(home,annex,inventory){
  if(!home||!annex)throw Error('annex_or_home_missing');
  const opening=annex.openings.find(q=>q[1]===1);
  const x=annex.site.origin.x+opening[0],front=annex.site.origin.z,back=home.point.z+1,y=home.point.y-1;
  if(opening[2]!==0||annex.site.origin.y!==y||front-back<2||front-back>4||x<home.point.x||x>home.point.x+1)throw Error('annex_not_aligned');
  const cells=[],available={cobblestone:inventory.filter(i=>i.name==='cobblestone').reduce((s,i)=>s+i.count,0),oak_planks:inventory.filter(i=>i.name==='oak_planks').reduce((s,i)=>s+i.count,0)};
  const add=(xx,yy,zz)=>{const material=available.cobblestone>0?'cobblestone':available.oak_planks>0?'oak_planks':null;if(!material)throw Error('corridor_materials_missing');available[material]--;cells.push({x:xx,y:yy,z:zz,material});};
  for(let z=back+1;z<front;z++){add(x,y,z);add(x,y+3,z);for(const xx of [x-1,x+1])for(const yy of [y+1,y+2])add(xx,yy,z);}
  const clear=[{x,y:y+1,z:back},{x,y:y+2,z:back}];
  for(let z=back+1;z<front;z++)for(const yy of [y+1,y+2])clear.push({x,y:yy,z});
  return {site:{origin:{x:x-1,y,z:back},size:Math.max(3,front-back)},cells:cells.sort((a,b)=>a.y-b.y||a.z-b.z),clear,lights:[{x:annex.site.origin.x+2,y:y+1,z:front+2}]};
}
export function inspectCorridor(bot,blueprint){
  if(!blueprint)return null;
  const missing=blueprint.cells.filter(q=>bot.blockAt(position(bot,q))?.name!==q.material);
  const blocked=blueprint.clear.filter(q=>bot.blockAt(position(bot,q))?.boundingBox==='block');
  const missingLights=(blueprint.lights??[]).filter(q=>bot.blockAt(position(bot,q))?.name!=='torch');
  return {expected_blocks:blueprint.cells.length,matched_blocks:blueprint.cells.length-missing.length,blocked,missing_lights:missingLights,complete:missing.length===0&&blocked.length===0&&missingLights.length===0,missing};
}
export function corridorActions(bot,blueprint){
  if(!blueprint)return [];
  const status=inspectCorridor(bot,blueprint);
  if(status.blocked.length)return status.blocked.slice(0,1).map(q=>({id:`annex:clear:${q.x}:${q.y}:${q.z}`,skill:'clear_build_cell',arguments:q}));
  if(!status.missing.length&&status.missing_lights.length&&bot.inventory.items().some(i=>i.name==='torch')){
    const q=status.missing_lights[0];
    if(position(bot,q).distanceTo(bot.entity.position)<=4.5)return [{id:`annex:torch:${q.x}:${q.y}:${q.z}`,skill:'place_torch',arguments:q}];
    return [{id:'annex:approach-light',skill:'move_to',arguments:{x:q.x,y:q.y,z:q.z-1}}];
  }
  // Reuse the placement executor; only the explicit passage blueprint can be modified.
  return constructionActions(bot,{...blueprint,openings:[]}).map(a=>({...a,id:`annex:${a.id}`}));
}
