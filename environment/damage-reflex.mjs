// Immediate motor safety; strategic goals and subsequent choices remain with the policies.
export function installDamageReflex(bot,{interrupt,onEvent=()=>{},now=Date.now}={}){
  let previous,releaseTimer;
  const health=()=>{
    const before=previous;previous=bot.health;
    if(!Number.isFinite(before)||bot.health>=before||bot.health<=0)return;
    const started=now();interrupt?.();
    bot.pathfinder.setGoal(null);bot.stopDigging();bot.clearControlStates();
    const shield=bot.inventory.slots[45]?.name==='shield';
    if(shield)bot.activateItem(true);
    const target=Object.values(bot.entities).filter(e=>['zombie','skeleton','spider','husk','stray','drowned','pillager'].includes(e.name)&&e.position.distanceTo(bot.entity.position)<12)
      .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
    if(shield&&target)Promise.resolve(bot.lookAt(target.position.offset(0,1,0),true)).catch(()=>{});
    clearTimeout(releaseTimer);releaseTimer=setTimeout(()=>{if(!bot.safetyCombatActive)bot.deactivateItem();},2500);releaseTimer.unref?.();
    onEvent({time:started,before,after:bot.health,shield,target_id:target?.id??null,dispatch_ms:now()-started});
  };
  const spawn=()=>{previous=bot.health;};
  const close=()=>{clearTimeout(releaseTimer);bot.removeListener('health',health);};
  bot.on('spawn',spawn);bot.on('health',health);bot.once('end',close);
  return close;
}
