import {QwenPlanner} from '../planners/qwen.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {jsonRequest} from '../models/http.mjs';
const planner=new QwenPlanner();
const models=await planner.models();console.log({available_models:models.data?.map(m=>m.id)});
const chat=await planner.generate([{role:'user',content:'Reply with OK only.'}],16);console.log(chat);
const useMinecraft=process.argv.includes('--minecraft');
let state={connected:false,player:null,available_actions:['wait']};
if(useMinecraft){
  const base=`http://127.0.0.1:${process.env.API_PORT??18765}`;
  state={...await jsonRequest(`${base}/observe`),available_actions:await jsonRequest(`${base}/actions`)};
  if(!state.connected)throw new Error('minecraft_not_ready');
}
const structured=await planner.plan(state,'Adapter smoke test; do not execute or apply the returned goal');console.log(structured);
await mkdir('.runtime',{recursive:true});
await writeFile(`.runtime/qwen-smoke-${planner.model.replace(/[^a-zA-Z0-9_-]/g,'_')}${useMinecraft?'-minecraft':''}.json`,JSON.stringify({model:planner.model,state,chat,structured},null,2));
