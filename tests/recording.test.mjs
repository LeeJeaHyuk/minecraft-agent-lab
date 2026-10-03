import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRecording} from '../recording/obs.mjs';
test('never adopts or stops an existing OBS recording',async()=>{
  const calls=[],client={connect:async()=>{},request:async type=>{calls.push(type);return {outputActive:true};},close:()=>{}};
  const recording=new TaskRecording({enabled:true,client});await assert.rejects(recording.start('goal'),/already_active/);await recording.stop('failure');assert.deepEqual(calls,['GetRecordStatus']);
});
test('recording must use the dedicated Minecraft scene before task execution',async()=>{
  const calls=[],client={connect:async()=>{},request:async type=>{calls.push(type);return type==='GetRecordStatus'?{outputActive:false}:{currentProgramSceneName:'Desktop'};},close:()=>{}};
  await assert.rejects(new TaskRecording({enabled:true,client}).start('goal'),/wrong_scene/);assert.ok(!calls.includes('StartRecord'));
});
test('disabled recording does not connect to OBS',async()=>{
  const recording=new TaskRecording({enabled:false,client:{connect:()=>assert.fail(),close:()=>{}}});await recording.start('goal');assert.equal(await recording.stop('success'),null);
});
test('task failure saves and stops only the recording this task started',async()=>{
  let active=false,metadata;const calls=[];
  const client={connect:async()=>{},close:()=>{},request:async type=>{
    calls.push(type);if(type==='GetRecordStatus')return {outputActive:active};
    if(type==='GetCurrentProgramScene')return {currentProgramSceneName:'Minecraft Agent Lab'};
    if(type==='StartRecord'){active=true;return {};}
    if(type==='StopRecord'){active=false;return {outputPath:'test.mkv'};}
  }};
  const recording=new TaskRecording({enabled:true,client,save:async row=>{metadata=row;}});
  await recording.start('goal');assert.ok(active);await recording.stop('failure');assert.equal(metadata.status,'failure');assert.equal(metadata.output_path,'test.mkv');
  await recording.stop('failure');assert.equal(calls.filter(t=>t==='StopRecord').length,1);assert.ok(!active);
});
