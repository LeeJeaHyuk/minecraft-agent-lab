import {TaskRecording} from '../recording/obs.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {jsonRequest} from '../models/http.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {ProgressChat} from '../planners/progress-chat.mjs';
import {TaskPlanner,stepComplete,stepActions,itemCount} from '../planners/task-runner.mjs';
const goal=process.argv[2]??process.env.AGENT_GOAL;
if(!goal)throw new Error('usage: node scripts/planned-agent.mjs "goal" [max-actions]');
const maxActions=Number(process.argv[3]??30);
if(!Number.isInteger(maxActions)||maxActions<1||maxActions>100)throw new Error('invalid_action_limit');
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,runId=randomUUID(),events=[];
const event=(type,data)=>{const row={type,time:new Date().toISOString(),...data};events.push(row);
  console.log(JSON.stringify(type==='planner_request'?{type,time:row.time,revision:row.revision}:row));};
const chat=new ProgressChat(base),planner=new TaskPlanner(new QwenPlanner(),{onEvent:(type,data)=>{event(type,data);if(type==='planner_ready')chat.sayModel(data);}}),kev=new KevPolicy();
const observe=()=>jsonRequest(`${base}/observe`,{timeoutMs:30000});
let accepted,completed=[],actionCount=0,failures=0,outcome='failure';
const recording=new TaskRecording({onEvent:(type,data)=>console.log(JSON.stringify({type,...data}))});
try{
  await recording.start(goal);
  await jsonRequest(`${base}/goal`,{body:{goal,subgoal:null}});
  const initial=await observe();if(!initial.connected)throw new Error('minecraft_not_ready');
  event('start',{run_id:runId,goal,initial_inventory:initial.inventory});
  const first=await planner.refresh(initial,{user_goal:goal},true);if(!first)throw new Error('initial_plan_failed');
  const capabilities=await jsonRequest(`${base}/capabilities`);
  for(const step of first.steps)if(!capabilities.item_names.includes(step.item))throw new Error(`unknown_plan_item:${step.item}`);
  accepted=first.steps;event('plan_accepted',{goal,steps:accepted,planner_model:first.model,latency_ms:first.latency_ms});
  while(completed.length<accepted.length){
    let state=await observe();if(!state.connected||state.dead)throw new Error('environment_not_ready');
    const index=completed.length,step=accepted[index];
    if(stepComplete(state,step)){
      completed.push({...step,observed_count:itemCount(state,step.item),inventory:state.inventory});planner.advance();
      event('subgoal_complete',{index,...completed.at(-1)});continue;
    }
    if(actionCount>=maxActions)throw new Error('action_limit_reached');
    const context={user_goal:goal,accepted_steps:accepted,completed_steps:completed,current_step:index};
    planner.refresh(state,context,failures>=2); // No await: Kev can continue with the current plan.
    const subgoal=planner.latest?.steps?.[index]?.subgoal??step.subgoal;
    await jsonRequest(`${base}/goal`,{body:{goal,subgoal}});state=await observe();
    const actions=await jsonRequest(`${base}/actions`,{timeoutMs:30000}),allowed=stepActions(actions,step);
    if(!allowed.length)throw new Error(`no_feasible_action:${step.method}:${step.item}`);
    const decisionState={...state,plan:{goal,step_index:index,current_step:{...step,subgoal},steps:accepted},completed_steps:completed.map(({item,count})=>({item,count}))};
    let decision;const decisionStarted=performance.now();
    try{decision=await kev.decide(decisionState,allowed);}catch(error){
      await jsonRequest(`${base}/decision-error`,{body:{decision_context:{state:decisionState,available_actions:allowed},policy_name:'kev',model_name:kev.model,model_revision:kev.revision,latency_ms:Math.round(performance.now()-decisionStarted),error:error.message}});throw error;
    }
    const p=planner.latest;
    const result=await jsonRequest(`${base}/act`,{timeoutMs:240000,body:{action_id:decision.action,decision,policy_name:'kev',
      decision_context:{state:decisionState,available_actions:allowed},planner:{name:'qwen',model:p.model,latency_ms:p.latency_ms,
        plan:p.steps,revision:p.revision,milestone_revision:planner.revision,plan_run_id:runId}}});actionCount++;
    event('action',{index,subgoal,decision,result});failures=result.status==='success'?0:failures+1;
    if(failures>=3)throw new Error('repeated_action_failure');
  }
  outcome='success';event('goal_complete',{goal,completed_steps:completed.length,action_count:actionCount,final_inventory:(await observe()).inventory});
}catch(error){event('failure',{error:error.message,completed_steps:completed.length});process.exitCode=1;}
finally{planner.close();await planner.pending;await chat.pending;await mkdir('.runtime',{recursive:true});
  const video=await recording.stop(outcome).catch(error=>({error:error.message}));
  await jsonRequest(`${base}/goal`,{body:{goal:null,expected_goal:goal}}).catch(()=>{});
  const report={recording:video,run_id:runId,goal,status:outcome,accepted_steps:accepted,completed,action_count:actionCount,events};
  await writeFile(`.runtime/planned-run-${runId}.json`,JSON.stringify(report,null,2));await writeFile('.runtime/latest-planned-run.json',JSON.stringify(report,null,2));
}
