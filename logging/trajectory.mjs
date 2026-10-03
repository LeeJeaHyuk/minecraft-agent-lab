import {mkdir,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {worldSeed} from '../environment/seed.mjs';
export class Trajectory {
  constructor(directory = 'logs') { this.directory=directory; this.seed=worldSeed(); this.runId=randomUUID(); this.episodeId=randomUUID(); this.step=0; this.queue=Promise.resolve(); }
  newEpisode() { this.episodeId=randomUUID(); this.step=0; }
  append(record) {
    const row={run_id:this.runId,episode_id:this.episodeId,step:this.step++,timestamp:new Date().toISOString(),
      world_seed:this.seed,goal:null,subgoal:null,policy_name:'external',model_name:null,model_revision:null,
      decision_latency_ms:null,planner_name:null,planner_model:null,planner_latency_ms:null,reward:null,done:false,metadata:{},...record};
    const pending=this.queue.then(()=>this.write(row));this.queue=pending.catch(()=>{});return pending;
  }
  async write(row) {
    await mkdir(this.directory,{recursive:true});
    await appendFile(`${this.directory}/${this.runId}.jsonl`,JSON.stringify(row)+'\n'); return row;
  }
}
