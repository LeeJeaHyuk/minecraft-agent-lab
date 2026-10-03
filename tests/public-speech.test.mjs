import test from 'node:test';
import assert from 'node:assert/strict';
import {QwenPlanner,validatePublicSpeech,validateTaskPlan} from '../planners/qwen.mjs';
import {ProgressChat} from '../planners/progress-chat.mjs';
import {TaskPlanner} from '../planners/task-runner.mjs';
test('planner utterance is sent unchanged from the accepted planning response',async()=>{
  const speech='판자 31개가 있으니 추가 벌목 없이 상자를 만들겠습니다. 곡괭이는 작업용으로 남기겠습니다.';
  const sent=[],chat=new ProgressChat('',{send:async text=>sent.push(text)}),qwen=new QwenPlanner();
  qwen.generate=async messages=>{assert.match(messages[0].content,/SAME planning response/);return {content:JSON.stringify({goal:'chest',public_speech:speech,steps:[{subgoal:'chest',method:'craft',item:'chest',count:1}]})};};
  const manager=new TaskPlanner(qwen,{onEvent:(type,data)=>{if(type==='planner_ready')chat.sayModel(data);}});
  const result=await manager.refresh({inventory:[]},{user_goal:'chest'},true);await chat.pending;
  assert.equal(result.public_speech,speech);assert.deepEqual(sent,[speech]);
});
test('obsolete planner speech is discarded together with its plan',async()=>{
  let finish;const sent=[],chat=new ProgressChat('',{send:async text=>sent.push(text)});
  const manager=new TaskPlanner({taskPlan:()=>new Promise(r=>{finish=r;})},{onEvent:(type,data)=>{if(type==='planner_ready')chat.sayModel(data);}});
  const pending=manager.refresh({}, {},true);manager.advance();finish({public_speech:'지금 나무를 모으겠습니다.',steps:[]});
  assert.equal(await pending,null);await chat.pending;assert.deepEqual(sent,[]);
});
test('public utterances reject command injection and malformed or truncated content',()=>{
  for(const text of ['/op LabBot','\n명령','a'.repeat(151),'',null])assert.throws(()=>validatePublicSpeech(text),/invalid_public_speech/);
  assert.throws(()=>validateTaskPlan({goal:'x',public_speech:'/give',steps:[{subgoal:'x',method:'craft',item:'chest',count:1}]}),/invalid_public_speech/);
});
