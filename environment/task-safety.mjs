import {setTimeout as delay} from 'node:timers/promises';
import {appendFile,mkdir} from 'node:fs/promises';
import {KevPolicy} from '../policies/index.mjs';
import {visibleThreats,safetyActions,executeCombat,retreatThreat} from './combat.mjs';
import {executeHome,inspectHome} from './home.mjs';
import {equipment} from './equipment.mjs';
export async function resolveThreats(environment,assertActive){
  const bot=environment.bot,events=[],deadline=Date.now()+45000;
  environment.safetyPolicy??=new KevPolicy({timeoutMs:5000});bot.safetyCombatActive=true;
  environment.current={id:'safety',skill:'resolve_threats',arguments:{}};
  const log=async(type,data={})=>{const row={time:new Date().toISOString(),type,...data};events.push(row);if(environment.safetyLog){await environment.safetyLog(row);return;}await mkdir('.runtime',{recursive:true});await appendFile('.runtime/task-safety-events.jsonl',JSON.stringify(row)+'\n');};
  try{
    await log('safety_started',{goal:environment.goal});
    bot.chat('[시스템] 위협 대응을 우선합니다. 처리 후 중단된 작업을 다시 확인하겠습니다.');
    let quietSince=null;
    while(Date.now()<deadline){
      assertActive();if(bot.health<=0)throw Error('dead');
      const threats=visibleThreats(bot);
      if(!threats.length){quietSince??=Date.now();if(Date.now()-quietSince>=1500){await log('safety_clear');return events;}await delay(100);continue;}
      quietSince=null;
      const allowed=safetyActions(bot,threats,environment.home);
      const context={goal:'Resolve pursuing hostiles before resuming the suspended task. Attack with best sword and shield when healthy; retreat at low health or from creepers.',suspended_goal:environment.goal,health:bot.health,food:bot.food,equipment:equipment(bot),position:bot.entity.position,threats:threats.map(e=>({id:e.id,name:e.name,distance:e.position.distanceTo(bot.entity.position)}))};
      const decision=await environment.safetyPolicy.decide(context,allowed);assertActive();
      const action=allowed.find(a=>a.id===decision.action);
      bot.chat(`[Kev: kev-4b] ${action.skill==='attack_entity'?'무기를 전환해 몬스터를 처리하겠습니다.':'안전한 위치로 피하겠습니다.'}`);
      let timer;
      const execution=(async()=>{
        if(action.skill==='attack_entity')return executeCombat(bot,action,assertActive);
        if(action.skill==='return_home')return executeHome(bot,action,environment.home,assertActive);
        return retreatThreat(bot,action,assertActive);
      })();
      let cancelled=false;
      // Stop and settle the old motor operation before selecting another action.
      try{
        const result=await Promise.race([execution,new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;bot.pathfinder.setGoal(null);bot.stopDigging();reject(Error('safety_action_timeout'));},8000);})]);
        await log('safety_action',{decision,action,result});
      }catch(error){await log('safety_action_failed',{decision,action,error:error.message});}
      finally{clearTimeout(timer);if(cancelled)await execution.catch(()=>{});}
      assertActive();
      // A closed shelter is safe for waiting, but is not permission to resume an outside job with pursuers present.
      const home=inspectHome(bot,environment.home);
      if(bot.health<=8&&home?.at_home&&!home.door_open)throw Error('safety_low_health_sheltered');
    }
    throw Error('safety_unresolved');
  }finally{bot.safetyCombatActive=false;bot.deactivateItem();bot.pathfinder.setGoal(null);bot.clearControlStates();environment.current=null;}
}
