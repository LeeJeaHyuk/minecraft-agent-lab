import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {jsonRequest} from '../models/http.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {ProgressChat} from '../planners/progress-chat.mjs';
import {actionState} from '../planners/action-state.mjs';
import {stepComplete,stepActions} from '../planners/task-runner.mjs';
import {TaskRecording} from '../recording/obs.mjs';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,get=p=>jsonRequest(base+p),post=(p,body)=>jsonRequest(base+p,{body,timeoutMs:240000});
const goal='철을 탐색·채굴·제련하고 철 곡괭이, 철검, 방패 및 철 방어구 4부위를 제작·착용하라.';
const kev=new KevPolicy(),qwen=new QwenPlanner({timeoutMs:90000}),chat=new ProgressChat(base),recording=new TaskRecording();
const report=process.argv.includes('--resume')?JSON.parse(await readFile('.runtime/equipment-run-latest.json','utf8')):{goal,started:new Date().toISOString(),actions:[],plans:[]};let initialDeaths;
report.phase_plans??={};report.phase_steps??={};report.completed_phases??=[];report.status='running';delete report.error;
const count=(s,name)=>s.inventory.filter(i=>i.name===name).reduce((n,i)=>n+i.count,0)+Object.entries(s.equipment??{}).filter(([slot,item])=>slot!=='hand'&&item===name).length;
async function persist(){await mkdir('.runtime',{recursive:true});await writeFile('.runtime/equipment-run-latest.json',JSON.stringify(report,null,2));}
async function act(allowed,phase){
  if(!allowed.length)throw new Error('no_equipment_action:'+phase);
  const observed=await get('/observe');if(observed.dead||observed.death_count!==initialDeaths)throw new Error('death_interrupt');
  if(observed.player.health<12&&!['return-home','recover-food','eat-food'].includes(phase))throw new Error('low_health_retreat');
  if(report.actions.length>300)throw new Error('equipment_action_limit');
  const state=actionState(observed,null,phase),decision=await kev.decide(state,allowed),selected=allowed.find(a=>a.id===decision.action);
  const result=await post('/act',{expected_goal:goal,action_id:decision.action,decision,decision_context:{state,available_actions:allowed},policy_name:'kev',planner:{name:'qwen',model:qwen.model,plan:report.plans.at(-1)}});
  report.actions.push({phase,decision,result});console.log(JSON.stringify({phase,action:decision.action,status:result.status,error:result.error_details??result.error,result:result.result}));await persist();
  if(result.status!=='success')throw new Error(result.error_details??result.error);return {result,selected};
}
async function actions(skill){return (await get('/actions')).filter(a=>a.skill===skill);}
async function gather(item,target){
  let failures=0;const rejected=new Set();
  while(count(await get('/observe'),item)<target){
    const s=await get('/observe');if(s.player.health<16||s.player.food<16)await recoverHealth();
    const step={method:'collect',item,count:target};let allowed=stepActions(await get('/actions'),step).filter(a=>!rejected.has(a.id));
    const distance=a=>{const p=a.arguments,q=s.player.position;return Number.isFinite(p.x)?Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z):0;};
    allowed=allowed.sort((a,b)=>distance(a)-distance(b)).slice(0,4);
    if(!allowed.length){const explore=(await actions('explore')).filter(a=>!rejected.has(a.id));if(!explore.length)throw new Error('resource_exploration_exhausted:'+item);try{await act(explore,'explore-'+item);rejected.clear();}catch(error){if(/death|health|http_409/.test(error.message))throw error;rejected.add(report.actions.at(-1).decision.action);if(++failures>=8)throw error;}continue;}
    try{await act(allowed,'collect-'+item);failures=0;}catch(error){if(/death|health|http_409/.test(error.message))throw error;const last=report.actions.at(-1);if(last)rejected.add(last.decision.action);if(++failures>=8)throw error;}
  }
}
async function craft(item){if(count(await get('/observe'),item))return;await act((await actions('craft_item')).filter(a=>a.arguments.item===item),'craft-'+item);}
async function runPlan(key,request){
  if(report.completed_phases.includes(key))return;
  const plan=report.phase_plans[key]??await qwen.taskPlan(await get('/observe'),{user_goal:request});
  if(!report.phase_plans[key]){report.plans.push(plan);report.phase_plans[key]=plan;await chat.sayModel(plan);await persist();}
  for(let i=report.phase_steps[key]??0;i<plan.steps.length;i++){
    const step=plan.steps[i];if(step.method==='collect')await gather(step.item,step.count);else for(let n=0;!stepComplete(await get('/observe'),step);n++){if(n>12)throw new Error('bootstrap_craft_limit');let allowed=stepActions(await get('/actions'),step);if(!allowed.length){await home();allowed=stepActions(await get('/actions'),step);}await act(allowed,'bootstrap-craft');}
    report.phase_steps[key]=i+1;await persist();
  }
  report.completed_phases.push(key);await persist();
}
async function home(){await act(await actions('return_home'),'return-home');}
async function recoverHealth(){
  let s=await get('/observe');if(s.player.health>=18&&s.player.food>=18)return;
  await home();await chat.say('체력 회복을 위해 식량을 확보하고 집에서 먹은 뒤 채굴을 이어갑니다.');
  for(let n=0;n<20;n++){
    s=await get('/observe');if(s.player.health>=18&&s.player.food>=18)return;
    const eat=await actions('eat_food');if(eat.length){await act(eat,'eat-food');continue;}
    if(s.player.food<18){if(s.player.health<16||s.environment.time>12000)throw new Error('unsafe_to_hunt_food_staying_home');const hunt=(await actions('hunt_food')).slice(0,1);if(!hunt.length)throw new Error('food_source_not_found');await act(hunt,'recover-food');await home();continue;}
    await delay(10000);
  }throw new Error('health_recovery_timeout');
}
async function smelt(){
  const available=await get('/actions');try{await act(available.filter(a=>a.skill==='smelt_iron'),'smelt-iron');}
  catch(error){if(/death|health/.test(error.message))throw error;await act(await actions('recover_furnace'),'recover-smelting');}
}
try{
  const initial=await get('/observe');if(initial.goal||initial.current_action)throw new Error('environment_busy');initialDeaths=initial.death_count;
  await recording.start(goal);await post('/goal',{goal});
  await recoverHealth();
  if(!report.actions.some(a=>a.phase==='recover-food'&&a.result.status==='success')&&count(await get('/observe'),'porkchop')+count(await get('/observe'),'beef')+count(await get('/observe'),'mutton')<6){
    const rejected=new Set();for(let n=0;n<8;n++){const s=await get('/observe');if(count(s,'porkchop')+count(s,'beef')+count(s,'mutton')>=6)break;const hunt=(await actions('hunt_food')).filter(a=>!rejected.has(a.id));if(!hunt.length)break;try{await act(hunt,'recover-food');}catch(error){if((await get('/observe')).death_count!==initialDeaths)throw error;rejected.add(report.actions.at(-1).decision.action);}}await home();
  }
  // Retrieve only actual chest stock already verified during the home task.
  if(!report.completed_phases.includes('basic-tools')){
  await post('/storage-plan',{keep:{},withdraw:{oak_planks:8,stick:5,cobblestone:2}});
  for(let n=0;n<3;n++){const available=await actions('withdraw_item');if(!available.length)break;await act(available,'retrieve-starter-materials');}
  }
  await home();
  await runPlan('basic-tools','기본 무기와 도구 준비. 현재 oak_planks 8개, stick 5개를 활용한다. 먼저 stick 보유량 최소 8개가 되도록 제작한 뒤 wooden_pickaxe 1개와 wooden_sword 1개를 제작하라. 이 세 craft 단계만 계획하라. 막대기 제작은 판자 2개로 4개를 얻는다.');
  await runPlan('stone-tools','돌 장비 준비. 먼저 cobblestone 보유량 최소 13개를 채집한 다음 stone_pickaxe 1개, stone_sword 1개, furnace 1개를 제작하라. 조약돌 소비는 각각 3, 2, 8개이다. 이 네 단계만 계획하라.');
  await runPlan('fuel','제련 연료와 채광 조명 준비. coal 보유량 최소 12개를 채집한 다음 torch 보유량 최소 8개가 되도록 제작하라. 석탄 1개와 막대기 1개로 횃불 4개를 얻는다. 이 두 단계만 계획하라.');
  if(!count(await get('/observe'),'stone_pickaxe')&&!count(await get('/observe'),'iron_pickaxe'))await craft('stone_pickaxe');
  if(!count(await get('/observe'),'furnace')&&!(await actions('recover_furnace')).length)throw new Error('bootstrap_missing_furnace');
  await home();
  // Furnace goes outside, leaving the small room's only walking aisle clear.
  if(!(await actions('recover_furnace')).length){
  let sites=(await actions('place_furnace')).filter(a=>a.arguments.x===17&&Math.abs(a.arguments.z-234)<=1);if(!sites.length){const s=await get('/observe');await act((await actions('move_to')).filter(a=>a.arguments.x>s.player.position.x),'approach-furnace-site');sites=(await actions('place_furnace')).filter(a=>a.arguments.x===17&&Math.abs(a.arguments.z-234)<=1);}
  await act(sites,'place-furnace');
  }
  if(!count(await get('/observe'),'iron_pickaxe')){
  if(count(await get('/observe'),'stick')<3){if(count(await get('/observe'),'oak_planks')<2){await post('/storage-plan',{keep:{},withdraw:{oak_planks:2}});await act((await actions('withdraw_item')).filter(a=>a.arguments.item==='oak_planks'),'retrieve-stick-wood');await home();}await act((await actions('craft_item')).filter(a=>a.arguments.item==='stick'),'craft-tool-sticks');}
  const ingots=count(await get('/observe'),'iron_ingot');await gather('raw_iron',Math.max(0,3-ingots));await home();
  // The furnace is reachable from the outside entry; use its observed action position.
  if(count(await get('/observe'),'iron_ingot')<3)await smelt();await craft('iron_pickaxe');
  }
  const accepted=report.plans.findLast(p=>['shield','iron_chestplate','iron_leggings','iron_helmet','iron_boots','iron_sword'].every(name=>p.steps.some(s=>s.item===name)));
  const finalPlan=accepted??await qwen.taskPlan(await get('/observe'),{user_goal:'철 장비 완성 단계의 제작 계획만 작성하라: iron_sword 1, iron_chestplate 1, iron_leggings 1, iron_helmet 1, iron_boots 1, shield 1. 안전을 위해 철검과 방어구 4개를 먼저 제작하고 shield는 반드시 마지막 단계에 넣어라. 철 곡괭이는 이미 있으므로 추가 제작하지 않는다. 철 27개를 제련한 뒤 먼저 철 장비를 착용하고, oak_planks 6개를 모아 마지막으로 방패를 만든다. collect 단계를 넣지 말고 craft 단계만 작성하라.'});if(!accepted){report.plans.push(finalPlan);await chat.sayModel(finalPlan);}
  const kitNames=['shield','iron_chestplate','iron_leggings','iron_helmet','iron_boots','iron_sword'];
  if(finalPlan.steps.some(s=>s.method!=='craft'||![...kitNames,'iron_ingot'].includes(s.item)||s.count!==(s.item==='iron_ingot'?27:1))||!kitNames.every(name=>finalPlan.steps.some(s=>s.item===name&&s.count===1)))throw new Error('incomplete_iron_equipment_plan');
  const ironCosts={shield:1,iron_chestplate:8,iron_leggings:7,iron_helmet:5,iron_boots:4,iron_sword:2};
  const kitState=await get('/observe'),neededIron=Object.entries(ironCosts).reduce((n,[name,cost])=>n+(count(kitState,name)>0?0:cost),0);
  await gather('raw_iron',Math.max(0,neededIron-count(kitState,'iron_ingot')));await gather('coal',4);await home();
  while(count(await get('/observe'),'iron_ingot')<neededIron){if(!count(await get('/observe'),'coal'))await gather('coal',2);await home();await smelt();}
  await home();for(const step of finalPlan.steps.filter(s=>!['shield','iron_ingot'].includes(s.item)))await craft(step.item);
  for(let n=0;n<5;n++){const available=await actions('equip_gear');if(!available.length)break;await act(available,'equip-before-wood-gathering');}
  if(count(await get('/observe'),'oak_planks')<6){await gather('oak_log',2);while(count(await get('/observe'),'oak_planks')<6)await act((await actions('craft_item')).filter(a=>a.arguments.item==='oak_planks'),'craft-shield-wood');await home();}
  await craft('shield');
  for(let n=0;n<6;n++){const available=await actions('equip_gear');if(!available.length)break;await act(available,'equip-iron-gear');}
  await home();report.final=await get('/observe');
  for(let n=0;n<8;n++){const repair=await actions('repair_light_support'),lights=repair.length?repair:await actions('place_torch');if(!lights.length)break;await act(lights,'restore-home-light');}report.final=await get('/observe');
  const hand=(await actions('equip_gear')).filter(a=>a.arguments.item==='iron_sword'&&a.arguments.destination==='hand');if(hand.length)await act(hand,'ready-iron-sword');report.final=await get('/observe');
  if(!['iron_pickaxe','iron_sword','shield','iron_chestplate','iron_leggings','iron_helmet','iron_boots'].every(name=>count(report.final,name)>=1))throw new Error('equipment_verification_failed');
  report.status='success';await chat.say('철검·철 곡괭이·방패와 철 방어구 4부위를 마련하고 착용 상태를 확인했습니다. 집 안에서 대기합니다.');
}catch(error){report.status='failure';report.error=error.message;console.error(error);await home().catch(()=>{});process.exitCode=1;}
finally{await chat.pending;report.recording=await recording.stop(report.status).catch(error=>({error:error.message}));await post('/goal',{goal:null,expected_goal:goal}).catch(()=>{});report.finished=new Date().toISOString();await persist();}
