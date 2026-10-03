import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraPack} from '../observer/camera-pack.mjs';
test('camera only teleports a tagged human spectator and aims at the bot',()=>{
  const pack=cameraPack(),tick=pack['data/lab_camera/function/tick.mcfunction'];
  assert.match(tick,/@a\[name=ObserverPlayer,tag=lab_camera_follow,gamemode=spectator\]/);
  assert.match(tick,/teleport ObserverPlayer ~4 ~2.5 ~4 facing entity LabBot eyes/);
  assert.doesNotMatch(tick,/teleport LabBot/);
  assert.match(pack['data/lab_camera/function/stop.mcfunction'],/remove lab_camera_follow/);
});
test('camera rejects command injection, same-player targeting and invalid offsets',()=>{
  for(const config of [{observer:'x\nop x'},{observer:'LabBot'},{offset:[0,3,0]},{offset:[Infinity,3,5]}])assert.throws(()=>cameraPack(config),/invalid_camera/);
});
