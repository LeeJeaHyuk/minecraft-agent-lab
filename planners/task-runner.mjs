export const itemCount=(state,item)=>state.inventory.filter(i=>i.name===item).reduce((n,i)=>n+i.count,0);
export const stepComplete=(state,step)=>itemCount(state,step.item)>=step.count;
export function stepActions(actions,step){
  return actions.filter(a=>step.method==='craft'?a.skill==='craft_item'&&a.arguments.item===step.item:
    ['mine_and_collect','approach_resource'].includes(a.skill)&&(a.arguments.block===step.item||a.output_items?.includes(step.item))||a.skill==='collect_item'&&a.arguments.item===step.item);
}
// Refresh is asynchronous; results for a completed/changed milestone are discarded.
export class TaskPlanner {
  constructor(planner,{intervalMs=15000,onEvent=()=>{}}={}){
    this.planner=planner;this.intervalMs=intervalMs;this.onEvent=onEvent;this.pending=null;this.revision=0;this.closed=false;this.lastStarted=-Infinity;
  }
  advance(){this.revision++;this.lastStarted=-Infinity;}
  refresh(state,context,force=false){
    if(this.closed||this.pending||!force&&Date.now()-this.lastStarted<this.intervalMs)return this.pending;
    const revision=this.revision;this.lastStarted=Date.now();
    this.onEvent('planner_request',{revision,state,context});
    this.pending=this.planner.taskPlan(state,context).then(result=>{
      if(this.closed||revision!==this.revision){this.onEvent('planner_discarded',{revision,reason:'milestone_changed'});return null;}
      if(context.accepted_steps&&JSON.stringify(result.steps.map(({method,item,count})=>({method,item,count})))!==
        JSON.stringify(context.accepted_steps.map(({method,item,count})=>({method,item,count}))))throw new Error('planner_changed_completion_contract');
      this.latest={...result,revision};this.onEvent('planner_ready',{revision,...result});return this.latest;
    }).catch(error=>{this.onEvent('planner_error',{revision,error:error.message});return null;}).finally(()=>{this.pending=null;});
    return this.pending;
  }
  close(){this.closed=true;}
}
