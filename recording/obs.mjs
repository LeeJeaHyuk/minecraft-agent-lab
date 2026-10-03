import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
export class ObsClient{
  constructor({url=process.env.OBS_URL??'ws://127.0.0.1:4455',password,timeoutMs=10000}={}){this.url=url;this.password=password;this.timeoutMs=timeoutMs;this.pending=new Map();}
  async connect(){
    const address=new URL(this.url);if(!['127.0.0.1','localhost','[::1]'].includes(address.hostname))throw new Error('obs_requires_loopback');
    if(this.password===undefined){const c=JSON.parse((await readFile(join(process.env.APPDATA,'obs-studio/plugin_config/obs-websocket/config.json'),'utf8')).replace(/^\uFEFF/,''));this.password=c.server_password??'';}
    this.socket=new WebSocket(this.url);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('obs_connect_timeout')),this.timeoutMs);
      const fail=()=>{clearTimeout(timer);reject(new Error('obs_connection_closed'));};
      this.socket.addEventListener('error',fail);this.socket.addEventListener('close',()=>{fail();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('obs_connection_closed'));}this.pending.clear();});
      this.socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.op===0){
          const d={rpcVersion:1,eventSubscriptions:0},auth=message.d.authentication;
          if(auth){const hash=s=>createHash('sha256').update(s).digest('base64');d.authentication=hash(hash(this.password+auth.salt)+auth.challenge);}
          this.socket.send(JSON.stringify({op:1,d}));
        }else if(message.op===2){clearTimeout(timer);resolve();}
        else if(message.op===7){const p=this.pending.get(message.d.requestId);if(!p)return;this.pending.delete(message.d.requestId);clearTimeout(p.timer);message.d.requestStatus.result?p.resolve(message.d.responseData??{}):p.reject(new Error(`obs_${message.d.requestType}_${message.d.requestStatus.code}:${message.d.requestStatus.comment??''}`));}
      });
    });return this;
  }
  request(requestType,requestData={}){
    const requestId=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('obs_request_timeout:'+requestType));},this.timeoutMs);
      this.pending.set(requestId,{resolve,reject,timer});this.socket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));
    });
  }
  close(){this.socket?.close();}
}
export class TaskRecording{
  constructor({enabled=process.env.OBS_RECORD_TASKS==='true',handleSignals=true,client=new ObsClient(),onEvent=()=>{},save=async metadata=>{await mkdir('.runtime/recordings',{recursive:true});await writeFile('.runtime/latest-recording.json',JSON.stringify(metadata,null,2));}}={}){this.enabled=enabled;this.handleSignals=handleSignals;this.client=client;this.onEvent=onEvent;this.save=save;this.owned=false;}
  async start(goal){
    if(!this.enabled)return;
    try{
      await this.client.connect();
      const status=await this.client.request('GetRecordStatus');if(status.outputActive)throw new Error('obs_recording_already_active');
      const scene=await this.client.request('GetCurrentProgramScene');if(scene.currentProgramSceneName!==(process.env.OBS_SCENE??'Minecraft Agent Lab'))throw new Error('obs_wrong_scene');
      await this.client.request('StartRecord');
      let active=false;for(let i=0;i<40;i++){active=(await this.client.request('GetRecordStatus')).outputActive;if(active)break;await delay(100);}
      if(!active)throw new Error('obs_recording_did_not_start');this.owned=true;
      this.signalHandler=()=>{this.stop('interrupted').catch(error=>this.onEvent('recording_error',{error:error.message})).finally(()=>process.exit(130));};
      if(this.handleSignals){process.once('SIGINT',this.signalHandler);process.once('SIGTERM',this.signalHandler);}
      this.metadata={goal,started:new Date().toISOString(),status:'recording',scene:scene.currentProgramSceneName};this.onEvent('recording_started',this.metadata);
    }catch(error){this.client.close();throw error;}
  }
  async stop(outcome){
    if(this.signalHandler){process.removeListener('SIGINT',this.signalHandler);process.removeListener('SIGTERM',this.signalHandler);}
    if(!this.owned){this.client.close();return null;}
    try{
      const result=await this.client.request('StopRecord');this.owned=false;
      const metadata={...this.metadata,finished:new Date().toISOString(),status:outcome,output_path:result.outputPath};
      await this.save(metadata);
      this.onEvent('recording_saved',metadata);return metadata;
    }finally{this.client.close();}
  }
}
