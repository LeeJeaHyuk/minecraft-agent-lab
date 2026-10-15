export const conditionTypes=['inventory','equipped','vitals','home_safe','construction','corridor','stored','position'];
const name=x=>typeof x==='string'&&/^[a-z][a-z0-9_]*$/.test(x);
const count=x=>Number.isInteger(x)&&x>=1&&x<=2304;
export function validateCondition(c){
  if(!c||!conditionTypes.includes(c.type))throw Error('invalid_condition');
  if(['inventory','stored'].includes(c.type)&&(!name(c.item)||!count(c.count)))throw Error('invalid_inventory_condition');
  if(c.type==='equipped'&&(!['head','torso','legs','feet','off-hand','hand'].includes(c.slot)||!name(c.item)))throw Error('invalid_equipment_condition');
  if(c.type==='vitals'&&![c.health,c.food].every(x=>Number.isFinite(x)&&x>=1&&x<=20))throw Error('invalid_vitals_condition');
  if(['construction','corridor'].includes(c.type)&&(typeof c.site_id!=='string'||!c.site_id.startsWith('site:')))throw Error('condition_requires_site');
  if(c.type==='position'&&(![c.x,c.y,c.z,c.radius].every(Number.isFinite)||c.radius<0||c.radius>16))throw Error('invalid_position_condition');
  return c;
}
export const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function validatePlan(plan,{skills,items},objectives=null){
  if(!plan||!['continue','complete','blocked'].includes(plan.status)||typeof plan.summary!=='string'||plan.summary.length>500)throw Error('invalid_autonomous_plan');
  if(!Array.isArray(plan.objectives)||(!plan.objectives.length&&plan.status!=='blocked')||plan.objectives.length>12)throw Error('missing_objectives');
  plan.objectives.forEach(validateCondition);
  if(objectives&&canonical(plan.objectives)!==canonical(objectives))throw Error('completion_contract_changed');
  for(const c of plan.objectives)if(c.item&&!items.includes(c.item))throw Error('unknown_objective_item');
  if(!Array.isArray(plan.steps)||plan.steps.length>16||plan.status==='continue'&&!plan.steps.length)throw Error('missing_steps');
  for(const step of plan.steps){
    if(typeof step.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(step.id)||typeof step.subgoal!=='string'||step.subgoal.length>300)throw Error('invalid_step');
    if(step.kind==='act'){
      if(!Array.isArray(step.skills)||!step.skills.length||step.skills.some(s=>!skills.includes(s)))throw Error('unknown_step_skill');
      if(!Array.isArray(step.until)||!step.until.length||step.until.length>8)throw Error('missing_step_condition');
      step.until.forEach(validateCondition);
      if(step.until.some(c=>c.item&&!items.includes(c.item)))throw Error('unknown_step_item');
      if(step.match&&(!Array.isArray(step.match)||step.match.length>8||step.match.some(m=>!['item','block','mob','destination','entity_id','x','y','z','id_prefix'].includes(m.field)||!Array.isArray(m.values)||!m.values.length||m.values.length>12)))throw Error('invalid_action_filter');
    }else if(!['build','corridor','storage','home'].includes(step.kind))throw Error('unknown_operation');
  }
  if(new Set(plan.steps.map(s=>s.id)).size!==plan.steps.length)throw Error('duplicate_step_id');
  return plan;
}
export function conditionMet(c,snapshot){
  const {state:s,construction,corridor,chest}=snapshot;
  if(!s.connected||s.dead)return false;
  if(c.type==='inventory')return (s.inventory??[]).filter(i=>i.name===c.item).reduce((n,i)=>n+i.count,0)+Object.entries(s.equipment??{}).filter(([slot,item])=>slot!=='hand'&&item===c.item).length>=c.count;
  if(c.type==='equipped')return s.equipment?.[c.slot]===c.item;
  if(c.type==='vitals')return s.player.health>=c.health&&s.player.food>=c.food;
  if(c.type==='home_safe')return !!(s.home?.ready&&s.home.at_home&&!s.home.door_open);
  if(c.type==='construction')return construction?.blueprint?.site.id===c.site_id&&construction.complete;
  if(c.type==='corridor')return construction?.blueprint?.site.id===c.site_id&&corridor?.complete;
  if(c.type==='stored')return (chest?.[c.item]??0)>=c.count;
  if(c.type==='position')return Math.hypot(s.player.position.x-c.x,s.player.position.y-c.y,s.player.position.z-c.z)<=c.radius;
  return false;
}
export const conditionsMet=(conditions,snapshot)=>conditions.every(c=>conditionMet(c,snapshot));
export function stepCandidates(step,actions){
  return actions.filter(a=>step.skills.includes(a.skill)&&(step.match??[]).every(m=>m.values.includes(m.field==='id_prefix'?m.values.find(v=>a.id.startsWith(v)):a.arguments?.[m.field])));
}
