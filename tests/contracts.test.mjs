import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RandomPolicy,ManualPolicy,KevPolicy,validateDecision} from '../policies/index.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {Trajectory} from '../logging/trajectory.mjs';
import {MinecraftEnvironment} from '../environment/adapter.mjs';
import {worldSeed,propertiesForSeed} from '../environment/seed.mjs';
const actions=[{id:'wait',skill:'wait',arguments:{duration_ms:250}},{id:'move:2:0:0',skill:'move_to',arguments:{x:2,y:0,z:0}}];
test('Seed configuration stays exact and refuses to relabel an existing world',()=>{
  assert.equal(worldSeed('9223372036854775807'),'9223372036854775807');assert.equal(worldSeed('00042'),'42');
  assert.throws(()=>worldSeed('9223372036854775808'),/out_of_range/);assert.throws(()=>worldSeed(''),/signed_64/);
  assert.throws(()=>propertiesForSeed('level-seed=42\n','7',true),/reset_world_first/);
  assert.equal(propertiesForSeed('level-seed=42\n','7',false),'level-seed=7\n');
});
async function fakeServer(t,handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));return `http://127.0.0.1:${s.address().port}`;}
test('Random and manual policies select only supplied candidates',async()=>{
  assert.equal((await new RandomPolicy(()=>0.99).decide({},actions)).action,actions[1].id);
  assert.equal((await new ManualPolicy(()=>actions[0].id).decide({},actions)).probabilities.wait,1);
  await assert.rejects(new ManualPolicy(()=> 'eval').decide({},actions),/invalid_policy_output/);
});
test('Reject malformed distributions and unknown action',()=>{
  for(const d of [{action:'eval',probabilities:{wait:1}},{action:'wait',probabilities:{wait:0.5,'move:2:0:0':0.2}},
    {action:'wait',probabilities:{wait:NaN,'move:2:0:0':1}}])assert.throws(()=>validateDecision(d,actions));
});
test('Kev Choice request carries bound arguments, validates full distribution',async t=>{
  const baseUrl=await fakeServer(t,async(req,res)=>{
    if(req.url==='/v1/models'){res.end(JSON.stringify({models:[{run:'jaredpalmer/kev-4b@test',device:'cuda',dtype:'bf16'}]}));return;}
    let text='';for await(const c of req)text+=c;const body=JSON.parse(text);
    assert.equal(req.url,'/v1/systemone');assert.equal(body.questions.action.type,'choice');assert.deepEqual(Object.keys(body.questions.action.criteria),actions.map(a=>a.id));
    res.setHeader('content-type','application/json');res.end(JSON.stringify({answers:{action:{choice:'wait',probabilities:{wait:0.75,'move:2:0:0':0.25}}},usage:{input_tokens:42}}));});
  const decision=await new KevPolicy({baseUrl,revision:'test'}).decide({goal:null},actions);assert.equal(decision.action,'wait');assert.equal(decision.input_token_count,42);
});
test('Qwen handles structured response, malformed output and bounded retries',async t=>{
  let requests=0;const baseUrl=await fakeServer(t,(req,res)=>{requests++;res.setHeader('content-type','application/json');
    if(requests===1){res.writeHead(503);res.end('{}');}else res.end(JSON.stringify({model:'test',choices:[{message:{content:'{"goal":"test","subgoal":"wait"}'}}]}));});
  const planner=new QwenPlanner({baseUrl,model:'test',retries:1});assert.equal((await planner.plan({})).subgoal,'wait');assert.equal(requests,2);
  const badUrl=await fakeServer(t,(req,res)=>res.end('{broken'));await assert.rejects(new QwenPlanner({baseUrl:badUrl,model:'test'}).generate([]),/malformed_response/);
});
test('Qwen unavailable does not affect independent random policy',async()=>{
  const planner=new QwenPlanner({baseUrl:'http://127.0.0.1:1',model:'test',retries:0,timeoutMs:50});await assert.rejects(planner.generate([]));
  assert.equal((await new RandomPolicy(()=>0).decide({},actions)).action,'wait');
});
test('Trajectory persists failure and starts a separate episode',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mc-lab-'));try{const log=new Trajectory(dir);const first=await log.append({error:'dead',action_status:'failure'});log.newEpisode();
    const second=await log.append({error:null,action_status:'success'});assert.notEqual(first.episode_id,second.episode_id);assert.equal(second.step,0);
    const rows=(await readFile(`${dir}/${log.runId}.jsonl`,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows[0].error,'dead');assert.equal(rows[1].planner_model,null);
  }finally{await rm(dir,{recursive:true});}
});
test('Concurrent trajectory appends preserve step order on disk',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mc-lab-order-'));try{
    const log=new Trajectory(dir);await Promise.all(Array.from({length:10},(_,index)=>log.append({selected_action:`test:${index}`})));
    const rows=(await readFile(`${dir}/${log.runId}.jsonl`,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(r=>r.step),Array.from({length:10},(_,i)=>i));
  }finally{await rm(dir,{recursive:true});}
});
test('Environment rejects arbitrary action and serializes execution',async()=>{
  const env=new MinecraftEnvironment();assert.equal((await env.act('eval')).error,'disconnected');env.ready=true;env.actions=()=>actions;
  env.bot={pathfinder:{stop(){}},stopDigging(){}};
  assert.equal((await env.act('eval')).error,'invalid_action');assert.equal((await env.act('wait',{duration_ms:999999})).error,'invalid_action');
  const first=env.act('wait');assert.equal((await env.act('wait')).error,'busy');assert.equal((await first).status,'success');env.dead=true;assert.equal((await env.act('wait')).error,'dead');
});
test('Death interrupts a pending action and clears the action lock',async()=>{
  const env=new MinecraftEnvironment();env.ready=true;env.actions=()=>actions;
  const pending=env.act('wait');env.dead=true;env.ready=false;env.generation++;
  assert.equal((await pending).error,'dead');assert.equal(env.current,null);
  env.dead=false;env.ready=true;const afterRespawn=env.act('wait');env.deathCount++;env.generation++;
  assert.equal((await afterRespawn).error,'dead');assert.equal(env.current,null);
});
test('Timeout cancels skills and returns a structured failure',async()=>{
  const previous=process.env.ACTION_TIMEOUT_MS;process.env.ACTION_TIMEOUT_MS='20';
  try{
    const env=new MinecraftEnvironment();env.ready=true;env.actions=()=>actions;let stopped=0;
    env.bot={pathfinder:{stop(){stopped++;}},stopDigging(){stopped++;}};
    const result=await env.act('wait');assert.equal(result.status,'failure');assert.equal(result.error,'timeout');assert.equal(stopped,2);assert.equal(env.current,null);
  }finally{if(previous===undefined)delete process.env.ACTION_TIMEOUT_MS;else process.env.ACTION_TIMEOUT_MS=previous;}
});
