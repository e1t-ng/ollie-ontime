import {randomBytes,createHash} from 'node:crypto';
import {hash,verify} from '@node-rs/argon2';
import {and,eq,gt,sql} from 'drizzle-orm';
import {accounts,sessions,authLimits} from '../db/schema';
import type {Database} from './database';
import {ApiError} from './http';

export const COOKIE='ontime_session';
export const SESSION_SECONDS=7*24*60*60;
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
// Algorithm 2 is Argon2id; the package exports an ambient const enum.
export const hashPassword=(password:string)=>hash(password,{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1});
export const verifyPassword=(encoded:string,password:string)=>verify(encoded,password);
let dummyHash:Promise<string>|undefined;
export function fakePasswordHash(){return dummyHash??=hashPassword(randomBytes(32).toString('hex'))}
export function sessionToken(request:Request){
  const value=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  return value&&/^[a-f0-9]{64}$/.test(value)?value:null;
}
export function sessionCookie(token:string,secure:boolean,remove=false){
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove?0:SESSION_SECONDS}${secure?'; Secure':''}`;
}
export async function createSession(db:Database,userId:string,oldToken:string|null){
  const token=randomBytes(32).toString('hex');
  if(oldToken)await db.delete(sessions).where(eq(sessions.tokenHash,digest(oldToken)));
  await db.insert(sessions).values({tokenHash:digest(token),userId,expiresAt:new Date(Date.now()+SESSION_SECONDS*1000)});
  return token;
}
export async function currentUser(db:Database,request:Request){
  const token=sessionToken(request);if(!token)return null;
  const [row]=await db.select({id:accounts.id,email:accounts.email,username:accounts.username}).from(sessions)
    .innerJoin(accounts,eq(accounts.id,sessions.userId)).where(and(eq(sessions.tokenHash,digest(token)),gt(sessions.expiresAt,new Date()))).limit(1);
  return row??null;
}
export type User=NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export async function requireUser(db:Database,request:Request){const user=await currentUser(db,request);if(!user)throw new ApiError(401,'Sign in to continue.');return user;}

// Atomic counters in SQL work across processes. Do not trust forwarded IP headers.
export async function rateLimit(db:Database,key:string,limit:number,seconds=900){
  const now=new Date(),resetAt=new Date(Date.now()+seconds*1000);
  const [row]=await db.insert(authLimits).values({key:digest(key),count:1,resetAt}).onConflictDoUpdate({target:authLimits.key,set:{
    count:sql`case when ${authLimits.resetAt} <= ${now.toISOString()}::timestamptz then 1 else ${authLimits.count} + 1 end`,
    resetAt:sql`case when ${authLimits.resetAt} <= ${now.toISOString()}::timestamptz then ${resetAt.toISOString()}::timestamptz else ${authLimits.resetAt} end`,
  }}).returning({count:authLimits.count});
  if(row.count>limit)throw new ApiError(429,'Too many attempts. Please try again later.');
}
