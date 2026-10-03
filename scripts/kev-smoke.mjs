import {jsonRequest} from '../models/http.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const provenance=JSON.parse(await readFile('.runtime/kev-model.json','utf8'));
process.env.KEV_REVISION=provenance.model_revision;
const card=await jsonRequest(`${process.env.KEV_BASE_URL??'http://127.0.0.1:18008'}/v1/models`);
const model=card.models?.[0];
if(!model?.run?.endsWith(`@${provenance.model_revision}`))throw new Error('unexpected_kev_revision');
process.env.KEV_DEVICE=model.device;process.env.KEV_DTYPE=model.dtype;
const policy=new KevPolicy();
const decision=await policy.decide({player:{health:20,food:20},goal:null},[{id:'wait',skill:'wait',arguments:{duration_ms:250}},
  {id:'move:2:64:0',skill:'move_to',arguments:{x:2,y:64,z:0}}]);
console.log({model_card:model,decision});
await writeFile('.runtime/kev-smoke.json',JSON.stringify({model_card:model,decision},null,2));
