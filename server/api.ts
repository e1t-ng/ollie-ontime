import {randomUUID} from 'node:crypto';
import {eq,or} from 'drizzle-orm';
import {z} from 'zod';
import {accounts,profiles,calendars,sessions} from '../db/schema';
import type {Database} from './database';
import {ApiError,body,ensure,json,username,timeZone,birthday} from './http';
import {createSession,currentUser,requireUser,sessionCookie,sessionToken,digest,hashPassword,verifyPassword,fakePasswordHash,rateLimit} from './auth';
import {googleRoute} from './google';
import type {GoogleConfig} from './config';
import {socialRoute} from './social';
import {friendsRoute} from './friends';
import {calendarRoute} from './calendar';
import {pollRoute} from './polls';
import {discoveryRoute} from './discovery';

export type Context={db:Database;mode:string;origins:string[];appOrigin:string;google:GoogleConfig|null;ticketmasterKey?:string;secureCookies:boolean;clientAddress:string};
export const MIN_PASSWORD=15;
// The sign-up form collects the profile details in the same flow, so they are written
// with the account instead of leaving a half-filled profile behind on a failed follow-up.
const registration=z.object({email:z.string().trim().toLowerCase().email().max(254),username,password:z.string().min(MIN_PASSWORD).max(128),name:z.string().trim().min(1).max(100),timeZone:timeZone.default('UTC'),
  birthday:birthday.default(''),gender:z.enum(['Woman','Man','Non-binary','Prefer not to say','']).default(''),phone:z.string().trim().max(20).default(''),eventRecommendations:z.boolean().default(false)}).strict();
function databaseCode(error:unknown):string|undefined{if(!error||typeof error!=='object')return;const e=error as {code?:string;cause?:unknown};return e.code??databaseCode(e.cause)}
export async function handleRequest(req:Request,ctx:Context):Promise<Response>{
  const origin=req.headers.get('origin');
  const finish=(response:Response)=>{
    if(origin&&ctx.origins.includes(origin)){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Access-Control-Allow-Credentials','true');response.headers.set('Vary','Origin')}
    return response;
  };
  try{
    const path=new URL(req.url).pathname.replace(/\/$/,'');
    if(req.method==='OPTIONS'){
      ensure(origin&&ctx.origins.includes(origin),403,'Origin not allowed.');
      return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET, POST, PATCH, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
    }
    if(!['GET','HEAD'].includes(req.method)){
      ensure(req.headers.get('sec-fetch-site')!=='cross-site',403,'Cross-site request not allowed.');
      ensure(!origin||ctx.origins.includes(origin),403,'Origin not allowed.');
    }
    let response:Response;
    if(path==='/api/health'&&req.method==='GET')response=json({ok:true,storage:ctx.mode});
    else if(path.startsWith('/api/auth/google')||path==='/api/auth/providers'){
      const handled=await googleRoute(req,ctx,path);
      if(!handled)return finish(json({error:'Endpoint not found.'},404));
      response=handled;
    }
    else if(path==='/api/auth/register'&&req.method==='POST'){
      await rateLimit(ctx.db,'register:'+ctx.clientAddress,10);
      const b=await body(req,registration),passwordHash=await hashPassword(b.password),userId=randomUUID();
      const token=await ctx.db.transaction(async tx=>{
        await tx.insert(accounts).values({id:userId,email:b.email,username:b.username,passwordHash});
        await tx.insert(profiles).values({owner:userId,name:b.name,timeZone:b.timeZone,birthday:b.birthday,gender:b.gender,phone:b.phone,eventRecommendations:b.eventRecommendations});
        await tx.insert(calendars).values({id:'personal-'+userId,owner:userId,name:'Personal',color:'0'});
        return createSession(tx,userId,sessionToken(req));
      });response=json({user:{id:userId,email:b.email,username:b.username,name:b.name}},201,{'Set-Cookie':sessionCookie(token,ctx.secureCookies)});
    }else if(path==='/api/auth/login'&&req.method==='POST'){
      await rateLimit(ctx.db,'login-ip:'+ctx.clientAddress,50);
      const b=await body(req,z.object({identifier:z.string().trim().toLowerCase().min(1).max(254),password:z.string().min(1).max(128)}));
      await rateLimit(ctx.db,'login-user:'+b.identifier,15);
      const [account]=await ctx.db.select().from(accounts).where(or(eq(accounts.email,b.identifier),eq(accounts.username,b.identifier))).limit(1);
      const valid=await verifyPassword(account?.passwordHash??await fakePasswordHash(),b.password);
      // Google-only accounts have no password; the reply stays identical either way.
      ensure(account?.passwordHash&&valid,401,'Invalid username/email or password.');
      const token=await createSession(ctx.db,account.id,sessionToken(req));
      response=json({user:{id:account.id,email:account.email,username:account.username}},200,{'Set-Cookie':sessionCookie(token,ctx.secureCookies)});
    }else if(path==='/api/auth/logout'&&req.method==='POST'){
      const token=sessionToken(req);if(token)await ctx.db.delete(sessions).where(eq(sessions.tokenHash,digest(token)));
      response=json({ok:true},200,{'Set-Cookie':sessionCookie('',ctx.secureCookies,true)});
    }else if(path==='/api/auth/me'&&req.method==='GET')response=json({user:await currentUser(ctx.db,req)});
    else{
      const user=await requireUser(ctx.db,req);
      response=await friendsRoute(req,ctx.db,user,path)??await socialRoute(req,ctx.db,user,path)??await calendarRoute(req,ctx.db,user,path)??await pollRoute(req,ctx.db,user,path)??await discoveryRoute(req,ctx.db,user,path,ctx.ticketmasterKey)??json({error:'Endpoint not found.'},404);
    }
    return finish(response);
  }catch(error){
    if(error instanceof ApiError)return finish(json({error:error.message},error.status));
    if(error instanceof z.ZodError)return finish(json({error:error.issues[0]?.message??'Invalid input.'},400));
    if(databaseCode(error)==='23505')return finish(json({error:'That account or record already exists.'},409));
    // Driver errors can contain SQL parameters; never log passwords or database URLs.
    console.error('OnTime API request failed.',{path:new URL(req.url).pathname,code:databaseCode(error)??'internal'});
    return finish(json({error:'Unable to complete this request. Please retry.'},503));
  }
}
