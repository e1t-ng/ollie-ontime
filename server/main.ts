import {createServer} from 'node:http';
import {config} from './config';
import {connectDatabase,migrateDatabase} from './database';
import {handleRequest} from './api';
import {nodeHeaders} from './http';

const settings=config(),connection=await connectDatabase();
await migrateDatabase(connection);
const server=createServer(async(req,res)=>{
  try{
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>2_000_000){res.writeHead(413,{'Content-Type':'application/json'});res.end('{"error":"Request too large."}');return}chunks.push(Buffer.from(chunk))}
    const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(','):value);
    const request=new Request(`http://127.0.0.1:${settings.port}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method??'GET')?{body:Buffer.concat(chunks)}:{})});
    const response=await handleRequest(request,{db:connection.db,mode:connection.mode,origins:settings.origins,appOrigin:settings.appOrigin,google:settings.google,ticketmasterKey:settings.ticketmasterKey,secureCookies:settings.secureCookies,clientAddress:req.socket.remoteAddress??'unknown'});
    res.writeHead(response.status,nodeHeaders(response));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"Request failed."}')}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(settings.port,()=>console.log(`OnTime API on port ${settings.port} — storage: ${connection.mode}${connection.mode==='local'?' (persistent local PostgreSQL; not Tiger Data)':''} — Google sign-in: ${settings.google?'enabled':'not configured'}`));
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close(async()=>{await connection.close();process.exit(0)});setTimeout(()=>process.exit(1),5000).unref()}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
