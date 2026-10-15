import {jsonRequest} from '../models/http.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const base=`http://127.0.0.1:${process.env.API_PORT??18765}`;
const args=process.argv.slice(2),detached=args.includes('--detach'),resume=args.includes('--resume');
const goal=args.filter(a=>!['--detach','--resume'].includes(a)).join(' ').trim();
if(!goal)throw Error('usage: npm run autonomous -- "goal" [--detach], or --resume task-id');
const task=await jsonRequest(base+(resume?`/tasks/${goal}/resume`:'/tasks'),{body:resume?{}:{goal},timeoutMs:30000});
console.log(JSON.stringify({id:task.id,goal:task.goal,status:task.status}));
if(!detached){
  let cancelling=false,last='';
  process.once('SIGINT',()=>{cancelling=true;jsonRequest(`${base}/tasks/${task.id}/cancel`,{body:{}}).catch(error=>console.error(error.message));});
  while(true){
    const current=await jsonRequest(`${base}/tasks/${task.id}`);
    const summary={status:current.status,phase:current.phase,summary:current.plan?.summary,action:current.last_action,reason:current.reason};
    const text=JSON.stringify(summary);if(text!==last){console.log(text);last=text;}
    if(!['starting','running','cancelling'].includes(current.status)){process.exitCode=current.status==='succeeded'?0:cancelling?130:1;break;}
    await delay(2000);
  }
}
