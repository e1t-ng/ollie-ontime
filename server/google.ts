import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {eq,lt} from 'drizzle-orm';
import {accounts,profiles,calendars,oauthStates} from '../db/schema';
import type {Database} from './database';
import type {GoogleConfig} from './config';
import {ApiError,ensure,json} from './http';
import {createSession,sessionToken,sessionCookie,digest,rateLimit} from './auth';

const AUTHORIZE='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const ISSUERS=['https://accounts.google.com','accounts.google.com'];
const STATE_SECONDS=600;
export const OAUTH_COOKIE='ontime_oauth';
const OAUTH_PATH='/api/auth/google';

const base64url=(value:Buffer)=>value.toString('base64url');
const challengeFor=(verifier:string)=>base64url(createHash('sha256').update(verifier).digest());

export function bindingCookie(value:string,secure:boolean,remove=false){
  return `${OAUTH_COOKIE}=${value}; Path=${OAUTH_PATH}; HttpOnly; SameSite=Lax; Max-Age=${remove?0:STATE_SECONDS}${secure?'; Secure':''}`;
}
function readBinding(request:Request){
  const value=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(OAUTH_COOKIE+'='))?.slice(OAUTH_COOKIE.length+1);
  return value&&/^[a-f0-9]{64}$/.test(value)?value:null;
}
// Only same-site paths are accepted, so a crafted link cannot bounce a signed-in
// browser to another host after the handshake.
export function safeReturnTo(value:string|null){
  if(!value||!value.startsWith('/')||value.startsWith('//'))return '/';
  return value.length<=200?value:'/';
}
function redirect(location:string,cookies:string[]=[]){
  const headers=new Headers({Location:location,'Cache-Control':'no-store'});
  for(const cookie of cookies)headers.append('Set-Cookie',cookie);
  return new Response(null,{status:302,headers});
}
const signInPage=(appOrigin:string,params:Record<string,string>)=>appOrigin+'/login.html'+(Object.keys(params).length?'?'+new URLSearchParams(params):'');

type IdentityClaims={sub:string;email:string;emailVerified:boolean;name:string};
// The ID token arrives over TLS straight from Google's token endpoint, so Google
// documents signature verification as unnecessary here; the claims are still checked.
function readIdentity(idToken:string,clientId:string):IdentityClaims{
  const segment=idToken.split('.')[1];
  ensure(segment,502,'Google returned an unreadable sign-in token.');
  let claims:Record<string,unknown>;
  try{claims=JSON.parse(Buffer.from(segment,'base64url').toString('utf8'))}catch{throw new ApiError(502,'Google returned an unreadable sign-in token.')}
  const {iss,aud,exp,sub,email,email_verified:verified,name}=claims as Record<string,string|number|boolean>;
  ensure(typeof iss==='string'&&ISSUERS.includes(iss),502,'Google sign-in token has an unexpected issuer.');
  ensure(aud===clientId,502,'Google sign-in token was issued for another application.');
  ensure(typeof exp==='number'&&exp*1000>Date.now(),502,'Google sign-in token has expired.');
  ensure(typeof sub==='string'&&sub.length>0&&typeof email==='string'&&email.includes('@'),502,'Google sign-in did not return an account.');
  return {sub,email:email.trim().toLowerCase(),emailVerified:verified===true||verified==='true',name:typeof name==='string'&&name.trim()?name.trim().slice(0,100):email.split('@')[0]};
}

async function exchangeCode(code:string,verifier:string,google:GoogleConfig){
  let response:Response;
  try{
    response=await fetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({code,client_id:google.clientId,client_secret:google.clientSecret,redirect_uri:google.redirectUri,grant_type:'authorization_code',code_verifier:verifier})});
  }catch{throw new ApiError(502,'Could not reach Google to finish signing in.')}
  // Failure bodies can echo the client secret; report the status only.
  ensure(response.ok,502,'Google rejected this sign-in attempt.');
  const payload=await response.json() as {id_token?:string};
  ensure(typeof payload.id_token==='string',502,'Google did not return an identity token.');
  return payload.id_token;
}

function suggestUsername(email:string){
  const base=email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,20);
  return base.length>=3?base:'ontime_'+randomBytes(3).toString('hex');
}
async function claimAccount(db:Database,identity:IdentityClaims){
  const suggestion=suggestUsername(identity.email);
  for(let attempt=0;attempt<6;attempt++){
    const username=attempt===0?suggestion:`${suggestion.slice(0,24)}${randomBytes(2).toString('hex')}`;
    const userId=randomUUID();
    try{
      await db.transaction(async tx=>{
        await tx.insert(accounts).values({id:userId,email:identity.email,username,googleSub:identity.sub});
        await tx.insert(profiles).values({owner:userId,name:identity.name,timeZone:'UTC'});
        await tx.insert(calendars).values({id:'personal-'+userId,owner:userId,name:'Personal',color:'0'});
      });
      return userId;
    }catch(error){
      const code=(error as {code?:string;cause?:{code?:string}})?.code??(error as {cause?:{code?:string}})?.cause?.code;
      // Only a username collision is worth another attempt; a duplicate email is final.
      if(code!=='23505'||attempt===5)throw error;
    }
  }
  throw new ApiError(503,'Could not create an account right now.');
}

export type GoogleContext={db:Database;google:GoogleConfig|null;appOrigin:string;secureCookies:boolean;clientAddress:string};

export async function googleRoute(req:Request,ctx:GoogleContext,path:string):Promise<Response|undefined>{
  if(path==='/api/auth/providers'&&req.method==='GET')return json({google:!!ctx.google});
  if(!path.startsWith(OAUTH_PATH)||req.method!=='GET')return;

  if(path===OAUTH_PATH+'/start'){
    if(!ctx.google)return redirect(signInPage(ctx.appOrigin,{error:'google_unavailable'}));
    // Each start writes a handshake row; cap how fast one address can create them.
    await rateLimit(ctx.db,'google-start:'+ctx.clientAddress,60);
    const url=new URL(req.url);
    const verifier=base64url(randomBytes(32)),state=randomBytes(32).toString('hex'),binding=randomBytes(32).toString('hex');
    await ctx.db.delete(oauthStates).where(lt(oauthStates.expiresAt,new Date()));
    await ctx.db.insert(oauthStates).values({state,verifier,bindingHash:digest(binding),returnTo:safeReturnTo(url.searchParams.get('next')),expiresAt:new Date(Date.now()+STATE_SECONDS*1000)});
    const authorize=new URL(AUTHORIZE);
    authorize.search=new URLSearchParams({client_id:ctx.google.clientId,redirect_uri:ctx.google.redirectUri,response_type:'code',scope:'openid email profile',
      state,code_challenge:challengeFor(verifier),code_challenge_method:'S256',access_type:'online',prompt:'select_account'}).toString();
    return redirect(authorize.toString(),[bindingCookie(binding,ctx.secureCookies)]);
  }

  if(path===OAUTH_PATH+'/callback'){
    const url=new URL(req.url),params=url.searchParams;
    const clear=bindingCookie('',ctx.secureCookies,true);
    const fail=(error:string)=>redirect(signInPage(ctx.appOrigin,{error}),[clear]);
    const state=params.get('state')??'';
    const [handshake]=/^[a-f0-9]{64}$/.test(state)?await ctx.db.delete(oauthStates).where(eq(oauthStates.state,state)).returning():[];
    if(params.get('error'))return fail(params.get('error')==='access_denied'?'google_denied':'google_failed');
    if(!ctx.google)return fail('google_unavailable');
    const binding=readBinding(req);
    if(!handshake||handshake.expiresAt.getTime()<Date.now()||!binding||digest(binding)!==handshake.bindingHash)return fail('google_expired');
    const code=params.get('code');
    if(!code)return fail('google_failed');

    let identity:IdentityClaims;
    try{identity=readIdentity(await exchangeCode(code,handshake.verifier,ctx.google),ctx.google.clientId)}
    catch(error){
      // The browser gets the sign-in screen back, not a JSON error page.
      console.error('OnTime Google sign-in failed.',{reason:error instanceof ApiError?error.message:'unexpected'});
      return fail('google_failed');
    }
    if(!identity.emailVerified)return fail('google_email');

    const [linked]=await ctx.db.select().from(accounts).where(eq(accounts.googleSub,identity.sub)).limit(1);
    let userId=linked?.id,created=false;
    if(!userId){
      // Registration does not verify email addresses, so silently adopting a matching
      // password account would let whoever registered it first capture this sign-in.
      const [existing]=await ctx.db.select({id:accounts.id}).from(accounts).where(eq(accounts.email,identity.email)).limit(1);
      if(existing)return fail('google_exists');
      userId=await claimAccount(ctx.db,identity);created=true;
    }
    const token=await createSession(ctx.db,userId,sessionToken(req));
    const destination=created?signInPage(ctx.appOrigin,{google:'new',next:handshake.returnTo}):ctx.appOrigin+handshake.returnTo;
    return redirect(destination,[sessionCookie(token,ctx.secureCookies),clear]);
  }
}
