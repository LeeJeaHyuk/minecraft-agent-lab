import {setTimeout as delay} from 'node:timers/promises';
import {jsonRequest} from '../models/http.mjs';
import {validatePublicSpeech} from './qwen.mjs';
const names={oak_log:'참나무 통나무',oak_planks:'참나무 판자',oak_wood:'참나무 원목',birch_log:'자작나무 통나무',birch_planks:'자작나무 판자',cobblestone:'조약돌',dirt:'흙',granite:'화강암',diorite:'섬록암',wooden_pickaxe:'나무 곡괭이',stone_pickaxe:'돌 곡괭이',crafting_table:'작업대',stick:'막대기'};
export const itemLabel=item=>names[item]??item;
// Public goals and progress only; no raw reasoning, prompts or model responses.
export class ProgressChat{
  constructor(base,{enabled=process.env.MC_CHAT_PROGRESS!=='false',send=null,onError=()=>{}}={}){
    this.enabled=enabled;this.send=send??((text,metadata)=>jsonRequest(`${base}/announce`,{body:{text,...metadata}}));
    this.onError=onError;this.pending=Promise.resolve();this.lastSent=0;this.lastText=null;
  }
  say(text,{source='system',model=null}={}){
    const key=JSON.stringify({text,source,model});
    if(!this.enabled||key===this.lastText)return this.pending;
    this.lastText=key;
    this.pending=this.pending.then(async()=>{
      const wait=Math.max(0,2100-(Date.now()-this.lastSent));if(wait)await delay(wait);
      await this.send(text.slice(0,150),{source,model});this.lastSent=Date.now();
    }).catch(error=>this.onError(error));
    return this.pending;
  }
  sayModel(plan){
    if(plan?.public_speech===undefined)return this.pending;
    return this.say(validatePublicSpeech(plan.public_speech),{source:'qwen',model:plan.model??process.env.QWEN_MODEL??null});
  }
}
