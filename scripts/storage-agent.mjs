import {TaskRecording} from '../recording/obs.mjs';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {jsonRequest} from '../models/http.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {ProgressChat,itemLabel} from '../planners/progress-chat.mjs';
import {actionState} from '../planners/action-state.mjs';
import {stepComplete,stepActions} from '../planners/task-runner.mjs';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,qwen=new QwenPlanner(),kev=new KevPolicy();
const chat=new ProgressChat(base),goal=process.argv[2]??'상자를 제작하고 집 옆에 설치한 뒤 가진 물품을 정리하여 보관하라. 도구 한 개는 작업용으로 남겨도 된다.';
const get=path=>jsonRequest(base+path),post=(path,body)=>jsonRequest(base+path,{body,timeoutMs:240000});
const report={goal,started:new Date().toISOString(),actions:[]};
const resumed=process.argv.includes('--resume')?JSON.parse(await readFile('.runtime/latest-storage-run.json','utf8')):null;
async function act(allowed,phase){
  if(!allowed.length)throw new Error('no_storage_action:'+phase);
  const state=actionState(await get('/observe'),null,phase),decision=await kev.decide({...state,storage_plan:report.storage_plan},allowed);
  const selected=allowed.find(a=>a.id===decision.action),top=Object.entries(decision.probabilities).sort((a,b)=>b[1]-a[1]).slice(0,2);
  if(process.env.MC_CHAT_DEBUG==='true'&&selected.skill==='deposit_item')await chat.say(`보관 판단: ${itemLabel(selected.arguments.item)} ${selected.arguments.count}개 중 작업용 유지 ${report.storage_plan.keep[selected.arguments.item]??0}개. 후보 ${top.map(([id,p])=>`${itemLabel(allowed.find(a=>a.id===id).arguments.item)} ${(p*100).toFixed(1)}%`).join(', ')}. 선택한 물품을 상자로 옮깁니다.`,{source:'kev',model:decision.model_name});
  const result=await post('/act',{action_id:decision.action,decision,decision_context:{state,available_actions:allowed},policy_name:'kev',planner:{name:'qwen',model:qwen.model,plan:report.storage_plan??report.crafting_plan}});
  report.actions.push({phase,decision,result});console.log(JSON.stringify({phase,action:decision.action,result}));
  if(result.status!=='success')throw new Error(result.error_details??result.error);
  return result;
}
const recording=new TaskRecording({onEvent:(type,data)=>console.log(JSON.stringify({type,...data}))});
try{
  await recording.start(goal);
  const state=await get('/observe');if(state.current_action)throw new Error('environment_busy');
  report.initial_inventory=state.inventory;await post('/goal',{goal,subgoal:'상자 제작 준비'});
  report.crafting_plan=resumed?.crafting_plan??await qwen.taskPlan(state,{user_goal:'현재 가진 재료로 상자 chest 1개를 제작하라. 최종 단계는 craft chest count 1. 기존 제작대를 사용할 수 있다.'});
  if(!resumed)await chat.sayModel(report.crafting_plan);
  for(const step of resumed?[]:report.crafting_plan.steps){
    for(let n=0;!stepComplete(await get('/observe'),step);n++){
      if(n>=12)throw new Error('craft_action_limit');const actions=await get('/actions');let allowed=stepActions(actions,step);
      if(!allowed.length&&step.method==='craft')allowed=actions.filter(a=>a.skill==='place_workstation');
      await act(allowed,'crafting');
    }
  }
  report.storage_plan=await qwen.storagePlan(await get('/observe'),{user_goal:goal,resumed_plan:resumed?.storage_plan});await post('/storage-plan',report.storage_plan);
  await chat.sayModel(report.storage_plan);
  let actions=await get('/actions');
  if(!actions.some(a=>a.skill==='inspect_chest'))await act(actions.filter(a=>a.skill==='place_chest'),'placement');
  for(let n=0;n<30;n++){
    actions=await get('/actions');const deposits=actions.filter(a=>a.skill==='deposit_item');if(!deposits.length)break;
    await act(deposits,'deposit');if(n===29)throw new Error('deposit_limit');
  }
  const verified=await act((await get('/actions')).filter(a=>a.skill==='inspect_chest'),'verification');
  report.final=verified.result;report.status='success';
  await chat.say('정리 완료: 상자에 물품을 보관했고 실제 수량을 확인했습니다. 작업용 곡괭이는 가지고 있습니다.');
  await post('/goal',{goal:null,subgoal:null});
}catch(error){report.status='failure';report.error=error.message;console.error(error.message);process.exitCode=1;}
finally{await chat.pending;report.recording=await recording.stop(report.status).catch(error=>({error:error.message}));await post('/goal',{goal:null,expected_goal:goal}).catch(()=>{});report.finished=new Date().toISOString();await mkdir('.runtime',{recursive:true});await writeFile('.runtime/latest-storage-run.json',JSON.stringify(report,null,2));}
