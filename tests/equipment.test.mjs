import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {equipment,executeEquipment} from '../environment/equipment.mjs';
test('equipping armor requires the real armor slot to contain the item',async()=>{
  const slots=[],bot={inventory:{slots,items:()=>[{name:'iron_helmet'}]},equip:async()=>{}};
  const candidate={skill:'equip_gear',arguments:{item:'iron_helmet',destination:'head'}};
  await assert.rejects(executeEquipment(bot,candidate,()=>{}),/equipment_not_confirmed/);
  bot.equip=async()=>{slots[5]={name:'iron_helmet'};};await executeEquipment(bot,candidate,()=>{});assert.equal(equipment(bot).head,'iron_helmet');
});
test('smelting rejects phantom output and closes the furnace on failure',async()=>{
  let items=[{name:'raw_iron',count:3},{name:'coal',count:1}],closed=false,acquire=true,output=null;
  const furnace={items:()=>items,inputItem:()=>null,outputItem:()=>output,fuelItem:()=>null,putInput:async()=>{items=[];output={name:'iron_ingot',count:3};},putFuel:async()=>{},takeOutput:async()=>{if(acquire)items=[{name:'iron_ingot',count:3}];output=null;},close:()=>{closed=true;}};
  const bot={openFurnace:async()=>furnace,blockAt:()=>({name:'furnace'}),registry:{itemsByName:{raw_iron:{id:1},coal:{id:2}}}};
  const candidate={skill:'smelt_iron',arguments:{x:0,y:0,z:0,count:3}};
  const result=await executeEquipment(bot,candidate,()=>{});assert.equal(result.inventory.iron_ingot,3);assert.ok(closed);
  items=[{name:'raw_iron',count:3},{name:'coal',count:1}];closed=false;acquire=false;
  await assert.rejects(executeEquipment(bot,candidate,()=>{}),/smelt_not_confirmed/);assert.ok(closed);
  closed=false;furnace.inputItem=()=>({name:'raw_iron',count:1});await assert.rejects(executeEquipment(bot,candidate,()=>{}),/furnace_requires_recovery/);assert.ok(closed);
});
