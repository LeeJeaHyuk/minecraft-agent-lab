import {jsonRequest} from '../models/http.mjs';
import {designBlueprint} from './build-design.mjs';
import {actionState} from '../planners/action-state.mjs';
import {buildingMaterials} from '../environment/construction.mjs';
export class MinecraftTaskTransport{
  constructor({base,token,plannerModel}){Object.assign(this,{base,token,plannerModel});this.chest=null;}
  get(path){return jsonRequest(this.base+path,{timeoutMs:30000});}
  post(path,body){return jsonRequest(this.base+path,{body:{expected_goal:this.token,...body},timeoutMs:240000});}
  async snapshot(){
    const state=await this.get('/observe');
    if(state.goal!==this.token)throw Error('task_ownership_changed');
    const [actions,capabilities,sites,construction,corridor]=await Promise.all([this.get('/actions'),this.get('/capabilities'),this.get('/build-sites'),this.get('/construction'),this.get('/annex-corridor')]);
    const compressed=actionState(state,null,'autonomous');
    return {state:compressed,actions,sites,construction,corridor,chest:this.chest,chest_observed_at:this.chestObservedAt??null,capabilities:{skills:capabilities.skills,items:capabilities.item_names,build_materials:buildingMaterials}};
  }
  async operation(step,snapshot){
    if(step.kind==='build'){
      const {blueprint,compiled}=designBlueprint(step.design,snapshot.sites);
      if(snapshot.construction&&!snapshot.construction.complete&&snapshot.construction.missing.length)throw Error('existing_construction_incomplete:finish_or_report_blocked');
      const materials={};for(const c of compiled.cells)materials[c.material]=(materials[c.material]??0)+1;
      await this.post('/construction',{blueprint:null});
      await this.post('/construction',{blueprint});return {site_id:compiled.site.id,required_materials:materials,expected_blocks:compiled.cells.length};
    }
    if(step.kind==='corridor'){
      const c=await this.post('/annex-corridor',{});return {required_materials:c.missing.reduce((n,q)=>(n[q.material]=(n[q.material]??0)+1,n),{}),expected_blocks:c.expected_blocks};
    }
    if(step.kind==='storage')return this.post('/storage-plan',{keep:step.keep??{},withdraw:step.withdraw??{}});
    if(step.kind==='home')return this.post('/home',{});
    throw Error('unsupported_operation');
  }
  async act(decision,allowed,step,decisionState){
    await this.post('/goal',{goal:this.token,subgoal:step.subgoal});
    const result=await this.post('/act',{action_id:decision.action,decision,decision_context:{state:decisionState,available_actions:allowed},policy_name:'kev',planner:{name:'qwen',model:this.plannerModel}});
    if(result.result?.chest_inventory){this.chest=result.result.chest_inventory;this.chestObservedAt=new Date().toISOString();}return result;
  }
  async announce(text,source){
    if(typeof text!=='string'||!text.trim())return;
    try{await this.post('/announce',{text,source,model:this.plannerModel});}catch(error){if(error.message!=='http_429')throw error;}
  }
  wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
}
