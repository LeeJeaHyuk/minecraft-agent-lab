import test from 'node:test';
import assert from 'node:assert/strict';
import {AutonomousEngine} from '../autonomy/engine.mjs';
import {validatePlan,conditionMet,stepCandidates} from '../autonomy/contracts.mjs';
import {designBlueprint} from '../autonomy/build-design.mjs';
const objective=[{type:'inventory',item:'stick',count:4}];
const step={id:'sticks',kind:'act',subgoal:'Craft sticks',skills:['craft_item'],match:[{field:'item',values:['stick']}],until:objective};
const plan=(status='continue',steps=[step],objectives=objective)=>({status,summary:'Make sticks',objectives,steps});
function fixture(){
 let count=0;const events=[],contexts=[];
 const snapshot=()=>({state:{connected:true,dead:false,player:{health:20,food:20,position:{x:0,y:64,z:0}},inventory:[{name:'stick',count}]},capabilities:{skills:['craft_item'],items:['stick']},actions:[{id:'craft:stick',skill:'craft_item',arguments:{item:'stick'}}]});
 const transport={snapshot:async()=>snapshot(),act:async()=>{count=4;return {status:'success',result:{}};}};
 const planner={autonomousPlan:async(s,c)=>{contexts.push(c);return s.state.inventory[0].count>=4?plan('complete',[]):plan();}};
 const policy={decide:async(_s,a)=>({action:a[0].id})};
 return {events,contexts,transport,planner,policy,engine:options=>new AutonomousEngine({transport,planner,policy,onEvent:async(t,d)=>events.push({t,d}),...options})};
}
test('a single goal runs planner, Kev, readback and final planner review without external step instructions',async()=>{
 const f=fixture(),result=await f.engine().run('Make four sticks');assert.equal(result.status,'succeeded');assert.equal(result.action_count,1);assert.equal(f.contexts.length,2);assert.ok(f.events.some(e=>e.t==='step_complete'));
});
test('an execution failure invokes Qwen replanning before another action',async()=>{
 const f=fixture(),original=f.transport.act;let calls=0;
 f.transport.act=async()=>++calls===1?{status:'failure',error:'target_unreachable'}:original();
 const result=await f.engine().run('Make four sticks');assert.equal(result.status,'succeeded');assert.ok(f.contexts.some(c=>c.feedback.includes('target_unreachable')));assert.equal(calls,2);
});
test('using the final allowed action still permits observed completion and planner review',async()=>{
 const f=fixture();assert.equal((await f.engine({maxActions:1}).run('Make four sticks')).status,'succeeded');
});
test('unavailable candidates are replanned rather than treated as completion',async()=>{
 const f=fixture(),original=f.planner.autonomousPlan;let n=0;
 f.planner.autonomousPlan=async(s,c)=>++n===1?plan('continue',[{...step,match:[{field:'item',values:['oak_log']}]}]):original(s,c);
 assert.equal((await f.engine().run('Make four sticks')).status,'succeeded');assert.ok(f.contexts.some(c=>c.feedback.startsWith('no_feasible_actions')));
});
test('a false model completion cannot finish a task and changed objectives are rejected',async()=>{
 const f=fixture();f.planner.autonomousPlan=async(_s,c)=>c.objectives?plan('complete',[],[{type:'inventory',item:'stick',count:1}]):plan('complete',[]);
 const result=await f.engine({maxReplans:5}).run('Make four sticks');assert.equal(result.status,'blocked');assert.deepEqual(result.objectives,objective);assert.equal(result.action_count,0);
});
test('cancellation during model inference prevents the pending action',async()=>{
 const f=fixture(),engine=f.engine();f.policy.decide=async(_s,a)=>{engine.cancel();return {action:a[0].id};};
 let calls=0;f.transport.act=async()=>{calls++;};const result=await engine.run('Make four sticks');assert.equal(result.status,'cancelled');assert.equal(calls,0);
});
test('replanning retains receipts instead of repeating completed configuration side effects',async()=>{
 const f=fixture(),operation={id:'configure',kind:'storage',subgoal:'Configure chest',keep:{stick:0},withdraw:{}};let operations=0;
 const original=f.planner.autonomousPlan;f.planner.autonomousPlan=async(s,c)=>{const p=await original(s,c);if(p.status==='continue')p.steps=[operation,step];return p;};
 f.transport.operation=async()=>{operations++;return {configured:true};};
 assert.equal((await f.engine().run('Make four sticks')).status,'succeeded');assert.equal(operations,1);
});
test('conditions count equipped items once and candidate filters are bound to observed arguments',()=>{
 assert.equal(conditionMet({type:'inventory',item:'iron_sword',count:2},{state:{connected:true,inventory:[{name:'iron_sword',count:1}],equipment:{hand:'iron_sword'}}}),false);
 assert.equal(stepCandidates(step,[{id:'craft:stick',skill:'craft_item',arguments:{item:'stick'}},{id:'mine:stick',skill:'mine_block',arguments:{item:'stick'}}]).length,1);
 assert.throws(()=>validatePlan(plan(),{skills:['craft_item'],items:['stick']},[{type:'inventory',item:'stick',count:8}]),/contract_changed/);
});
test('model-selected materials compile into a verified room without model-generated geometry or interior blocks',()=>{
 const site={id:'site:0:63:0:4',origin:{x:0,y:63,z:0},size:4};
 const {compiled}=designBlueprint({site_id:site.id,floor:'cobblestone',walls:'oak_planks',roof:'cobblestone',entrance:'north'},[site]);
 assert.equal(compiled.cells.length,54);assert.ok(!compiled.cells.some(q=>q.x===1&&q.y===64&&q.z===1));
 assert.throws(()=>designBlueprint({site_id:'invented',entrance:'north'},[site]),/site/);
});
