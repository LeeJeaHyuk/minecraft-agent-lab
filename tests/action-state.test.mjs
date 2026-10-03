import test from 'node:test';
import assert from 'node:assert/strict';
import {actionState} from '../planners/action-state.mjs';
test('Columnar action input retains every observed block coordinate and resource alternative',()=>{
  const state={player:{position:{x:1.25,y:72,z:3}},inventory:[{name:'oak_log',count:4}],goal:'house',
    nearby_blocks:[{name:'stone',position:{x:1,y:70,z:3}},{name:'oak_log',position:{x:4,y:72,z:3}}],
    resource_blocks:[{name:'oak_log',position:{x:4,y:72,z:3},distance:3,alternatives:[{position:{x:4,y:73,z:3},distance:3.1}]}]};
  const result=actionState(state,{material:'oak_log'},'materials');
  assert.deepEqual(result.nearby_block_rows.map(([name,x,y,z])=>({name,position:{x,y,z}})),state.nearby_blocks);
  assert.deepEqual(result.resource_groups[0].blocks,[[4,72,3,3],[4,73,3,3.1]]);
  assert.deepEqual(result.player,state.player);assert.deepEqual(result.inventory,state.inventory);
  assert.equal(state.nearby_blocks.length,2);
});
