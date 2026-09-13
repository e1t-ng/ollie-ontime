import {spawn} from 'node:child_process';

// Only the frontend is public. The API remains inside this service on loopback.
const children=[];
let stopping=false;
function stop(code=0){
  if(stopping)return;
  stopping=true;
  for(const child of children)child.kill('SIGTERM');
  setTimeout(()=>process.exit(code),1500);
}
function run(args,env){
  const child=spawn(process.execPath,args,{stdio:'inherit',env});
  children.push(child);
  child.on('error',()=>stop(1));
  child.on('exit',code=>stop(code||1));
}
const publicPort=process.env.PORT||'3000';
const apiPort=publicPort==='3001'?'3002':'3001';
run(['--import','tsx','server/main.ts'],{...process.env,API_PORT:apiPort});
let ready=false;
for(let i=0;i<120&&!stopping;i++){
  try{const r=await fetch(`http://127.0.0.1:${apiPort}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
}
if(!ready){console.error('OnTime API did not become ready. Check Railway variables and database access.');stop(1)}
else if(!stopping)run(['dist/standalone/server.js'],{...process.env,PORT:publicPort,HOST:'0.0.0.0',API_BASE_URL:`http://127.0.0.1:${apiPort}`});
process.on('SIGINT',()=>stop());
process.on('SIGTERM',()=>stop());
