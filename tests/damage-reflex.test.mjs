import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installDamageReflex} from '../environment/damage-reflex.mjs';
test('damage stops motor actions and uses offhand shield without waiting for a policy',()=>{
  const bot=new EventEmitter(),calls=[];
  Object.assign(bot,{health:20,entities:{},inventory:{slots:{45:{name:'shield'}}},pathfinder:{setGoal:g=>calls.push(['goal',g])},stopDigging:()=>calls.push('dig'),clearControlStates:()=>calls.push('controls'),activateItem:off=>calls.push(['shield',off]),deactivateItem:()=>calls.push('release')});
  let event;const close=installDamageReflex(bot,{interrupt:()=>calls.push('interrupt'),onEvent:e=>event=e});
  bot.emit('spawn');bot.emit('health');assert.deepEqual(calls,[]);
  bot.health=19;bot.emit('health');
  assert.deepEqual(calls,['interrupt',['goal',null],'dig','controls',['shield',true]]);
  assert.equal(event.before,20);assert.equal(event.after,19);assert.equal(event.shield,true);
  bot.health=20;bot.emit('health');assert.equal(calls.length,5);close();
});
