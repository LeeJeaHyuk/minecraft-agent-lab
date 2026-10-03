export function cameraPack({observer='ObserverPlayer',target='LabBot',offset=[4,2.5,4]}={}){
  if(![observer,target].every(name=>/^[A-Za-z0-9_]{1,16}$/.test(name))||observer===target)throw new Error('invalid_camera_players');
  if(offset.length!==3||!offset.every(n=>Number.isFinite(n)&&Math.abs(n)<=16)||Math.hypot(offset[0],offset[2])<2)throw new Error('invalid_camera_offset');
  const relative=offset.map(n=>`~${n}`).join(' ');
  return {
    'pack.mcmeta':JSON.stringify({pack:{pack_format:48,description:'External observer camera; only moves the tagged human spectator'}}),
    'data/minecraft/tags/function/tick.json':JSON.stringify({values:['lab_camera:tick']}),
    'data/lab_camera/function/tick.mcfunction':`execute if entity @a[name=${observer},tag=lab_camera_follow,gamemode=spectator] as ${target} at @s anchored eyes run teleport ${observer} ${relative} facing entity ${target} eyes\n`,
    'data/lab_camera/function/start.mcfunction':`gamemode spectator ${observer}\nexecute as ${observer} run spectate\ntag ${observer} add lab_camera_follow\n`,
    'data/lab_camera/function/stop.mcfunction':`tag ${observer} remove lab_camera_follow\n`
  };
}
