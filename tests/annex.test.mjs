import test from 'node:test';
import assert from 'node:assert/strict';
import {corridorBlueprint} from '../environment/annex.mjs';
test('annex connector adds a roofed passage and opens only the intended rear doorway',()=>{
 const home={point:{x:14,y:72,z:234}},annex={site:{origin:{x:14,y:71,z:238}},openings:[[1,1,0],[1,2,0]]};
 const corridor=corridorBlueprint(home,annex,[{name:'cobblestone',count:14}]);
 assert.equal(corridor.cells.length,12);assert.ok(corridor.cells.every(q=>q.z>235&&q.z<238));
 assert.deepEqual(corridor.clear.filter(q=>q.z===235),[{x:15,y:72,z:235},{x:15,y:73,z:235}]);
 assert.ok(corridor.cells.some(q=>q.x===15&&q.y===74&&q.z===236));
 assert.throws(()=>corridorBlueprint(home,{...annex,site:{origin:{x:20,y:71,z:238}}},[{name:'cobblestone',count:20}]),/aligned/);
 assert.throws(()=>corridorBlueprint(home,annex,[]),/materials_missing/);
});
