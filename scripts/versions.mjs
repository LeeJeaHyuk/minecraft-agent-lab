import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
async function json(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
function command(program,args){try{return execFileSync(program,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();}catch{return null;}}
const server=await json('server/minecraft/version.json'),kev=await json('.runtime/kev-model.json'),runtime=await json('.runtime/kev-smoke.json'),qwen=await json('.runtime/qwen-ubuntu-activation.json');
const properties=await readFile('server/minecraft/server.properties','utf8');
const record={node:process.version,python:command('wsl',['-d','Ubuntu-22.04','--','bash','-lc','$HOME/.local/share/minecraft-agent-lab/kev-venv/bin/python --version']),
  java:command(process.env.JAVA_PATH??'java',['--version'])?.split('\n')[0]??null,minecraft:server,
  mineflayer:(await json('node_modules/mineflayer/package.json'))?.version,pathfinder:(await json('node_modules/mineflayer-pathfinder/package.json'))?.version,
  kev_repository_sha:command('git',['-C','.vendor/kev','rev-parse','HEAD']),kev_model:kev?{identifier:kev.model_identifier,revision:kev.model_revision,base:kev.base_identifier,base_revision:kev.base_revision}:null,
  kev_runtime:runtime?{device:runtime.model_card.device,dtype:runtime.model_card.dtype,quantization:null,latency_ms:runtime.decision.latency_ms}:null,
  qwen_endpoint_type:'OpenAI-compatible HTTP over SSH',qwen_model:process.env.QWEN_MODEL??null,qwen_source:qwen?{registry:qwen.registry,revision:qwen.revision,runtime_revision:qwen.runtime_revision}:null,
  world_seed:properties.match(/^level-seed=(.*)$/m)?.[1]?.trim()??null,environment_commit_sha:command('git',['rev-parse','HEAD']),
  environment_dirty:Boolean(command('git',['status','--porcelain'])),timestamp:new Date().toISOString()};
await mkdir('.runtime',{recursive:true});await writeFile('.runtime/versions.json',JSON.stringify(record,null,2));console.log(record);
