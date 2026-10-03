import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import {setTimeout as delay} from 'node:timers/promises';
import {resourceBlocks,extraActions,executeExtra,inventoryCounts} from './skills.mjs';
import {surveySites,inspectConstruction,constructionActions,executeConstruction} from './construction.mjs';
import {storageActions,executeStorage} from './storage.mjs';
import {combatActions,executeCombat} from './combat.mjs';
import {installDamageReflex} from './damage-reflex.mjs';
import {resolveThreats} from './task-safety.mjs';
import {visibleThreats} from './combat.mjs';
import {equipment,equipmentActions,executeEquipment} from './equipment.mjs';
import {foodActions,executeFood,completedHuntAfterDefense} from './food.mjs';
import {homeActions,executeHome,inspectHome,prepareHomeDeparture,allowOpenDoorPassage,installDoorNavigation} from './home.mjs';
const {pathfinder,Movements,goals} = pathfinderModule;
const point = p => ({x:p.x,y:p.y,z:p.z});
export class MinecraftEnvironment {
  constructor(config = {}) { this.config=config; this.bot=null; this.ready=false; this.dead=false; this.deathCount=0; this.current=null; this.goal=null; this.subgoal=null; this.generation=0; this.reconnectTimer=null; }
  async connect() {
    clearTimeout(this.reconnectTimer); this.ready=false; this.dead=false; this.generation++;
    const bot = mineflayer.createBot({host:process.env.MC_HOST??'127.0.0.1',port:Number(process.env.MC_PORT??25565),
      username:process.env.MC_USERNAME??'LabBot',version:process.env.MC_VERSION??'1.21.1',auth:'offline',logErrors:false,...this.config});
    this.bot=bot; bot.loadPlugin(pathfinder);bot.once('spawn',()=>{
      installDoorNavigation(bot);const best=bot.pathfinder.bestHarvestTool.bind(bot.pathfinder);
      bot.pathfinder.bestHarvestTool=block=>['stone','cobblestone','granite','diorite','andesite','deepslate','cobbled_deepslate','tuff'].includes(block.name)?bot.inventory.items().find(i=>i.name==='stone_pickaxe')??bot.inventory.items().find(i=>i.name==='wooden_pickaxe')??best(block):best(block);
    });
    let lastHealth;
    installDamageReflex(bot,{interrupt:()=>this.interruptAction?.(),onEvent:event=>{this.safetyReflex=event;}});
    bot.on('health',()=>{if(this.bot!==bot)return;if(Number.isFinite(lastHealth)&&bot.health<lastHealth)this.lastDamage={time:Date.now(),before:lastHealth,after:bot.health};lastHealth=bot.health;});
    bot.on('spawn',()=> { if(this.bot!==bot)return; this.ready=true;this.dead=false;this.lastDamage=null;this.safetyReflex=null;lastHealth=bot.health; const movement=new Movements(bot);movement.canDig=false;movement.allow1by1towers=false;allowOpenDoorPassage(movement);bot.pathfinder.setMovements(movement); });
    bot.on('death',()=>{if(this.bot!==bot)return;this.dead=true;this.ready=false;this.lastDamage=null;this.deathCount++;this.generation++;bot.pathfinder.stop();bot.stopDigging();});
    bot.on('end',()=>{ if(this.bot!==bot)return;this.ready=false;this.generation++;this.reconnectTimer=setTimeout(()=>this.connect(),3000); });
    bot.on('error',error=>{this.lastError=error.code??'connection_error';});
  }
  close() { clearTimeout(this.reconnectTimer);const bot=this.bot;this.bot=null;this.ready=false;bot?.quit(); }
  observe() {
    const b=this.bot;
    if (!this.ready || !b?.entity) return {connected:false,dead:this.dead,death_count:this.deathCount,player:null,inventory:[],nearby_entities:[],nearby_blocks:[],environment:{},current_action:this.current,goal:this.goal,subgoal:this.subgoal};
    const entities=Object.values(b.entities).filter(e=>e.id!==b.entity.id && e.position.distanceTo(b.entity.position)<=12)
      .sort((a,c)=>a.id-c.id).slice(0,24).map(e=>({id:e.id,name:e.name??e.type,position:point(e.position),...(e.name==='item'?{dropped_item:e.getDroppedItem?.()?.name??null}:{})}));
    const blocks=[];const origin=b.entity.position.floored();
    for(let x=-3;x<=3;x++)for(let y=-2;y<=2;y++)for(let z=-3;z<=3;z++){
      const block=b.blockAt(origin.offset(x,y,z));if(block && block.name!=='air' && block.boundingBox==='block')blocks.push({name:block.name,position:point(block.position)});
    }
    return {connected:true,dead:false,death_count:this.deathCount,player:{position:point(b.entity.position),health:b.health,food:b.food,yaw:b.entity.yaw,pitch:b.entity.pitch},
      inventory:b.inventory.items().sort((a,c)=>a.slot-c.slot).map(i=>({name:i.name,count:i.count,slot:i.slot})),equipment:equipment(b),nearby_entities:entities,
      nearby_blocks:blocks.slice(0,64),environment:{dimension:b.game.dimension,time:b.time.timeOfDay,raining:b.isRaining},
      resource_blocks:resourceBlocks(b),construction:this.construction?(()=>{const s=inspectConstruction(b,this.construction);return {site:s.blueprint.site,material:s.blueprint.material,expected_blocks:s.expected_blocks,matched_blocks:s.matched_blocks,entry_clear:s.entry_clear,interior_clear:s.interior_clear,complete:s.complete};})():null,
      home:inspectHome(b,this.home),last_damage:this.lastDamage??null,safety_reflex:this.safetyReflex??null,current_action:this.current,goal:this.goal,subgoal:this.subgoal};
  }
  actions() {
    if(!this.ready || this.current)return [];
    const b=this.bot, actions=[{id:'wait',skill:'wait',arguments:{duration_ms:250}}];
    for(const target of [b.entity.position.floored().offset(2,0,0),b.entity.position.floored().offset(-2,0,0),b.entity.position.floored().offset(0,0,2),b.entity.position.floored().offset(0,0,-2)]){
      const below=b.blockAt(target.offset(0,-1,0)),feet=b.blockAt(target),head=b.blockAt(target.offset(0,1,0));
      if(below?.boundingBox==='block' && feet?.boundingBox==='empty' && head?.boundingBox==='empty')actions.push({id:`move:${target.x}:${target.y}:${target.z}`,skill:'move_to',arguments:point(target)});
    }
    for(const target of this.observe().nearby_blocks){
      const block=b.blockAt(b.entity.position.clone().set(target.position.x,target.position.y,target.position.z));
      if(block && b.canDigBlock(block) && b.canSeeBlock(block) && block.diggable && block.position.distanceTo(b.entity.position)<=4.5){
        actions.push({id:`mine:${block.position.x}:${block.position.y}:${block.position.z}`,skill:'mine_block',arguments:point(block.position)});if(actions.filter(a=>a.skill==='mine_block').length>=4)break;
      }
    }
    return [...actions,...equipmentActions(b,this.home),...foodActions(b),...homeActions(b,this.home),...combatActions(b),...extraActions(b,resourceBlocks(b)),...storageActions(b,this.storagePlan,this.construction),...(this.construction?constructionActions(b,this.construction):[])].filter(a=>{
      if(!['mine_block','mine_and_collect'].includes(a.skill))return true;const p=a.arguments,block=b.blockAt(b.entity.position.clone().set(p.x,p.y,p.z));
      return block&&!(b.pathfinder.movements.exclusionAreasBreak??[]).some(fn=>fn(block)>=100);
    });
  }
  async act(actionId, argumentsProvided = {}) {
    if(this.actionOwner||this.current)return {status:'failure',duration_ms:0,result:{},error:'busy'};
    if(this.dead)return {status:'failure',duration_ms:0,result:{},error:'dead'};
    if(!this.ready)return {status:'failure',duration_ms:0,result:{},error:'disconnected'};
    const owner={goal:this.goal,generation:this.generation,bot:this.bot},started=performance.now();this.actionOwner=owner;
    const assertOwner=()=>{if(this.goal!==owner.goal||this.generation!==owner.generation||this.bot!==owner.bot)throw Error('interrupted');};
    const safety=[];
    const original=this.ready&&!this.dead?this.actions().find(a=>a.id===actionId):null;
    const beforeInventory=this.bot?.inventory?inventoryCounts(this.bot):{};
    try{
      if(this.ready&&!this.dead&&visibleThreats(this.bot).length)safety.push(...await resolveThreats(this,assertOwner));
      let result=await this.executeAction(actionId,argumentsProvided,original);
      for(let attempt=0;attempt<2&&result.error==='damage_interrupted';attempt++){
        assertOwner();safety.push(...await resolveThreats(this,assertOwner));assertOwner();
        const completed=original?.skill==='hunt_food'?completedHuntAfterDefense(this.bot,original,beforeInventory):null;
        if(completed){safety.push({time:new Date().toISOString(),type:'task_completion_verified',action_id:actionId});return {status:'success',duration_ms:Math.round(performance.now()-started),result:{...completed,safety},error:null};}
        this.bot.chat('[시스템] 위협이 해소되었습니다. 중단된 행동을 현재 상태에서 다시 확인합니다.');
        // Re-enumeration validates the target, recipe and inventory; never blindly replay side effects.
        if(!['wait','move_to','explore','approach_resource','approach_build_site','mine_block','mine_and_collect','collect_item','return_home','enter_home','equip_gear','hunt_food','attack_entity'].includes(original?.skill))
          return {status:'failure',duration_ms:Math.round(performance.now()-started),result:{safety},error:'action_needs_replan'};
        const fresh=this.actions().find(a=>a.id===actionId)??(['move_to','explore','approach_resource','approach_build_site'].includes(original?.skill)?original:null);
        if(!fresh)return {status:'failure',duration_ms:Math.round(performance.now()-started),result:{safety},error:'action_needs_replan'};
        safety.push({time:new Date().toISOString(),type:'task_resumed',action_id:actionId});
        result=await this.executeAction(actionId,argumentsProvided,fresh);
      }
      return {...result,duration_ms:Math.round(performance.now()-started),result:{...result.result,...(safety.length?{safety}: {})}};
    }catch(error){return {status:'failure',duration_ms:Math.round(performance.now()-started),result:{safety},error:error.message};}
    finally{this.actionOwner=null;}
  }
  async executeAction(actionId, argumentsProvided = {},navigationCandidate=null) {
    const start=performance.now();const generation=this.generation,deathCount=this.deathCount;
    const fail=error=>({status:'failure',duration_ms:Math.round(performance.now()-start),result:{},error});
    if(this.current)return fail('busy');if(this.dead)return fail('dead');if(!this.ready)return fail('disconnected');
    const candidate=this.actions().find(a=>a.id===actionId)??(['move_to','explore','approach_resource','approach_build_site'].includes(navigationCandidate?.skill)?navigationCandidate:null);
    if(!candidate || (Object.keys(argumentsProvided).length && (Object.keys(argumentsProvided).length!==Object.keys(candidate.arguments).length ||
      !Object.entries(candidate.arguments).every(([key,value])=>argumentsProvided[key]===value))))return fail('invalid_action');
    this.current=candidate;let timer,cancelled=false,executionResult={skill:candidate.skill};const bot=this.bot;
    let rejectDamage;const damageInterrupted=new Promise((_,reject)=>{rejectDamage=reject;});
    this.interruptAction=()=>{cancelled=true;rejectDamage(new Error('damage_interrupted'));};
    const assertActive=()=>{if(cancelled || this.generation!==generation || this.bot!==bot)throw new Error('interrupted');};
    try {
      const execute=async()=>{
        if(this.home&&['move_to','explore','approach_resource','mine_and_collect','collect_item','approach_build_site','withdraw_item','deposit_item','inspect_chest','hunt_food'].includes(candidate.skill))await prepareHomeDeparture(bot,this.home,assertActive);
        if(candidate.skill==='wait')await delay(candidate.arguments.duration_ms);
        else if(candidate.skill==='move_to'){
          const goal=new goals.GoalBlock(candidate.arguments.x,candidate.arguments.y,candidate.arguments.z);await bot.pathfinder.goto(goal);assertActive();
          if(!goal.isEnd(bot.entity.position.floored()))throw new Error('navigation_not_confirmed');
          executionResult={skill:candidate.skill,position:point(bot.entity.position)};
        }
        else if(candidate.skill==='mine_block'){
          const p=candidate.arguments;const block=this.bot.blockAt(this.bot.entity.position.clone().set(p.x,p.y,p.z));
          if(!block || block.name==='air')throw new Error('target_not_found');await this.bot.dig(block);
        }else if(['place_block','clear_build_cell','approach_build_site'].includes(candidate.skill))executionResult=await executeConstruction(bot,candidate,this.construction,assertActive);
        else if(candidate.skill==='attack_entity')executionResult=await executeCombat(bot,candidate,assertActive);
        else if(['eat_food','hunt_food'].includes(candidate.skill))executionResult=await executeFood(bot,candidate,assertActive);
        else if(['equip_gear','place_furnace','smelt_iron','recover_furnace'].includes(candidate.skill))executionResult=await executeEquipment(bot,candidate,assertActive);
        else if(['return_home','enter_home','place_torch','place_door','repair_light_support'].includes(candidate.skill))executionResult=await executeHome(bot,candidate,this.home,assertActive);
        else if(['place_chest','deposit_item','inspect_chest','withdraw_item'].includes(candidate.skill))executionResult=await executeStorage(bot,candidate,assertActive);
        else executionResult=await executeExtra(bot,candidate,assertActive);
      };
      const timeout=Number(process.env.ACTION_TIMEOUT_MS??(['approach_resource','approach_build_site','explore','smelt_iron','return_home','hunt_food','mine_and_collect'].includes(candidate.skill)?45000:15000));
      const execution=execute();
      try{await Promise.race([execution,damageInterrupted,new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;bot?.pathfinder.stop();bot?.stopDigging();reject(new Error('timeout'));},timeout);})]);}
      catch(error){if(cancelled)await execution.catch(()=>{});throw error;}
      if(this.generation!==generation)return fail(this.dead || this.deathCount>deathCount?'dead':'interrupted');
      return {status:'success',duration_ms:Math.round(performance.now()-start),result:executionResult,error:null};
    } catch(error){return {...fail(this.dead || this.deathCount>deathCount?'dead':(['timeout','target_not_found','inventory_missing','pickup_not_confirmed','craft_not_confirmed','target_unreachable','interrupted'].includes(error.message)?error.message:
      error.message==='damage_interrupted'?'damage_interrupted':['move_to','approach_resource'].includes(candidate.skill)?'pathfinding_failed':'execution_failed')),error_details:error.message};}
    finally{clearTimeout(timer);this.interruptAction=null;this.current=null;bot?.pathfinder.setGoal?.(null);bot?.clearControlStates?.();}
  }
  async reset() {
    if(this.current||this.actionOwner)throw new Error('busy');
    this.close();this.deathCount=0;await this.connect();return {status:'reconnecting',scope:'bot_only',world_reset:false};
  }
}
