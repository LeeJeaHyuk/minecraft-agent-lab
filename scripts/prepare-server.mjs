import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {worldSeed} from '../environment/seed.mjs';
const version=process.env.MC_VERSION??'1.21.1';
const manifest=await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json').then(r=>r.json());
const entry=manifest.versions.find(v=>v.id===version);if(!entry)throw new Error('unknown_minecraft_version');
const details=await fetch(entry.url).then(r=>r.json());const download=details.downloads.server;
const dir='server/minecraft';await mkdir(dir,{recursive:true});
let bytes;try{bytes=await readFile(`${dir}/server.jar`);}catch{}
if(!bytes || createHash('sha1').update(bytes).digest('hex')!==download.sha1){
  const response=await fetch(download.url);if(!response.ok)throw new Error('server_download_failed');
  bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha1').update(bytes).digest('hex')!==download.sha1)throw new Error('server_checksum_mismatch');
  await writeFile(`${dir}/server.jar`,bytes);
}
await writeFile(`${dir}/version.json`,JSON.stringify({minecraft:version,server_sha1:download.sha1,java_major:details.javaVersion.majorVersion},null,2));
const properties=`server-ip=127.0.0.1\nserver-port=${process.env.MC_PORT??25565}\nlevel-name=world\nlevel-seed=${worldSeed()}\nonline-mode=false\ngamemode=survival\ndifficulty=normal\nspawn-protection=0\nview-distance=4\nsimulation-distance=4\nmax-players=4\nallow-flight=true\nenable-command-block=false\n`;
try{await writeFile(`${dir}/server.properties`,properties,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
try{await writeFile(`${dir}/eula.txt`,'# Review https://www.minecraft.net/eula before accepting\neula=false\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
console.log({prepared:true,version,java_major:details.javaVersion.majorVersion,eula_requires_acceptance:true});
