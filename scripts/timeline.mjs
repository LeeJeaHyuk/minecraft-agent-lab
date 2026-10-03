import {readFile} from 'node:fs/promises';
const file=process.argv[2];if(!file)throw new Error('usage: node scripts/timeline.mjs logs/RUN_ID.jsonl');
for(const line of (await readFile(file,'utf8')).trim().split('\n')){
  const row=JSON.parse(line);console.log(`${row.step}\t${row.policy_name}\t${row.selected_action}\t${row.decision_latency_ms??'-'}ms\t${row.action_status}\t${row.action_duration_ms}ms\t${row.error??''}`);
}
