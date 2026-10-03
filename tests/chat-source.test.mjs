import test from 'node:test';
import assert from 'node:assert/strict';
import {attributedChat} from '../planners/chat-source.mjs';
import {ProgressChat} from '../planners/progress-chat.mjs';
test('chat identifies the actual model without altering its public utterance',async()=>{
  const text='횃불 4개와 닫힌 문을 확인했으니 집 안에서 대기하겠습니다.',sent=[];
  const chat=new ProgressChat('',{send:async(text,metadata)=>sent.push({text,...metadata})});
  await chat.sayModel({public_speech:text,model:'qwen3.8-27b'});
  assert.equal(sent[0].source,'qwen');assert.equal(sent[0].model,'qwen3.8-27b');assert.equal(sent[0].text,text);
  assert.equal(attributedChat(sent[0]).display_text,`[Qwen: qwen3.8-27b] ${text}`);
  assert.equal(attributedChat({text,source:'kev',model:'jaredpalmer/kev-4b'}).display_text,`[Kev: kev-4b] ${text}`);
  assert.equal(attributedChat({text}).display_text,`[시스템] ${text}`);
});
test('model labels reject controls and keep a maximum-length public utterance intact',()=>{
  assert.throws(()=>attributedChat({text:'x',source:'invented'}),/invalid_chat_source/);
  assert.throws(()=>attributedChat({text:'x',source:'qwen',model:'qwen\n/op'}),/invalid_chat_model/);
  const text='가'.repeat(150),message=attributedChat({text,source:'qwen',model:'qwen3.8-27b'});assert.equal(message.text,text);assert.ok(message.display_text.length<256);
});
