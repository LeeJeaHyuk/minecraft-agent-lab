import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {cameraPack} from '../observer/camera-pack.mjs';
const observer=process.env.MC_OBSERVER??'ObserverPlayer',target=process.env.MC_USERNAME??'LabBot';
const directory=resolve('server/minecraft/world/datapacks/lab_camera');
for(const [name,text] of Object.entries(cameraPack({observer,target}))){const file=join(directory,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,text);}
console.log(JSON.stringify({directory,observer,target,offset:[4,2.5,4],activate:['reload','function lab_camera:start'],stop:'function lab_camera:stop'}));
