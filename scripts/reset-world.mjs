import {rename,mkdir,readFile} from 'node:fs/promises';
import {connect} from 'node:net';
const host=process.env.MC_HOST??'127.0.0.1',port=Number(process.env.MC_PORT??25565);
if(host!=='127.0.0.1')throw new Error('world_reset_requires_local_server');
try{
  const pid=Number(await readFile('.runtime/server.pid','utf8'));
  if(Number.isInteger(pid) && pid>0){try{process.kill(pid,0);throw new Error('stop_server_before_world_reset');}catch(error){if(error.code!=='ESRCH')throw error;}}
}catch(error){if(error.code!=='ENOENT')throw error;}
const listening=await new Promise(resolve=>{const socket=connect({host,port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(true);});});
if(listening)throw new Error('stop_server_before_world_reset');
const properties=await readFile('server/minecraft/server.properties','utf8');
if(!/^level-name=world\s*$/m.test(properties))throw new Error('unexpected_world_path');
await mkdir('server/minecraft/backups',{recursive:true});
try{await rename('server/minecraft/world',`server/minecraft/backups/world-${Date.now()}`);}catch(e){if(e.code!=='ENOENT')throw e;}
console.log({status:'world_archived',next_start:'regenerates same seed from server.properties'});
