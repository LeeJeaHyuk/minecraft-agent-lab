import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutonomousTasks} from '../autonomy/tasks.mjs';
test('submitting a goal starts the server-owned worker, rejects overlap, and persists verified completion',async()=>{
 const prior=process.env.OBS_RECORD_TASKS;process.env.OBS_RECORD_TASKS='false';
 const directory=await mkdtemp(join(tmpdir(),'minecraft-autonomy-'));let owner=null,calls=0;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  const send=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(req.url==='/goal'){if(body.expected_goal!==owner){res.statusCode=409;return send({error:'goal_changed'});}owner=body.goal;return send({goal:owner});}
  if(req.url==='/observe')return send({connected:true,dead:false,goal:owner,inventory:[{name:'stick',count:4}],equipment:{},player:{health:20,food:20,position:{x:0,y:64,z:0}}});
  if(req.url==='/capabilities')return send({skills:['wait'],item_names:['stick']});
  if(req.url==='/actions'||req.url==='/build-sites')return send([]);
  if(req.url==='/announce')return send({status:'sent'});
  return send(null);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const tasks=new AutonomousTasks({base:`http://127.0.0.1:${server.address().port}`,directory,plannerFactory:()=>({model:'test-model',autonomousPlan:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {status:'complete',summary:'Four sticks observed',objectives:[{type:'inventory',item:'stick',count:4}],steps:[]};}}),policyFactory:()=>({})});
 try{
  await tasks.initialize();const task=await tasks.submit('Own four sticks');
  await assert.rejects(tasks.submit('Other goal'),/task_busy/);
  await tasks.active.promise;assert.equal(calls,1);assert.equal(task.status,'succeeded');assert.equal(owner,null);
  assert.equal(JSON.parse(await readFile(join(directory,task.id+'.json'),'utf8')).status,'succeeded');
  const restarted={id:'00000000-0000-0000-0000-000000000001',goal:'Interrupted work',status:'running'};
  await writeFile(join(directory,restarted.id+'.json'),JSON.stringify(restarted));
  const next=new AutonomousTasks({base:'unused',directory});await next.initialize();assert.equal(next.tasks.get(restarted.id).status,'interrupted');
 }finally{await tasks.close();await new Promise(r=>server.close(r));await rm(directory,{recursive:true});if(prior===undefined)delete process.env.OBS_RECORD_TASKS;else process.env.OBS_RECORD_TASKS=prior;}
});
