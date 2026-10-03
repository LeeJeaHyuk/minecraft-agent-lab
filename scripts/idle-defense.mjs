import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,open,unlink,appendFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {jsonRequest} from '../models/http.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {actionState} from '../planners/action-state.mjs';
import {hostileNames,shouldWakeForDamage} from '../environment/combat.mjs';
import {TaskRecording} from '../recording/obs.mjs';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,kev=new KevPolicy();
const get=path=>jsonRequest(base+path),post=(path,body)=>jsonRequest(base+path,{body,timeoutMs:240000});
await mkdir('.runtime',{recursive:true});
try{const pid=Number(await readFile('.runtime/idle-defense.lock','utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error('invalid_watcher_lock');try{process.kill(pid,0);throw new Error('watcher_already_running');}catch(error){if(error.code!=='ESRCH')throw error;await unlink('.runtime/idle-defense.lock');}}catch(error){if(error.code!=='ENOENT')throw error;}
const lock=await open('.runtime/idle-defense.lock','wx');await lock.writeFile(String(process.pid));await lock.close();
let running=true,seen=0;
let lastHomeAttempt=0;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{running=false;});
const event=async(type,data={})=>{const row={time:new Date().toISOString(),type,...data};console.log(JSON.stringify(row));await appendFile('.runtime/idle-defense-events.jsonl',JSON.stringify(row)+'\n');};
const nearbyThreats=state=>state.nearby_entities.filter(e=>hostileNames.has(e.name)&&Math.hypot(e.position.x-state.player.position.x,e.position.y-state.player.position.y,e.position.z-state.player.position.z)<7);
async function defend(initial){
  const token=`idle-defense:${randomUUID()}`;await post('/idle-defense',{token});seen=initial.last_damage.time;
  const report={started:new Date().toISOString(),trigger:initial.last_damage,actions:[],status:'timeout'};
  const recording=new TaskRecording({handleSignals:false,onEvent:(type,data)=>console.log(JSON.stringify({type,...data}))});
  try{
    await event('defense_started',{token,damage:initial.last_damage});
    await recording.start('대기 중 피해 감지: Kev 방어·회피').catch(error=>event('recording_error',{error:error.message}));
    await post('/announce',{text:'피해를 감지했습니다. 대기 상태에서 방어·회피를 시작합니다.'}).catch(()=>{});
    const deadline=Date.now()+60000;
    while(running&&Date.now()<deadline){
      const state=await get('/observe');
      if(state.dead||!state.connected){report.status='disconnected_or_dead';break;}
      if(state.goal!==token){report.status='superseded';break;}
      const threats=nearbyThreats(state);
      const sheltered=state.home?.ready&&state.home.at_home&&!state.home.door_open;
      if(sheltered&&Date.now()-state.last_damage.time>5000){report.status='sheltered';break;}
      if(report.actions.length&&threats.length===0&&Date.now()-state.last_damage.time>5000){report.status='quiet';break;}
      let allowed=(await get('/actions')).filter(a=>['attack_entity','move_to','return_home'].includes(a.skill));
      if(state.home?.ready&&!state.home.at_home&&allowed.some(a=>a.skill==='return_home'))allowed=allowed.filter(a=>a.skill==='return_home');
      else allowed=allowed.filter(a=>a.skill!=='return_home');
      if(state.player.health<=6||threats.some(e=>e.name==='creeper'))allowed=allowed.filter(a=>['move_to','return_home'].includes(a.skill));
      if(!allowed.length)allowed=(await get('/actions')).filter(a=>a.skill==='wait');
      if(sheltered)allowed=(await get('/actions')).filter(a=>a.skill==='wait');
      if(!allowed.length){await delay(350);continue;}
      const context={...actionState(state,null,'idle-defense'),goal:'Survive incoming attacks. Defend against nearby hostiles or retreat; avoid creepers.',threats};
      const decision=await kev.decide(context,allowed);
      if(!running)break;
      const result=await post('/act',{expected_goal:token,action_id:decision.action,decision,decision_context:{state:context,available_actions:allowed},policy_name:'kev'});
      report.actions.push({decision,result});await event('defense_action',{action:decision.action,status:result.status});
      if(report.actions.length===1&&result.status==='success'){
        const selected=allowed.find(a=>a.id===decision.action),labels={wait:'대기',return_home:'집으로 복귀',move_to:'가까운 위치로 회피',attack_entity:'가까운 몬스터에 대응'};
        await post('/announce',{text:`행동 선택: ${labels[selected.skill]??selected.skill}. 실행을 확인했습니다.`,source:'kev',model:decision.model_name}).catch(()=>{});
      }
      await delay(350);
    }
    if(!running)report.status='interrupted';
  }catch(error){report.status='failure';report.error=error.message;await event('defense_error',{error:error.message});}
  finally{
    report.recording=await recording.stop(report.status).catch(error=>({error:error.message}));
    await post('/idle-defense',{token,release:true}).catch(()=>{});
    report.finished=new Date().toISOString();await writeFile('.runtime/idle-defense-latest.json',JSON.stringify(report,null,2));
    await event('defense_finished',{status:report.status,actions:report.actions.length});
  }
}
async function returnHome(){
  lastHomeAttempt=Date.now();const token=`idle-defense:${randomUUID()}`;await post('/idle-defense',{token});
  try{
    const state=await get('/observe'),allowed=(await get('/actions')).filter(a=>a.skill==='return_home');
    if(state.goal!==token||!allowed.length)return;
    const context={...actionState(state,null,'idle-return-home'),goal:'Return to the lit house, close the entrance door and wait safely.'};
    const decision=await kev.decide(context,allowed);
    if(!running)return;
    const result=await post('/act',{expected_goal:token,action_id:decision.action,decision,decision_context:{state:context,available_actions:allowed},policy_name:'kev'});
    await event('idle_return_home',{status:result.status,error:result.error,home:result.result?.home});
    if(result.status==='success')await post('/announce',{text:'행동 선택: 집으로 복귀. 집 안에 도착해 문을 닫았습니다.',source:'kev',model:decision.model_name}).catch(()=>{});
  }finally{await post('/idle-defense',{token,release:true}).catch(()=>{});}
}
try{
  await event('watcher_ready',{pid:process.pid});
  while(running){
    try{const state=await get('/observe');if(shouldWakeForDamage(state,seen))await defend(state);
      else if(state.connected&&!state.dead&&!state.goal&&!state.current_action&&state.home?.ready&&(!state.home.at_home||state.home.door_open)&&Date.now()-lastHomeAttempt>15000)await returnHome();}
    catch(error){await event('watcher_error',{error:error.message});}
    await delay(750);
  }
}finally{await unlink('.runtime/idle-defense.lock');}
