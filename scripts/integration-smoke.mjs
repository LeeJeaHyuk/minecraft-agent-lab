import {jsonRequest} from '../models/http.mjs';
import {RandomPolicy,ManualPolicy,KevPolicy} from '../policies/index.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`,rows=[];
async function check(name,run){const result=await run();rows.push({name,pass:true,result});console.log(name,result);}
async function ready(){for(let i=0;i<90;i++){const health=await jsonRequest(`${base}/health`);if(health.minecraft_connected)return;await delay(1000);}throw new Error('minecraft_connect_timeout');}
try{
  await ready();
  await check('observe',async()=>{const state=await jsonRequest(`${base}/observe`);assert.equal(state.connected,true);assert.equal(state.player.health,20);return {player:state.player,blocks:state.nearby_blocks.length};});
  await check('bounded_actions',async()=>{const a=await jsonRequest(`${base}/actions`);assert(a.some(a=>a.id==='wait'));return a;});
  await check('invalid_action',async()=>{const r=await jsonRequest(`${base}/act`,{body:{action_id:'eval',arguments:{code:'anything'}}});assert.equal(r.error,'invalid_action');return r;});
  await check('manual_goal',async()=>{await jsonRequest(`${base}/goal`,{body:{goal:'Observe the current environment',subgoal:null}});assert.equal((await jsonRequest(`${base}/observe`)).goal,'Observe the current environment');return true;});
  for(const policy of [new RandomPolicy(()=>0),new ManualPolicy(()=> 'wait'),...(process.argv.includes('--kev')?[new KevPolicy()]:[])]){
    await check(`${policy.name}_actual_execution`,async()=>{
      const results=[];for(let i=0;i<3;i++){
        const state=await jsonRequest(`${base}/observe`),actions=await jsonRequest(`${base}/actions`),decision=await policy.decide(state,actions);
        const result=await jsonRequest(`${base}/act`,{body:{action_id:decision.action,decision,policy_name:policy.name,decision_context:{state,available_actions:actions}},timeoutMs:240000});
        assert.equal(result.status,'success');results.push({decision,result});
      }return results;
    });
  }
  await check('bot_reset_reconnect',async()=>{const reset=await jsonRequest(`${base}/reset`,{body:{}});await ready();return reset;});
}catch(error){rows.push({name:'failure',pass:false,error:error.message});process.exitCode=1;console.error(error);}
finally{await mkdir('.runtime',{recursive:true});await writeFile('.runtime/integration-smoke.json',JSON.stringify(rows,null,2));}
