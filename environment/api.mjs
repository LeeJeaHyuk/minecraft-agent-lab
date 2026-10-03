import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {MinecraftEnvironment} from './adapter.mjs';
import {Trajectory} from '../logging/trajectory.mjs';
import {validateDecision} from '../policies/index.mjs';
import {surveySites,compileBlueprint,inspectConstruction} from './construction.mjs';
import {homeFromBuilding} from './home.mjs';
import {attributedChat} from '../planners/chat-source.mjs';
const environment=new MinecraftEnvironment(),trajectory=new Trajectory();await environment.connect();
let lastAnnouncement=0;
try{const saved=JSON.parse(await readFile('.runtime/active-construction.json','utf8'));if(saved)environment.construction=compileBlueprint({...saved,site_id:saved.site.id},[saved.site]);}catch{}
let previous;try{previous=JSON.parse((await readFile('.runtime/previous-house.json','utf8')).replace(/^\uFEFF/,''));}catch{}
try{environment.home=JSON.parse(await readFile('.runtime/home.json','utf8'));}catch{}
let protectedBuildings=[];try{protectedBuildings=JSON.parse(await readFile('.runtime/completed-buildings.json','utf8'));}catch{if(previous)protectedBuildings=[previous];}
const installMiningProtection=()=>{
  if(!environment.bot?.pathfinder?.movements)return;
  environment.bot.pathfinder.movements.exclusionAreasBreak=[block=>{
    const q=block.position;
    const homeFixture=environment.home&&[...environment.home.lights,environment.home.door].some(p=>p.x===q.x&&p.z===q.z&&q.y>=p.y-1&&q.y<=p.y+(p===environment.home.door?1:0));
    const utilityFixture=[block,environment.bot.blockAt(q.offset(0,1,0))].some(b=>['furnace','chest','crafting_table'].includes(b?.name));
    return homeFixture||utilityFixture||protectedBuildings.some(b=>b.cells.some(p=>p.x===q.x&&p.y===q.y&&p.z===q.z))||environment.construction?.cells.some(p=>p.x===q.x&&p.y===q.y&&p.z===q.z)?100:0;
  }];
};
const server=createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET' && path==='/health')return reply(200,{status:'ok',minecraft_connected:environment.ready,dead:environment.dead,death_count:environment.deathCount});
    if(req.method==='GET' && path==='/observe')return reply(200,environment.observe());
    if(req.method==='GET' && path==='/actions'){installMiningProtection();return reply(200,environment.actions());}
    if(req.method==='GET' && path==='/capabilities')return reply(200,{item_names:environment.bot?.registry?.itemsArray.map(i=>i.name)??[],
      skills:['wait','move_to','mine_block','approach_resource','mine_and_collect','collect_item','craft_item','place_block','clear_build_cell','place_workstation','explore','attack_entity','place_chest','inspect_chest','deposit_item','withdraw_item','place_torch','place_door','enter_home','return_home','equip_gear','place_furnace','smelt_iron','recover_furnace','eat_food','hunt_food','repair_light_support']});
    if(req.method==='GET' && path==='/build-sites')return reply(200,surveySites(environment.bot));
    if(req.method==='GET' && path==='/protected-buildings')return reply(200,protectedBuildings);
    if(req.method==='GET' && path==='/protected-buildings/verification')return reply(200,protectedBuildings.map(b=>inspectConstruction(environment.bot,b)));
    if(req.method==='GET' && path==='/construction')return reply(200,inspectConstruction(environment.bot,environment.construction));
    if(req.method!=='POST')return reply(404,{error:'not_found'});
    let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)return reply(413,{error:'body_too_large'});}
    const body=JSON.parse(text||'{}');
    if(path==='/home'){
      if(environment.current)return reply(409,{error:'busy'});
      environment.home=homeFromBuilding(environment.construction);
      await mkdir('.runtime',{recursive:true});await writeFile('.runtime/home.json',JSON.stringify(environment.home));
      return reply(200,environment.home);
    }
      if(path==='/announce'){
        if(!environment.ready)return reply(409,{error:'disconnected'});
        if(typeof body.text!=='string'||body.text.length<1||body.text.length>150||/[\r\n\x00-\x1f]/.test(body.text)||body.text.trim().startsWith('/'))return reply(400,{error:'invalid_announcement'});
        const message=attributedChat(body);
        if(Date.now()-lastAnnouncement<2000)return reply(429,{error:'announcement_rate_limit'});
        lastAnnouncement=Date.now();environment.bot.chat(message.display_text);
        const row={time:new Date().toISOString(),...message,kind:'public_progress_summary'};
        await mkdir('.runtime',{recursive:true});await appendFile('.runtime/chat-events.jsonl',JSON.stringify(row)+'\n');
        return reply(200,{status:'sent',...row});
      }
    if(path==='/construction'){
      if(environment.current)return reply(409,{error:'busy'});
      if(body.blueprint===null){
        if(inspectConstruction(environment.bot,environment.construction)?.complete&&!protectedBuildings.some(b=>b.site.id===environment.construction.site.id))protectedBuildings.push(environment.construction);
        environment.construction=null;await mkdir('.runtime',{recursive:true});
        await writeFile('.runtime/completed-buildings.json',JSON.stringify(protectedBuildings));
        await writeFile('.runtime/active-construction.json','null');return reply(200,{status:'cleared'});
      }
      environment.construction=compileBlueprint(body.blueprint,surveySites(environment.bot));
      await mkdir('.runtime',{recursive:true});await writeFile('.runtime/active-construction.json',JSON.stringify(environment.construction));
      return reply(200,inspectConstruction(environment.bot,environment.construction));
    }
    if(path==='/goal'){if(body.expected_goal!==undefined&&body.expected_goal!==environment.goal)return reply(409,{error:'goal_changed'});if(body.goal!==null && typeof body.goal!=='string')return reply(400,{error:'invalid_goal'});environment.goal=body.goal;environment.subgoal=body.subgoal??null;return reply(200,{goal:environment.goal,subgoal:environment.subgoal});}
    if(path==='/idle-defense'){
      if(typeof body.token!=='string'||!/^idle-defense:[a-f0-9-]{36}$/.test(body.token))throw new Error('invalid_defense_token');
      if(body.release){if(environment.goal===body.token){environment.goal=null;environment.subgoal=null;}return reply(200,{released:true});}
      if(environment.goal||environment.current)return reply(409,{error:'busy'});
      environment.goal=body.token;environment.subgoal='위험에서 벗어나 생존하기';return reply(200,{claimed:true});
    }
    if(path==='/storage-plan'){
      if(environment.current)return reply(409,{error:'busy'});
      if(!body.keep||typeof body.keep!=='object'||Array.isArray(body.keep)||!Object.entries(body.keep).every(([name,count])=>environment.bot.registry.itemsByName[name]&&Number.isInteger(count)&&count>=0&&count<=64))throw new Error('invalid_storage_plan');
      if(body.withdraw&&!Object.entries(body.withdraw).every(([name,count])=>environment.bot.registry.itemsByName[name]&&Number.isInteger(count)&&count>=0&&count<=64))throw new Error('invalid_withdraw_plan');
      environment.storagePlan={keep:body.keep,withdraw:body.withdraw??{}};return reply(200,environment.storagePlan);
    }
    if(path==='/reset'){const result=await environment.reset();trajectory.newEpisode();return reply(200,result);}
    if(path==='/decision-error'){
      const state=body.decision_context?.state??environment.observe();
      const row=await trajectory.append({state,available_actions:body.decision_context?.available_actions??[],goal:state.goal??null,subgoal:state.subgoal??null,
        selected_action:null,selected_arguments:{},action_probabilities:null,policy_name:body.policy_name??'external',model_name:body.model_name??null,
        model_revision:body.model_revision??null,decision_latency_ms:body.latency_ms??null,action_status:'failure',action_duration_ms:0,
        action_result:{},error:body.error??'decision_failed',next_state:environment.observe(),metadata:{event:'decision_error'}});
      return reply(200,{status:'recorded',run_id:row.run_id,step:row.step});
    }
    if(path==='/act'){
      if(body.expected_goal!==undefined&&body.expected_goal!==environment.goal)return reply(409,{error:'goal_changed'});
      const executionState=environment.observe(),executionActions=environment.actions();
      const state=body.decision_context?.state??executionState,available_actions=body.decision_context?.available_actions??executionActions;
      if(body.decision?.probabilities){validateDecision(body.decision,available_actions);if(body.decision.action!==body.action_id)throw new Error('decision_action_mismatch');}
      const result=await environment.act(body.action_id,body.arguments??{});
      const decision=body.decision??{};
      const row=await trajectory.append({state,available_actions,goal:state.goal,subgoal:state.subgoal,selected_action:body.action_id??null,
        selected_arguments:available_actions.find(a=>a.id===body.action_id)?.arguments??{},action_probabilities:decision.probabilities??null,
        policy_name:body.policy_name??'external',model_name:decision.model_name??null,model_revision:decision.model_revision??null,
        decision_latency_ms:decision.latency_ms??null,planner_name:body.planner?.name??null,planner_model:body.planner?.model??null,
        planner_latency_ms:body.planner?.latency_ms??null,action_status:result.status,action_duration_ms:result.duration_ms,action_result:result.result,
        error:result.error,next_state:environment.observe(),done:environment.dead,metadata:{decision,planner:body.planner??null,execution_state:executionState,execution_actions:executionActions}});
      return reply(200,{...result,run_id:row.run_id,step:row.step});
    }
    reply(404,{error:'not_found'});
  }catch(error){reply(error.message==='busy'?409:400,{error:error.message});}
});
server.listen(Number(process.env.API_PORT??18765),'127.0.0.1',()=>console.log('Environment API ready on loopback'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{environment.close();server.close(()=>process.exit(0));});
