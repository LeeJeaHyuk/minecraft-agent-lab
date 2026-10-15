import {randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rename,appendFile} from 'node:fs/promises';
import {AutonomousEngine} from './engine.mjs';
import {MinecraftTaskTransport} from './transport.mjs';
import {QwenPlanner} from '../planners/qwen.mjs';
import {KevPolicy} from '../policies/index.mjs';
import {TaskRecording} from '../recording/obs.mjs';
export class AutonomousTasks{
  constructor({base,directory='.runtime/autonomy',plannerFactory=()=>new QwenPlanner({timeoutMs:90000}),policyFactory=()=>new KevPolicy()}={}){
    Object.assign(this,{base,directory,plannerFactory,policyFactory});this.tasks=new Map();this.active=null;
  }
  async initialize(){
    await mkdir(this.directory,{recursive:true});
    for(const file of (await readdir(this.directory)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){const task=JSON.parse(await readFile(`${this.directory}/${file}`,'utf8'));if(['starting','running','cancelling'].includes(task.status)){task.status='interrupted';task.reason='process_restarted:explicit_resume_required';}this.tasks.set(task.id,task);await this.save(task);}
  }
  async save(task){const p=`${this.directory}/${task.id}.json`;await writeFile(p+'.tmp',JSON.stringify(task,null,2));await rename(p+'.tmp',p);}
  list(){return [...this.tasks.values()].map(({id,goal,status,phase,reason})=>({id,goal,status,phase,reason}));}
  async submit(goal){
    if(typeof goal!=='string'||!goal.trim()||goal.length>2000||/[\x00-\x08]/.test(goal))throw Error('invalid_user_goal');
    if(this.shuttingDown)throw Error('task_service_stopping');if(this.active)throw Error('task_busy');
    const task={id:randomUUID(),goal:goal.trim(),status:'starting',created_at:new Date().toISOString()};
    this.active={task};this.tasks.set(task.id,task);
    try{await this.launch(task);}catch(error){task.status='blocked';task.reason=error.message;this.active=null;await this.save(task);throw error;}
    return task;
  }
  async resume(id){
    const task=this.tasks.get(id);if(!task)throw Error('task_not_found');if(this.shuttingDown)throw Error('task_service_stopping');if(this.active)throw Error('task_busy');
    if(!['blocked','interrupted','cancelled'].includes(task.status))throw Error('task_not_resumable');
    this.active={task};try{await this.launch(task);}catch(error){this.active=null;throw error;}return task;
  }
  cancel(id){if(this.active?.task.id!==id)throw Error('task_not_running');this.active.task.status='cancelling';this.active.engine?.cancel();return this.active.task;}
  async launch(task){
    const planner=this.plannerFactory(),transport=new MinecraftTaskTransport({base:this.base,token:`autonomy:${task.id}`,plannerModel:planner.model});
    const state=await transport.get('/observe');if(!state.connected||state.dead)throw Error('minecraft_not_ready');
    await transport.post('/goal',{goal:transport.token,expected_goal:null});
    const recording=new TaskRecording({handleSignals:false});
    const onEvent=async(type,data)=>{
      task.status='running';task.phase=type;task.checkpoint=data.checkpoint;
      if(type==='plan_accepted')task.plan=data.plan;
      if(type==='action_result')task.last_action={action:data.action,status:data.result.status,error:data.result.error};
      await appendFile(`${this.directory}/${task.id}.jsonl`,JSON.stringify({time:new Date().toISOString(),type,...data,checkpoint:undefined})+'\n');await this.save(task);
    };
    const engine=new AutonomousEngine({planner,policy:this.policyFactory(),transport,onEvent,maxActions:Number(process.env.AUTONOMY_MAX_ACTIONS??240),maxReplans:Number(process.env.AUTONOMY_MAX_REPLANS??40),maxDurationMs:Number(process.env.AUTONOMY_MAX_DURATION_MS??1800000)});
    this.active={task,engine};task.status='running';task.phase='starting';task.plan=null;delete task.reason;await this.save(task);
    this.active.promise=(async()=>{
      try{await recording.start(task.goal);const result=await engine.run(task.goal,task.checkpoint);task.checkpoint=result;task.status=result.status;task.reason=result.reason;}
      catch(error){task.status='blocked';task.reason=error.message;}
      finally{
        task.recording=await recording.stop(task.status).catch(e=>({error:e.message}));
        await transport.post('/goal',{goal:null}).catch(()=>{});task.finished_at=new Date().toISOString();await this.save(task);this.active=null;
      }
    })().catch(error=>{task.status='blocked';task.reason=`task_persistence_failure:${error.message}`;this.active=null;console.error('Autonomous task stopped: persistence failure');});
  }
  async close(){this.shuttingDown=true;if(this.active){this.active.engine?.cancel();await this.active.promise;}}
}
