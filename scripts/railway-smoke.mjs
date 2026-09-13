import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

// Test the built Node frontend and its API proxy without using real credentials.
const backend=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/health')return res.end(JSON.stringify({ok:true,storage:'smoke'}));
  if(req.url==='/api/auth/providers')return res.end(JSON.stringify({google:true}));
  if(req.url==='/api/auth/me')return res.end(JSON.stringify({cookie:req.headers.cookie}));
  if(req.url==='/api/auth/google/start'){
    res.writeHead(302,{Location:'https://accounts.google.com/', 'Set-Cookie':['ontime_session=smoke; Path=/; HttpOnly','ontime_oauth=; Path=/api/auth/google; Max-Age=0']});
    return res.end();
  }
  res.writeHead(404);res.end('{}');
});
await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
const port=Number(process.env.SMOKE_PORT||5417);
const child=spawn(process.execPath,['dist/standalone/server.js'],{stdio:'inherit',env:{...process.env,PORT:String(port),HOST:'127.0.0.1',API_BASE_URL:`http://127.0.0.1:${backend.address().port}`}});
const base=`http://127.0.0.1:${port}`;
try{
  let ready=false;
  for(let i=0;i<60;i++){
    try{const r=await fetch(base+'/api/health');if(r.ok){assert.equal((await r.json()).storage,'smoke');ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Standalone server must become ready');
  for(const path of ['/','/login.html','/login.css','/login.js','/friends','/polls','/discover']){
    const r=await fetch(base+path);assert.equal(r.status,200,path);
  }
  const login=await fetch(base+'/login',{redirect:'manual'});
  assert.ok([302,307,308].includes(login.status));
  assert.equal(login.headers.get('location'),'/login.html');
  const me=await fetch(base+'/api/auth/me',{headers:{cookie:'ontime_session=test'}});
  assert.equal((await me.json()).cookie,'ontime_session=test');
  const google=await fetch(base+'/api/auth/google/start',{redirect:'manual'});
  assert.equal(google.status,302);
  assert.equal(google.headers.get('location'),'https://accounts.google.com/');
  assert.equal(google.headers.getSetCookie().length,2,'OAuth must preserve both session cookies');
  console.log('Railway standalone smoke checks passed: pages, login redirect, proxy, cookies, OAuth redirect.');
}finally{
  child.kill();
  await new Promise(resolve=>backend.close(resolve));
}
