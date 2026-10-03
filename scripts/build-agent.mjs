import {TaskRecording} from '../recording/obs.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {jsonRequest} from '../models/http.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {TaskPlanner,stepActions,stepComplete} from '../planners/task-runner.mjs';
import {compileBlueprint} from '../environment/construction.mjs';
import {actionState} from '../planners/action-state.mjs';
import {ProgressChat,itemLabel} from '../planners/progress-chat.mjs';
import {writeFileSync,readFileSync,unlinkSync,mkdirSync} from 'node:fs';
const lockPath='.runtime/build-agent.lock';mkdirSync('.runtime',{recursive:true});
try{writeFileSync(lockPath,String(process.pid),{flag:'wx'});}catch(error){
  if(error.code!=='EEXIST')throw error;
  const owner=Number(readFileSync(lockPath,'utf8'));
  if(!Number.isInteger(owner)||owner<=0)throw new Error('build_agent_lock_busy');
  let alive=true;try{process.kill(owner,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
  if(alive)throw new Error(`build_agent_already_running:${owner}`);
  unlinkSync(lockPath);writeFileSync(lockPath,String(process.pid),{flag:'wx'});
}
process.on('exit',()=>{try{if(readFileSync(lockPath,'utf8')===String(process.pid))unlinkSync(lockPath);}catch{}});
const resume=process.argv.includes('--resume');
let resumedReport;if(resume)resumedReport=JSON.parse(await readFile('.runtime/latest-build-run.json','utf8'));
const goal=resumedReport?.goal??process.argv[2]??'Autonomously build a small one-room house with a floor, walls, roof and a walk-through entrance. Choose a nearby observed flat site and feasible materials.';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,runId=randomUUID(),events=[],policy=new KevPolicy();
const event=(type,data)=>{const row={type,time:new Date().toISOString(),...data};events.push(row);console.log(JSON.stringify(type==='planner_request'?{type,time:row.time,revision:row.revision}:row));};
const qwen=new QwenPlanner({timeoutMs:90000,retries:0}),manager=new TaskPlanner(qwen,{onEvent:(type,data)=>{event(type,data);if(type==='planner_ready')chat.sayModel(data);}});
const chat=new ProgressChat(base,{onError:error=>event('chat_error',{error:error.message})});
const observe=()=>jsonRequest(`${base}/observe`,{timeoutMs:30000});
let plan,actionCount=0,status='failure',finalConstruction,failures=0;
let explorationCount=0;
let previousHouse;try{previousHouse=JSON.parse((await readFile('.runtime/previous-house.json','utf8')).replace(/^\uFEFF/,''));}catch{}
const failedActions=new Map();
let chatFailures=0,lastProgressCount=0;
async function execute(state,actions,phase){
  actions=actions.filter(a=>(failedActions.get(a.id)??0)<Date.now());
  if(!actions.length)throw new Error(`no_feasible_action:${phase}`);
  if(actionCount>=400)throw new Error('action_limit_reached');
  const input=actionState(state,plan.blueprint,phase);
  const decision=await policy.decide(input,actions),p=manager.latest??plan;
  const result=await jsonRequest(`${base}/act`,{timeoutMs:240000,body:{action_id:decision.action,decision,policy_name:'kev',
    decision_context:{state:input,available_actions:actions},
    planner:{name:'qwen',model:p.model,latency_ms:p.latency_ms,blueprint:plan.blueprint,plan_run_id:runId}}});
  actionCount++;event('action',{phase,number:actionCount,decision,result});failures=result.status==='success'?0:failures+1;
  const selected=actions.find(a=>a.id===decision.action);
  if(result.status!=='success'&&chatFailures++%3===0)chat.say('진행: 행동이 실패했습니다. 다른 후보나 탐색 경로로 다시 시도합니다.');
  if(result.status!=='success')failedActions.set(decision.action,Date.now()+30000);
  if(failures>=4)throw new Error('repeated_action_failure');
}
const recording=new TaskRecording({onEvent:(type,data)=>console.log(JSON.stringify({type,...data}))});
try{
  await recording.start(goal);
  await jsonRequest(`${base}/goal`,{body:{goal,subgoal:null}});
  if(resume){
    plan=resumedReport.plan;finalConstruction=await jsonRequest(`${base}/construction`);
    if(!plan||!finalConstruction?.blueprint)throw new Error('no_saved_construction_to_resume');
    event('resumed',{previous_run:resumedReport.run_id,inventory:(await observe()).inventory});
  }else{
  await jsonRequest(`${base}/construction`,{body:{blueprint:null}});
  const state=await observe(),sites=await jsonRequest(`${base}/build-sites`);if(!sites.length)throw new Error('no_flat_build_site');
  event('start',{run_id:runId,goal,inventory:state.inventory,sites});
  const feedback=[];
  for(let attempt=0;attempt<3;attempt++){
    try{
      plan=await qwen.buildingPlan(state,sites,{user_goal:goal,feedback});
      compileBlueprint(plan.blueprint,sites);
      finalConstruction=await jsonRequest(`${base}/construction`,{body:{blueprint:plan.blueprint}});
      const needs={};for(const q of finalConstruction.missing)needs[q.material]=(needs[q.material]??0)+1;
      for(const [material,count] of Object.entries(needs)){
        const have=state.inventory.filter(i=>i.name===material).reduce((n,i)=>n+i.count,0);
        const target=plan.steps.filter(s=>s.item===material).at(-1)?.count??have;
        if(target<count)throw new Error(`${material}_inventory_target_must_be_at_least_${count}_not_${target}`);
      }
      if(/attractive|beautiful|diverse/i.test(goal)&&Object.keys(needs).length<3)throw new Error('aesthetic_goal_requires_at_least_three_materials');
      break;
    }catch(error){event('plan_rejected',{attempt,error:error.message,response:error.response??plan??null});feedback.push(error.message);if(attempt===2)throw error;}
  }
  }
  event('building_plan',{...plan,required_blocks:finalConstruction.expected_blocks});if(!resume)chat.sayModel(plan);manager.latest={...plan,revision:0};
  const capabilities=await jsonRequest(`${base}/capabilities`);
  if(plan.steps.some(s=>!capabilities.item_names.includes(s.item)))throw new Error('unknown_plan_item');
  for(let index=0;index<plan.steps.length;index++){
    if(resumedReport?.events.some(e=>e.type==='prerequisite_complete'&&e.index===index)){event('prerequisite_complete',{index,step:plan.steps[index],resumed:true});continue;}
    const step=plan.steps[index];
    while(true){
      let state=await observe();if(stepComplete(state,step)){event('prerequisite_complete',{index,step,inventory:state.inventory});chat.say(`완료: ${itemLabel(step.item)} ${step.count}개 확보.`);manager.advance();break;}
      await jsonRequest(`${base}/goal`,{body:{goal,subgoal:step.subgoal}});state=await observe();
      manager.refresh(state,{user_goal:goal,accepted_steps:plan.steps,building_plan:plan.blueprint,phase:'materials'},failures>=2);
      const available=await jsonRequest(`${base}/actions`,{timeoutMs:240000});
      let allowed=stepActions(available,step);
      if(!allowed.length&&step.method==='craft')allowed=available.filter(a=>a.skill==='place_workstation');
      if(step.method==='collect'&&(failures>=2||!allowed.some(a=>(failedActions.get(a.id)??0)<Date.now()))){
        if(explorationCount++>=16)throw new Error('exploration_limit_reached');
        allowed=available.filter(a=>a.skill==='explore');
        event('exploration',{item:step.item,attempt:explorationCount});
      }
      const site=finalConstruction.blueprint.site;
      allowed=allowed.filter(a=>!['mine_and_collect','approach_resource'].includes(a.skill)||
        (a.arguments.x<site.origin.x-1||a.arguments.x>site.origin.x+site.size||a.arguments.z<site.origin.z-1||a.arguments.z>site.origin.z+site.size));
      allowed=allowed.filter(a=>!['mine_and_collect','approach_resource'].includes(a.skill)||!previousHouse?.cells.some(q=>q.x===a.arguments.x&&q.y===a.arguments.y&&q.z===a.arguments.z));
      await execute(state,allowed,'materials');
    }
  }
  const ready=await observe();
  const needs={};for(const q of finalConstruction.missing)needs[q.material]=(needs[q.material]??0)+1;
  for(const [item,count] of Object.entries(needs))if(!stepComplete(ready,{item,count}))throw new Error(`materials_consumed_before_build:${item}`);
  manager.advance();await jsonRequest(`${base}/goal`,{body:{goal,subgoal:'Construct the accepted blueprint and keep the entrance and room clear.'}});
  while(true){
    finalConstruction=await jsonRequest(`${base}/construction`);
    if(finalConstruction.complete)break;
    const state=await observe();
    manager.refresh(state,{user_goal:goal,accepted_steps:plan.steps,building_plan:plan.blueprint,phase:'construction'},failures>=2);
    const actions=(await jsonRequest(`${base}/actions`,{timeoutMs:240000})).filter(a=>['place_block','clear_build_cell','approach_build_site'].includes(a.skill));
    await execute(state,actions,'construction');
    event('progress',{matched:finalConstruction.matched_blocks,total:finalConstruction.expected_blocks});
    if(finalConstruction.matched_blocks>=lastProgressCount+10){lastProgressCount=finalConstruction.matched_blocks;chat.say(`건축: ${lastProgressCount}/${finalConstruction.expected_blocks}개 블록 확인. 바닥부터 벽과 지붕을 올리는 중입니다.`);}
  }
  status='success';event('house_complete',{action_count:actionCount,verification:finalConstruction});
  chat.say(`완성: 집 ${finalConstruction.expected_blocks}개 블록과 출입구를 확인했습니다. 위치 X ${finalConstruction.blueprint.site.origin.x}, Z ${finalConstruction.blueprint.site.origin.z}.`);
}catch(error){event('failure',{error:error.message,action_count:actionCount});process.exitCode=1;}
finally{manager.close();await manager.pending;await chat.pending;await mkdir('.runtime',{recursive:true});
  const video=await recording.stop(status).catch(error=>({error:error.message}));
  await jsonRequest(`${base}/goal`,{body:{goal:null,expected_goal:goal}}).catch(()=>{});
  const report={recording:video,run_id:runId,goal,status,action_count:actionCount,plan,verification:finalConstruction,events};
  await writeFile(`.runtime/build-run-${runId}.json`,JSON.stringify(report,null,2));await writeFile('.runtime/latest-build-run.json',JSON.stringify(report,null,2));
}
