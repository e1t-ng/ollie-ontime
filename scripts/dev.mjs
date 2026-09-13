import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
for(const file of ['.env.local','.env','.dev.vars'])if(existsSync(file))loadEnvFile(file);
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();setTimeout(()=>process.exit(code),500).unref()}
function run(args){const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});children.push(child);child.on('exit',code=>stop(code??1));child.on('error',()=>stop(1));return child}
run(['--import','tsx','server/main.ts']);
let ready=false;
for(let attempt=0;attempt<100&&!stopping;attempt++){
  try{const response=await fetch(`http://127.0.0.1:${process.env.API_PORT||3001}/api/health`);if(response.ok){ready=true;break}}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
}
if(!ready){console.error('API did not start. Check the database configuration and API port.');stop(1)}
else run(['scripts/run-framework.mjs','dev',...process.argv.slice(2)]);
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
