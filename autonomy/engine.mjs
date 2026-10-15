import {validatePlan,conditionsMet,stepCandidates,canonical} from './contracts.mjs';
const progress=s=>canonical({inventory:s.state.inventory?.map(({name,count})=>({name,count})),equipment:s.state.equipment,position:s.state.player?.position,construction:s.construction?.matched_blocks,corridor:s.corridor?.matched_blocks});
export class AutonomousEngine{
  constructor({planner,policy,transport,onEvent=async()=>{},maxActions=240,maxReplans=40,maxPlanningFailures=3,reviewEvery=5,maxDurationMs=1800000}){
    Object.assign(this,{planner,policy,transport,onEvent,maxActions,maxReplans,maxPlanningFailures,reviewEvery,maxDurationMs});this.cancelled=false;
  }
  cancel(){this.cancelled=true;}
  async run(goal,checkpoint={}){
    const record={goal,status:'running',objectives:checkpoint.objectives??null,receipts:checkpoint.receipts??{},history:checkpoint.history??[],action_count:checkpoint.action_count??0,replans:0};
    const started=Date.now();let plan=null,index=0,sinceReview=0,stalls=0,planningFailures=0,feedback='initial_goal';
    const emit=async(type,data={})=>this.onEvent(type,{...data,checkpoint:record});
    try{
      while(!this.cancelled){
        if(Date.now()-started>this.maxDurationMs)throw Error('task_time_limit');
        const snapshot=await this.transport.snapshot();
        if(!snapshot.state.connected)throw Error('minecraft_disconnected');
        if(!plan){
          if(record.replans>=this.maxReplans)throw Error('replan_limit');
          record.replans++;await emit('planning',{reason:feedback});
          try{
            plan=validatePlan(await this.planner.autonomousPlan(snapshot,{user_goal:goal,objectives:record.objectives,receipts:record.receipts,recent_history:record.history.slice(-8),feedback}),snapshot.capabilities,record.objectives);
            record.objectives??=plan.objectives;planningFailures=0;
          }catch(error){plan=null;feedback=`planner_rejected:${error.message}`;await emit('plan_rejected',{error:error.message});if(++planningFailures>=this.maxPlanningFailures)throw Error('planner_unavailable_or_invalid');continue;}
          index=0;sinceReview=0;stalls=0;await emit('plan_accepted',{plan});
          if(this.cancelled)break;
          await this.transport.announce?.(plan.public_speech,'qwen');
          if(plan.status==='blocked'){record.reason=plan.summary;record.status='blocked';break;}
          if(plan.status==='complete'){
            if(conditionsMet(record.objectives,snapshot)){record.status='succeeded';record.evidence=record.objectives;break;}
            feedback='completion_rejected:actual_conditions_not_met';plan=null;continue;
          }
        }
        if(snapshot.state.dead){feedback='bot_died:reassess_recovery_and_equipment';plan=null;await this.transport.wait?.(1000);continue;}
        const step=plan.steps[index];
        if(!step){feedback='steps_exhausted:review_original_objectives';plan=null;continue;}
        if(step.kind==='act'&&conditionsMet(step.until,snapshot)){await emit('step_complete',{step:step.id});index++;continue;}
        if(step.kind!=='act'){
          if(this.cancelled)break;
          const hash=canonical(step),receipt=record.receipts[step.id];
          if(receipt){if(receipt.hash!==hash){feedback='operation_id_reused_with_changed_payload';plan=null;continue;}index++;continue;}
          try{const result=await this.transport.operation(step,snapshot);record.receipts[step.id]={hash,result};await emit('operation_complete',{step:step.id,result});index++;feedback='operation_completed:review_material_requirements';plan=null;}
          catch(error){feedback=`operation_failed:${step.id}:${error.message}`;record.history.push({step:step.id,error:feedback});plan=null;await emit('operation_failed',{step:step.id,error:error.message});}
          continue;
        }
        const allowed=stepCandidates(step,snapshot.actions);
        if(!allowed.length){feedback=`no_feasible_actions:${step.id}:change prerequisites, targets or exploration strategy`;plan=null;continue;}
        if(snapshot.state.player.health<=8&&allowed.some(a=>!['wait','eat_food','equip_gear','return_home','enter_home','inspect_chest','withdraw_item','recover_furnace'].includes(a.skill))){feedback='unsafe_low_health:recover_or_shelter_before_outdoor_work';plan=null;continue;}
        if(record.action_count>=this.maxActions)throw Error('task_action_limit');
        let decision,result;
        try{
          const decisionState={goal,subgoal:step.subgoal,plan_summary:plan.summary,player:snapshot.state.player,equipment:snapshot.state.equipment,inventory:snapshot.state.inventory,nearby_entities:snapshot.state.nearby_entities,recent_failures:record.history.slice(-3)};
          decision=await this.policy.decide(decisionState,allowed);
          if(this.cancelled)break;
          await emit('acting',{step:step.id,decision,decision_state:decisionState});result=await this.transport.act(decision,allowed,step,decisionState);
        }catch(error){result={status:'failure',error:error.message};}
        record.action_count++;sinceReview++;
        const after=await this.transport.snapshot();
        const row={step:step.id,action:decision?.action,result:{status:result.status,error:result.error,details:result.error_details,safety:result.result?.safety?.map(e=>e.type)}};
        record.history.push(row);record.history=record.history.slice(-40);await emit('action_result',{...row,decision,result});
        stalls=progress(snapshot)===progress(after)?stalls+1:0;
        if(result.status!=='success'||stalls>=3||sinceReview>=this.reviewEvery){feedback=result.status!=='success'?`action_failed:${result.error}:${result.error_details??''}`:stalls>=3?'no_observed_progress:change strategy':'periodic_progress_review';plan=null;}
      }
      if(this.cancelled)record.status='cancelled';
    }catch(error){record.status='blocked';record.reason=error.message;await emit('task_error',{error:error.message});}
    await emit('task_finished',{status:record.status,reason:record.reason});return record;
  }
}
