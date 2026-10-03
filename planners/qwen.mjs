import {jsonRequest} from '../models/http.mjs';
export const publicSpeechInstruction='Include public_speech: a Korean first-person utterance of 1 to 3 connected sentences, at most 150 characters. In the SAME planning response explain the observed facts relevant to your choice, a brief decision rationale and the next intended action. Mention at least one concrete observed quantity or named material/tool when supplied. Avoid generic statements like everything is in place. Address the watching player naturally. This is an explicit public utterance, not hidden reasoning or a later narrator summary. Ground quantities in the supplied state; distinguish already verified results from intentions; do not invent actions, commands or probabilities. ';
export class QwenPlanner {
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl ?? process.env.QWEN_BASE_URL ?? '').replace(/\/$/, '');
    this.model = config.model ?? process.env.QWEN_MODEL;
    this.apiKey = config.apiKey ?? process.env.QWEN_API_KEY;
    this.timeoutMs = Number(config.timeoutMs ?? process.env.QWEN_TIMEOUT_MS ?? 20000);
    this.retries = Math.min(2, Math.max(0, Number(config.retries ?? process.env.QWEN_RETRIES ?? 1)));
    this.enableThinking = config.enableThinking ?? (process.env.QWEN_ENABLE_THINKING === undefined ? undefined : process.env.QWEN_ENABLE_THINKING === 'true');
  }
  async models() { return jsonRequest(`${this.baseUrl}/models`, {apiKey:this.apiKey, timeoutMs:this.timeoutMs}); }
  async generate(messages, maxTokens = 128) {
    if (!this.baseUrl || !this.model) throw new Error('qwen_not_configured');
    const started = performance.now();
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const data = await jsonRequest(`${this.baseUrl}/chat/completions`, {apiKey:this.apiKey, timeoutMs:this.timeoutMs,
          body:{model:this.model, messages, max_tokens:maxTokens, temperature:0, stream:false,
            ...(this.enableThinking === undefined ? {} : {chat_template_kwargs:{enable_thinking:this.enableThinking}})}});
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('malformed_response');
        return {content, model:data.model, latency_ms:Math.round(performance.now()-started), usage:data.usage};
      } catch (error) {
        if (attempt === this.retries || /http_4|malformed/.test(error.message)) throw error;
      }
    }
  }
  async plan(state, context = null) {
    const response = await this.generate([{role:'system',content:'Return a JSON object with goal and subgoal strings. This is a connectivity test only; do not execute tools.'},
      {role:'user',content:JSON.stringify({state, context})}]);
    let parsed; try { parsed = JSON.parse(response.content); } catch { throw new Error('malformed_response'); }
    if (typeof parsed.goal !== 'string' || typeof parsed.subgoal !== 'string') throw new Error('malformed_response');
    return {...response, goal:parsed.goal, subgoal:parsed.subgoal};
  }
  async taskPlan(state,context){
    const response=await this.generate([{role:'system',content:
      publicSpeechInstruction+'You manage short Minecraft goals. Return only JSON: {"public_speech":"...","goal":"...","steps":[{"subgoal":"...","method":"collect or craft","item":"exact_minecraft_item_name","count":1}]}. '+
      'context.user_goal is authoritative. Ignore any older state.goal or state.subgoal. Use 1 to 10 ordered steps, respecting a requested step count. count is the minimum inventory count at completion of that step, between 1 and 64. '+
      'Earlier materials may be consumed by later steps. Include missing prerequisites for crafting. '+
      'Use observed resource_blocks and inventory, not invented resources or coordinates. Block/item identifiers must exist in Minecraft; planks names end in _planks (plural). Skills can approach/mine/collect a nearby loaded block and craft one available recipe. '+
      'Inventory crafting and a nearby crafting table are supported. The runner can place an existing inventory crafting table for tools. Do not plan exploration, combat or arbitrary code. '+
      'If context.accepted_steps exists, retain its method/item/count and order, and refine only subgoal wording. Do not claim an action has happened.'},
      {role:'user',content:JSON.stringify({state,context})}],768);
    let parsed;try{parsed=parseModelJson(response.content);}catch{throw new Error('malformed_plan');}
    return {...response,...validateTaskPlan(parsed)};
  }
  async buildingPlan(state,sites,context){
    const response=await this.generate([{role:'system',content:
      publicSpeechInstruction+'You autonomously design an attractive SMALL one-room Minecraft house from the observed state. Return JSON only with public_speech, goal, steps, blueprint. '+
      'steps is an array of inventory prerequisites: {subgoal,method:"collect" or "craft",item:exact item name,count:1..64}. count is the minimum TOTAL inventory at step completion, NOT an additional amount. '+
      'blueprint is {site_id:one provided site id,material:default block name,description:string,cuboids:[{from:[x,y,z],to:[x,y,z],material:block name}],openings:[[x,1,z],[x,2,z]]}. '+
      'Coordinates are RELATIVE to the site origin, not world coordinates. Cuboids are inclusive. Choose the provided 3x3 or 4x4 size. '+
      'Prefer the largest provided size. Design a full floor at y=0, perimeter walls at y=1,2, and full roof at y=3. Optional raised roof detailing at y=4 is supported. Keep the room interior empty. '+
      'Use up to 24 cuboids. Later cuboids override earlier materials in overlapping cells. Openings remove exactly two blocks forming a 1x2 doorway on a wall, not a corner. '+
      'Allowed full blocks: oak_planks, oak_log, oak_wood, birch_planks, birch_log, cobblestone, granite, diorite, polished_granite, polished_diorite, dirt. Use at least THREE distinct materials, contrasting wall panels, corner pillars, foundation and roof. Avoid dirt for this aesthetic goal. '+
      'A 3x3 shell needs 32 blocks, a 4x4 shell needs 54. Plan enough material inventory before building, accounting for existing items. '+
      'Use up to 10 ordered inventory steps. Plan cumulative inventory BEFORE building for EVERY material, accounting for all overlapping cuboids and later crafting consumption. '+
      'Stone/cobblestone/granite/diorite collection REQUIRES a wooden or better pickaxe. An existing inventory crafting_table can be placed automatically by the runner. Wooden pickaxe costs 3 planks and 2 sticks; a stone pickaxe costs 3 cobblestone and 2 sticks. Logs yield 4 planks each. Oak_wood costs 4 logs and yields 3. Polished stone costs 4 unpolished and yields 4. '+
      'For planks, collect enough observed logs then craft enough oak_planks. For dirt, collect dirt (grass_block also drops dirt). '+
      'There is no smelting or glass yet, teleport, item grant or arbitrary code. You choose site, material palette and cuboid layout; the executor places individual blocks.'},
      {role:'user',content:JSON.stringify({state,sites,context})}],2400);
    let parsed;try{parsed=parseModelJson(response.content);}catch{const error=new Error('malformed_build_plan');error.response=response;throw error;}
    const validated=validateTaskPlan(parsed);if(!parsed.blueprint)throw new Error('missing_blueprint');
    return {...response,...validated,blueprint:parsed.blueprint};
  }
  async storagePlan(state,context){
    const response=await this.generate([{role:'system',content:publicSpeechInstruction+
      'Return only JSON {"keep":{exact_item_name:count},"public_speech":"..."}. Store building materials, spare crafting tables and miscellaneous items in a chest. Keep one available pickaxe for work. Reserve counts are 0..64. If context.verified_storage exists, acknowledge its verified result and wait for the next goal; do not propose repeating completed crafting or transfers.'},
      {role:'user',content:JSON.stringify({state,context})}],512);
    const parsed=parseModelJson(response.content);
    if(!parsed.keep||typeof parsed.keep!=='object'||Array.isArray(parsed.keep)||!Object.entries(parsed.keep).every(([name,count])=>/^[a-z][a-z0-9_]*$/.test(name)&&Number.isInteger(count)&&count>=0&&count<=64))throw new Error('invalid_storage_plan');
    return {...response,keep:parsed.keep,public_speech:validatePublicSpeech(parsed.public_speech)};
  }
}
export function validatePublicSpeech(text){
  if(typeof text!=='string'||!text.trim()||text.length>150||/[\x00-\x1f\x7f]/.test(text)||text.trim().startsWith('/'))throw new Error('invalid_public_speech');
  return text;
}
export function parseModelJson(content){
  const text=content.trim(),fenced=text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?fenced[1]:text);
}
export function validateTaskPlan(plan){
  if(typeof plan?.goal!=='string'||!Array.isArray(plan.steps)||plan.steps.length<1||plan.steps.length>10)throw new Error('invalid_plan');
  for(const step of plan.steps)if(typeof step.subgoal!=='string'||!['collect','craft'].includes(step.method)||
    !/^[a-z][a-z0-9_]*$/.test(step.item)||!Number.isInteger(step.count)||step.count<1||step.count>64)throw new Error('invalid_plan');
  return {goal:plan.goal,steps:plan.steps.map(({subgoal,method,item,count})=>({subgoal,method,item,count})),...(plan.public_speech===undefined?{}:{public_speech:validatePublicSpeech(plan.public_speech)})};
}
