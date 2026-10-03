import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressChat,itemLabel} from '../planners/progress-chat.mjs';
test('Progress chat deduplicates summaries and can be disabled',async()=>{
  const sent=[],chat=new ProgressChat('',{send:async text=>sent.push(text)});
  chat.say('목표: 통나무 확보.');chat.say('목표: 통나무 확보.');await chat.pending;
  assert.deepEqual(sent,['목표: 통나무 확보.']);
  await new ProgressChat('',{enabled:false,send:async()=>assert.fail('disabled')}).say('skip');
  assert.equal(itemLabel('oak_planks'),'참나무 판자');
});
test('Chat transport failure is reported without rejecting gameplay',async()=>{
  const errors=[],chat=new ProgressChat('',{send:async()=>{throw new Error('disconnected');},onError:e=>errors.push(e.message)});
  await chat.say('진행: 집 설계.');assert.deepEqual(errors,['disconnected']);
});
