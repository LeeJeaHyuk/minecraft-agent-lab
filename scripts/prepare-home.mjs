import {mkdir,writeFile} from 'node:fs/promises';
import {jsonRequest} from '../models/http.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {actionState} from '../planners/action-state.mjs';
import {ProgressChat} from '../planners/progress-chat.mjs';
import {stepComplete,stepActions} from '../planners/task-runner.mjs';
import {TaskRecording} from '../recording/obs.mjs';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,kev=new KevPolicy(),qwen=new QwenPlanner(),chat=new ProgressChat(base);
const get=path=>jsonRequest(base+path),post=(path,body)=>jsonRequest(base+path,{body,timeoutMs:240000});
const goal='집 안과 출입구 주변을 횃불 4개로 밝히고 문을 설치한 다음 집 안에서 문을 닫고 안전하게 대기하라.';
const report={goal,started:new Date().toISOString(),actions:[]},recording=new TaskRecording();
async function act(allowed,phase){
  if(!allowed.length)throw new Error('no_home_action:'+phase);
  const state=actionState(await get('/observe'),null,phase),decision=await kev.decide(state,allowed);
  const result=await post('/act',{expected_goal:goal,action_id:decision.action,decision,decision_context:{state,available_actions:allowed},policy_name:'kev',planner:{name:'qwen',model:qwen.model,plan:report.plan}});
  report.actions.push({phase,decision,result});console.log(JSON.stringify({phase,action:decision.action,status:result.status,error:result.error_details??result.error}));
  if(result.status!=='success')throw new Error(result.error_details??result.error);return result;
}
try{
  const initial=await get('/observe');if(initial.goal||initial.current_action)throw new Error('environment_busy');
  await recording.start(goal);await post('/goal',{goal});await post('/home',{});
  if(initial.home?.ready&&initial.home.lights.every(p=>p.block==='torch')){
    await act((await get('/actions')).filter(a=>a.skill==='return_home'),'verify-completed-home');report.home=(await get('/observe')).home;report.status='success';
  }else{
  await act((await get('/actions')).filter(a=>a.skill==='enter_home'),'approach-house');
  await post('/storage-plan',{keep:{wooden_pickaxe:1},withdraw:{coal:1,stick:1,oak_planks:6}});
  for(let i=0;i<3;i++){const allowed=(await get('/actions')).filter(a=>a.skill==='withdraw_item');if(!allowed.length)break;await act(allowed,'retrieve-materials');}
  report.plan=await qwen.taskPlan(await get('/observe'),{user_goal:'현재 인벤토리 재료로 torch 횃불 최소 4개와 oak_door 참나무 문 최소 1개를 제작하라. 채집 단계는 필요 없다. 두 제작 목표만 계획하라.'});
  if(!report.plan.steps.some(s=>s.item==='torch'&&s.count>=4)||!report.plan.steps.some(s=>s.item==='oak_door'&&s.count>=1)||report.plan.steps.some(s=>s.method!=='craft'))throw new Error('unexpected_home_crafting_plan');
  await chat.sayModel(report.plan);
  for(const step of report.plan.steps){for(let i=0;!stepComplete(await get('/observe'),step);i++){if(i>=8)throw new Error('craft_limit');await act(stepActions(await get('/actions'),step),'craft');}}
  await act((await get('/actions')).filter(a=>a.skill==='enter_home'),'enter-house');
  for(let i=0;i<4;i++){
    const state=await get('/observe');if(state.home.lights.every(p=>p.block==='torch'))break;
    let allowed=(await get('/actions')).filter(a=>a.skill==='place_torch');
    if(!allowed.length){await act((await get('/actions')).filter(a=>a.skill==='move_to'),'approach-light-site');allowed=(await get('/actions')).filter(a=>a.skill==='place_torch');}
    await act(allowed,'install-light');
  }
  await act((await get('/actions')).filter(a=>a.skill==='place_door'),'install-door');
  await act((await get('/actions')).filter(a=>a.skill==='return_home'),'safe-idle');
  report.home=(await get('/observe')).home;
  if(!report.home.ready||!report.home.at_home||report.home.door_open||report.home.lights.some(p=>p.block!=='torch'))throw new Error('home_verification_failed');
  report.status='success';
  }
  await chat.say('집 안과 주변의 횃불 4개 및 출입문을 확인했습니다. 집 안에서 문을 닫고 대기합니다.');
}catch(error){report.status='failure';report.error=error.message;console.error(error);process.exitCode=1;}
finally{await chat.pending;report.recording=await recording.stop(report.status).catch(error=>({error:error.message}));if((await get('/observe').catch(()=>({}))).goal===goal)await post('/goal',{goal:null});report.finished=new Date().toISOString();await mkdir('.runtime',{recursive:true});await writeFile('.runtime/home-setup-latest.json',JSON.stringify(report,null,2));}
