import {jsonRequest} from '../models/http.mjs';
import {readFileSync} from 'node:fs';
export function validateDecision(decision, actions) {
  const ids = actions.map(a => a.id), probs = decision.probabilities;
  if (!ids.includes(decision.action) || !probs || Object.keys(probs).length !== ids.length ||
      !ids.every(id => Number.isFinite(probs[id]) && probs[id] >= 0 && probs[id] <= 1) ||
      Math.abs(Object.values(probs).reduce((a,b)=>a+b,0)-1) > 0.001) throw new Error('invalid_policy_output');
  return decision;
}
export class RandomPolicy {
  constructor(random = Math.random) { this.random = random; this.name = 'random'; }
  async decide(state, actions) {
    if (!actions.length) throw new Error('no_available_actions');
    return {action:actions[Math.floor(this.random()*actions.length)].id,
      probabilities:Object.fromEntries(actions.map(a=>[a.id,1/actions.length])), latency_ms:0};
  }
}
export class ManualPolicy {
  constructor(select) { this.select = select; this.name = 'manual'; }
  async decide(state, actions) {
    const action = await this.select(state, actions);
    return validateDecision({action, probabilities:Object.fromEntries(actions.map(a=>[a.id,Number(a.id===action)])),latency_ms:0}, actions);
  }
}
export class KevPolicy {
  constructor(config = {}) {
    this.name = 'kev'; this.url = config.baseUrl ?? process.env.KEV_BASE_URL ?? 'http://127.0.0.1:18008';
    this.apiKey = config.apiKey ?? process.env.KEV_API_KEY;
    this.timeoutMs=config.timeoutMs??60000;
    this.model = process.env.KEV_MODEL ?? 'jaredpalmer/kev-4b'; this.revision = config.revision ?? process.env.KEV_REVISION ?? null;
    if(!this.revision){try{this.revision=JSON.parse(readFileSync('.runtime/kev-model.json','utf8')).model_revision;}catch{}}
    this.card=null;
  }
  async decide(state, actions) {
    if (!actions.length || actions.length > 255) throw new Error('invalid_candidate_count');
    if(!this.revision)throw new Error('kev_revision_not_configured');
    if(!this.card){
      const metadata=await jsonRequest(`${this.url}/v1/models`,{apiKey:this.apiKey,timeoutMs:10000});
      const card=metadata.models?.[0];
      if(!card?.run?.endsWith(`@${this.revision}`) || !card.run.startsWith(`${this.model}@`))throw new Error('unexpected_kev_revision');
      this.card=card;
    }
    const started = performance.now();
    const data = await jsonRequest(`${this.url}/v1/systemone`, {apiKey:this.apiKey,timeoutMs:this.timeoutMs, body:{model:'kev-latest',state,
      questions:{action:{type:'choice',instructions:'Choose the next allowed Minecraft action given the state and optional goal.',
        criteria:Object.fromEntries(actions.map(a=>[a.id,`${a.skill}: ${JSON.stringify(a.arguments)}`]))}}}});
    const answer = data.answers?.action;
    return validateDecision({action:answer?.choice, probabilities:answer?.probabilities,latency_ms:Math.round(performance.now()-started),
      model_name:this.model,model_revision:this.revision,device:this.card.device,dtype:this.card.dtype,
      quantization:null,input_token_count:data.usage?.input_tokens ?? null,server_latency_ms:data.latency_ms ?? null}, actions);
  }
}
