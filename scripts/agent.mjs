import {createInterface} from 'node:readline/promises';
import {jsonRequest} from '../models/http.mjs';
import {RandomPolicy,ManualPolicy,KevPolicy,validateDecision} from '../policies/index.mjs';
const mode=process.argv[2]??'manual',steps=Number(process.argv[3]??10),url=`http://127.0.0.1:${process.env.API_PORT??18765}`;
const cli=createInterface({input:process.stdin,output:process.stdout});
const policy=mode==='kev'?new KevPolicy():mode==='random'?new RandomPolicy():new ManualPolicy(async(state,actions)=>{
  console.log(actions.map((a,i)=>`${i}: ${a.id}`).join('\n'));const selected=Number(await cli.question('Action index: '));return actions[selected]?.id;
});
try{
  if(process.env.AGENT_GOAL)await jsonRequest(`${url}/goal`,{body:{goal:process.env.AGENT_GOAL}});
  for(let i=0;i<steps;i++){
    const state=await jsonRequest(`${url}/observe`),actions=await jsonRequest(`${url}/actions`);
    if(!state.connected || !actions.length)throw new Error('environment_not_ready');
    const started=performance.now();let decision;
    try{decision=validateDecision(await policy.decide(state,actions),actions);}
    catch(error){await jsonRequest(`${url}/decision-error`,{body:{decision_context:{state,available_actions:actions},policy_name:policy.name,
      model_name:policy.model??null,model_revision:policy.revision??null,latency_ms:Math.round(performance.now()-started),error:error.message}});throw error;}
    console.log(`Goal: ${state.goal??'(unset)'}\nPolicy: ${policy.name}`);
    console.table(Object.entries(decision.probabilities).sort((a,b)=>b[1]-a[1]).map(([action,probability])=>({action,probability})));
    console.log(`Selected: ${decision.action}\nDecision latency: ${decision.latency_ms} ms\nQwen planner: not invoked`);
    const result=await jsonRequest(`${url}/act`,{timeoutMs:240000,body:{action_id:decision.action,decision,policy_name:policy.name,decision_context:{state,available_actions:actions}}});
    console.log(`Action: ${result.status} / ${result.duration_ms} ms${result.error?` / ${result.error}`:''}\nTrajectory: ${result.run_id} step ${result.step}`);
  }
}finally{cli.close();}
