import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {worldSeed,propertiesForSeed} from '../environment/seed.mjs';
const eula=await readFile('server/minecraft/eula.txt','utf8');
if(!/^eula=true\s*$/m.test(eula))throw new Error('Minecraft EULA must be accepted by the user in server/minecraft/eula.txt');
const properties=await readFile('server/minecraft/server.properties','utf8');
let worldExists=false;try{worldExists=(await stat('server/minecraft/world')).isDirectory();}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile('server/minecraft/server.properties',propertiesForSeed(properties,worldSeed(),worldExists));
const child=spawn(process.env.JAVA_PATH??'java',['-XX:ActiveProcessorCount=2','-Xms512M','-Xmx1536M','-jar','server.jar','nogui'],{cwd:'server/minecraft',stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
if(child.pid){await mkdir('.runtime',{recursive:true});await writeFile('.runtime/server.pid',String(child.pid));}
