import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {homedir,hostname,userInfo} from 'node:os';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const rules=[
 ['private-user-path',/(?:[A-Z]:[\\/]Users[\\/][^\s"'<>]+|\/home\/[^\s/"']+|\/mnt\/[a-z]\/Users\/[^\s/"']+)/i],
 ['private-network-address',/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
 ['credential-format',/\b(?:gh[pousr]_|github_pat_|hf_|sk-)[A-Za-z0-9_-]{20,}/],
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const denyValues=[homedir(),hostname(),userInfo().username].filter(v=>v.length>4);
const denyArg=process.argv.indexOf('--deny-values-file');
if(denyArg>=0)denyValues.push(...JSON.parse(readFileSync(process.argv[denyArg+1],'utf8')));
const findings=[];
for(const file of new Set(files)){
 if(/^(?:\.runtime|logs|node_modules|\.vendor|server\/minecraft)\//.test(file)||/^\.env(?:$|\.)/.test(file)&&file!=='.env.example'||/^(?:VALIDATION|DEFENSE-DIAGNOSIS)\.md$/.test(file)||/\.(?:mkv|mp4|gguf|safetensors|pem|key|pid|log)$/.test(file)||/configure-remote-qwen38\.py$|wait-for-measurements\.ps1$/.test(file))findings.push({file,rule:'private-artifact'});
 if(!existsSync(file))continue;
 const text=readFileSync(file,'utf8');
 for(const [rule,pattern] of rules)if(pattern.test(text))findings.push({file,rule});
 if(denyValues.some(value=>value.length>=5&&text.toLowerCase().includes(value.toLowerCase())))findings.push({file,rule:'local-private-value'});
 if(file==='.env.example')for(const line of text.split(/\r?\n/))if(/^[A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)[A-Z_]*=.+/.test(line))findings.push({file,rule:'nonempty-example-credential'});
}
// Validate all reachable authors as well as working-tree contents.
let commits=[];try{commits=execFileSync('git',['log','--all','--format=%ae %ce'],{encoding:'utf8'}).trim().split('\n');}catch{}
for(const row of commits)if(row&&row.split(' ').some(email=>!email.endsWith('@users.noreply.github.com')))findings.push({file:'git-history',rule:'non-public-author-email'});
console.log(JSON.stringify({files_scanned:new Set(files).size,findings},null,2));
if(findings.length)process.exitCode=1;
