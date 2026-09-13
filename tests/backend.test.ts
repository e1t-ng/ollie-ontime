import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import * as schema from '../db/schema';
import {migrateDatabase,type DatabaseConnection} from '../server/database';
import {handleRequest,type Context} from '../server/api';
import {rankSlots,availabilityAt} from '../server/scheduling';
import {digest,rateLimit} from '../server/auth';
import {nodeHeaders} from '../server/http';
  import {geohash,normalizeTicketmasterEvent,cityFilter,ticketmasterDate} from '../server/discovery';
import {buildGrid,toBlocks,fromBlocks,dailyWindows} from '../lib/polls';

const password='A long demo password 2026!';
const start='2030-10-01T15:00:00Z',end='2030-10-01T17:00:00Z';
test('full SQL account, profile, friendship, planning, RSVP and restart lifecycle',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ontime-test-'));
  let client=new PGlite(directory);await client.waitReady;
  let db=drizzle(client,{schema});
  const connection=():DatabaseConnection=>({db,client,mode:'local',close:()=>client.close()});
  await migrateDatabase(connection());
  const context=():Context=>({db,mode:'local',origins:['http://localhost:5173'],appOrigin:'http://localhost:5173',google:null,secureCookies:false,clientAddress:'test'});
  async function call(path:string,method='GET',data?:unknown,cookie='',expected=200){
    const response=await handleRequest(new Request('http://localhost:5173/api'+path,{method,headers:{'content-type':'application/json',origin:'http://localhost:5173',cookie},...(data===undefined?{}:{body:JSON.stringify(data)})}),context());
    // Endpoint payloads vary; runtime assertions below verify their contracts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value:any=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return {value,cookie:response.headers.get('set-cookie')?.split(';')[0]??cookie,response};
  }
  try{
    await call('/state','GET',undefined,'',401);
    const a=await call('/auth/register','POST',{email:'ALICE@example.com',username:'Alice',password,name:'Alice',timeZone:'America/Chicago'},'',201);
    const b=await call('/auth/register','POST',{email:'bob@example.com',username:'bob',password,name:'Bob'},'',201);
    const c=await call('/auth/register','POST',{email:'carol@example.com',username:'carol',password,name:'Carol'},'',201);
    assert.match(a.response.headers.get('set-cookie')!,/HttpOnly; SameSite=Lax/);
    await call('/auth/register','POST',{email:'alice@example.com',username:'another',password,name:'Duplicate'},'',409);
    const [account]=await db.select().from(schema.accounts).where(eq(schema.accounts.id,a.value.user.id));
    assert.ok(account.passwordHash);assert.match(account.passwordHash,/^\$argon2id\$/);assert.notEqual(account.passwordHash,password);
    const [session]=await db.select().from(schema.sessions).where(eq(schema.sessions.userId,a.value.user.id));
    assert.equal(session.tokenHash,digest(a.cookie.split('=')[1]));
    await call('/auth/login','POST',{identifier:'alice',password:'wrong'},'',401);
    await call('/profile','PATCH',{timeZone:'Not/AZone'},a.cookie,400);
    await call('/profile','PATCH',{birthday:'2000-02-30'},a.cookie,400);
    await call('/profile','PATCH',{name:'Alice Example',bio:'Coffee and calendars',birthday:'2000-02-29',homeCity:'Chicago, IL',locationSharing:'while_using'},a.cookie);
    const savedProfile=(await call('/profile','GET',undefined,a.cookie)).value.profile;
    assert.equal(savedProfile.homeCity,'Chicago, IL');assert.equal(savedProfile.locationSharing,'while_using');
    await call('/users/'+a.value.user.id,'GET',undefined,b.cookie,404);
    assert.equal((await call('/users?q=al','GET',undefined,b.cookie)).value.users[0].email,undefined);
    await call('/friends/requests','POST',{userId:a.value.user.id},a.cookie,400);
    const request=await call('/friends/requests','POST',{userId:b.value.user.id},a.cookie,201);
    await call('/friends/'+request.value.id,'PATCH',{action:'accept'},a.cookie,409);
    await call('/friends/'+request.value.id,'PATCH',{action:'accept'},c.cookie,404);
    await call('/friends/'+request.value.id,'PATCH',{action:'accept'},b.cookie);
    assert.equal((await call('/users/'+a.value.user.id,'GET',undefined,b.cookie)).value.profile.name,'Alice Example');
    const pollBody={title:'Hackathon celebration',durationMinutes:60,minParticipants:2,timeZone:'America/Chicago',windows:[{start,end}],invitees:[{userId:b.value.user.id,required:true}]};
    const poll=await call('/polls','POST',pollBody,a.cookie,201),pollPath='/polls/'+poll.value.id;
    await call(pollPath,'GET',undefined,c.cookie,404);
    await call(pollPath+'/availability','PUT',{blocks:[{start,end,status:'available'}]},c.cookie,404);
    let slots=(await call(pollPath+'/slots','GET',undefined,a.cookie)).value.slots;
    assert.equal(slots[0].qualified,false);assert.equal(slots[0].participants[0].status,'unknown');
    await call(pollPath+'/availability','PUT',{blocks:[{start,end,status:'preferred'}]},a.cookie);
    await call(pollPath+'/availability','PUT',{blocks:[{start,end,status:'maybe'}]},b.cookie);
    await call(pollPath+'/confirm','POST',{start},a.cookie,409);
    await call(pollPath+'/availability','PUT',{blocks:[{start,end,status:'available'}]},b.cookie);
    const busy=await call('/action','POST',{action:'save',event:{title:'Private appointment',calendar:'personal-'+b.value.user.id,start,end:'2030-10-01T16:00:00Z'}},b.cookie);
    slots=(await call(pollPath+'/slots','GET',undefined,a.cookie)).value.slots;
    assert.equal(slots[0].start,'2030-10-01T16:00:00.000Z');assert.equal(slots[0].qualified,true);
    assert.equal(JSON.stringify(slots).includes('Private appointment'),false);
    await call(pollPath+'/confirm','POST',{start},a.cookie,409);
    await call('/action','POST',{action:'delete',id:busy.value.ids[0]},a.cookie,404);
    await call('/action','POST',{action:'delete',id:busy.value.ids[0]},b.cookie);
    await call(pollPath+'/confirm','POST',{start},b.cookie,403);
    const confirmed=await call(pollPath+'/confirm','POST',{start},a.cookie);
    const again=await call(pollPath+'/confirm','POST',{start},a.cookie);
    assert.equal(confirmed.value.eventId,again.value.eventId);
    await call(pollPath+'/confirm','POST',{start:'2030-10-01T16:00:00Z'},a.cookie,409);
    await call(pollPath+'/availability','PUT',{blocks:[]},b.cookie,409);
    const stateA=(await call('/state','GET',undefined,a.cookie)).value;
    const stateB=(await call('/state','GET',undefined,b.cookie)).value;
    assert.equal(stateA.events.length,1);assert.equal(stateB.events.length,1);
    assert.equal(stateA.events[0].id,stateB.events[0].id);assert.equal(stateB.events[0].canEdit,false);
    await call('/action','POST',{action:'save',event:{...stateB.events[0],calendar:'personal-'+b.value.user.id}},b.cookie,404);
    await call('/events/'+confirmed.value.eventId+'/rsvp','POST',{status:'Going'},c.cookie,404);
    await call('/events/'+confirmed.value.eventId+'/rsvp','POST',{status:'Going'},b.cookie);
    assert.equal((await call('/state','GET',undefined,b.cookie)).value.events[0].attendance,'Going');
    const second=await call('/polls','POST',pollBody,a.cookie,201);
    for(const person of [a,b])await call('/polls/'+second.value.id+'/availability','PUT',{blocks:[{start,end,status:'available'}]},person.cookie);
    await call('/polls/'+second.value.id+'/confirm','POST',{start},a.cookie,409);
    await call('/friends/'+request.value.id,'PATCH',{action:'block'},a.cookie);
    assert.equal((await call('/users?q=al','GET',undefined,b.cookie)).value.users.length,0);
    await call('/friends/'+request.value.id,'PATCH',{action:'unblock'},b.cookie,409);
    await call('/profile','PATCH',{visibility:'private'},c.cookie);
    assert.equal((await call('/users?q=ca','GET',undefined,b.cookie)).value.users.length,0);
    const csrf=await handleRequest(new Request('http://localhost:5173/api/auth/logout',{method:'POST',headers:{origin:'https://evil.example',cookie:a.cookie}}),context());assert.equal(csrf.status,403);
    await rateLimit(db,'isolated-limit',1);await assert.rejects(()=>rateLimit(db,'isolated-limit',1),/Too many/);
    await client.close();client=new PGlite(directory);await client.waitReady;db=drizzle(client,{schema});await migrateDatabase(connection());
    assert.equal((await call('/auth/me','GET',undefined,a.cookie)).value.user.id,a.value.user.id);
    assert.equal((await call('/profile','GET',undefined,a.cookie)).value.profile.homeCity,'Chicago, IL');
    assert.equal((await call('/state','GET',undefined,b.cookie)).value.events[0].id,confirmed.value.eventId);
    await call('/auth/logout','POST',{},a.cookie);
    assert.equal((await call('/auth/me','GET',undefined,a.cookie)).value.user,null);
    const login=await call('/auth/login','POST',{identifier:'ALICE@example.com',password});assert.equal(login.value.user.id,a.value.user.id);
  }finally{await client.close();await rm(directory,{recursive:true,force:true})}
});

test('full duration, adjacent blocks, gaps, endpoint boundaries, preferences and time offsets',()=>{
  const a=Date.parse(start),b=a+3600000;
  assert.equal(availabilityAt(a,b,[{userId:'a',start,end:'2030-10-01T15:30:00Z',status:'available'}],[]),'unknown');
  assert.equal(availabilityAt(a,b,[{userId:'a',start,end:'2030-10-01T15:30:00Z',status:'preferred'},{userId:'a',start:'2030-10-01T15:30:00Z',end,status:'available'}],[]),'available');
  assert.equal(availabilityAt(a,b,[{userId:'a',start,end,status:'preferred'}],[{userId:'a',start:'2030-10-01T16:00:00Z',end}]),'preferred');
  const slots=rankSlots({windows:[{start:'2030-10-01T10:00:00-05:00',end}],durationMinutes:60,minParticipants:1},[{userId:'a',required:true}],[{userId:'a',start,end,status:'available'}],[]);
  assert.equal(slots.length,5);assert.equal(slots[0].start,'2030-10-01T15:00:00.000Z');assert.equal(slots[0].qualified,true);
});

test('Ticketmaster locations are encoded and provider events are reduced to safe UI fields',()=>{
  assert.equal(geohash(41.8781,-87.6298),'dp3wjzt');
  assert.deepEqual(cityFilter('Chicago, IL'),{city:'Chicago',stateCode:'IL'});
  assert.deepEqual(cityFilter('London'),{city:'London',stateCode:undefined});
  assert.equal(ticketmasterDate('2030-10-01T15:30:12.427Z'),'2030-10-01T15:30:12Z');
  const event=normalizeTicketmasterEvent({id:'abc',name:'Live show',url:'https://tickets.example/show',distance:4.2,units:'MILES',images:[{url:'http://unsafe.example/image',width:2000},{url:'https://images.example/wide',ratio:'16_9',width:1024}],dates:{timezone:'America/Chicago',status:{code:'onsale'},start:{dateTime:'2030-10-01T23:00:00Z',localDate:'2030-10-01',localTime:'18:00:00'}},classifications:[{primary:true,segment:{name:'Music'},genre:{name:'Rock'}}],priceRanges:[{currency:'USD',min:20,max:80}],_embedded:{venues:[{name:'The Venue',city:{name:'Chicago'},state:{stateCode:'IL'},country:{countryCode:'US'},address:{line1:'1 Main St'},location:{latitude:'41.88',longitude:'-87.63'}}]}});
  assert.deepEqual(event,{id:'abc',name:'Live show',url:'https://tickets.example/show',imageUrl:'https://images.example/wide',start:{dateTime:'2030-10-01T23:00:00Z',localDate:'2030-10-01',localTime:'18:00:00',dateTBD:false,dateTBA:false,timeTBA:false,timeZone:'America/Chicago'},status:'onsale',distance:4.2,distanceUnit:'MILES',category:'Music',genre:'Rock',subGenre:null,venue:{name:'The Venue',address:'1 Main St',city:'Chicago',state:'IL',country:'US',latitude:41.88,longitude:-87.63},price:{currency:'USD',min:20,max:80}});
});

test('Google sign-in creates, reuses, and refuses to capture accounts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ontime-google-'));
  const client=new PGlite(directory);await client.waitReady;
  const db=drizzle(client,{schema});
  await migrateDatabase({db,client,mode:'local',close:()=>client.close()} as DatabaseConnection);
  const google={clientId:'test-client.apps.googleusercontent.com',clientSecret:'test-secret',redirectUri:'http://localhost:5173/api/auth/google/callback'};
  const context=():Context=>({db,mode:'local',origins:['http://localhost:5173'],appOrigin:'http://localhost:5173',google,secureCookies:false,clientAddress:'test'});
  const realFetch=globalThis.fetch;
  // Stands in for Google's token endpoint. The handler reads the ID token it returns
  // without checking the signature, exactly as it does against the real endpoint.
  let claims:Record<string,unknown>={};
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    assert.equal(String(input),'https://oauth2.googleapis.com/token');
    const payload=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:google.clientId,exp:Math.floor(Date.now()/1000)+300,...claims})).toString('base64url');
    return Response.json({id_token:`eyJhbGciOiJSUzI1NiJ9.${payload}.signature`});
  }) as typeof globalThis.fetch;
  const get=(path:string,cookie='')=>handleRequest(new Request('http://localhost:5173'+path,{headers:cookie?{cookie}:{}}),context());
  async function handshake(){
    const started=await get('/api/auth/google/start?next=%2F');
    assert.equal(started.status,302);
    const target=new URL(started.headers.get('location')!);
    assert.equal(target.origin+target.pathname,'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(target.searchParams.get('code_challenge_method'),'S256');
    const binding=started.headers.get('set-cookie')!.split(';')[0];
    return {state:target.searchParams.get('state')!,binding};
  }
  const finish=async(cookie='')=>{
    const {state,binding}=await handshake();
    return get(`/api/auth/google/callback?code=demo&state=${state}`,[binding,cookie].filter(Boolean).join('; '));
  };
  const session=(response:Response)=>response.headers.getSetCookie().find(c=>c.startsWith('ontime_session='))?.split(';')[0]??'';
  try{
    claims={sub:'google-ollie',email:'Ollie@example.com',email_verified:true,name:'Ollie Otter'};
    const first=await finish();
    assert.equal(first.status,302);
    // A brand new account lands on the profile steps; the account already exists.
    assert.equal(first.headers.get('location'),'http://localhost:5173/login.html?google=new&next=%2F');
    const cookie=session(first);assert.ok(cookie);
    const me=await (await get('/api/auth/me',cookie)).json() as {user:{username:string;email:string}};
    assert.equal(me.user.email,'ollie@example.com');assert.equal(me.user.username,'ollie');

    // Returning with the same Google account reuses it and goes straight to the app.
    const again=await finish();
    assert.equal(again.headers.get('location'),'http://localhost:5173/');
    const returning=await (await get('/api/auth/me',session(again))).json() as {user:{id:string}};
    const originally=await (await get('/api/auth/me',cookie)).json() as {user:{id:string}};
    assert.equal(returning.user.id,originally.user.id);
    assert.equal((await db.select().from(schema.accounts)).length,1);

    // A second Google identity whose email local part is taken still gets a username.
    claims={sub:'google-other',email:'ollie@other.example',email_verified:true,name:'Ollie Two'};
    const second=await finish();
    assert.equal(second.headers.get('location'),'http://localhost:5173/login.html?google=new&next=%2F');
    const other=await (await get('/api/auth/me',session(second))).json() as {user:{username:string}};
    assert.notEqual(other.user.username,'ollie');assert.match(other.user.username,/^ollie[0-9a-f]{4}$/);

    // An unverified Google email is refused rather than trusted.
    claims={sub:'google-unverified',email:'nobody@example.com',email_verified:false,name:'Nobody'};
    assert.equal((await finish()).headers.get('location'),'http://localhost:5173/login.html?error=google_email');

    // Password accounts are never adopted: registration does not verify email, so
    // whoever registered the address first must not capture the Google sign-in.
    const password='A long demo password 2026!';
    const registered=await handleRequest(new Request('http://localhost:5173/api/auth/register',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:5173'},body:JSON.stringify({email:'maya@example.com',username:'maya',password,name:'Maya'})}),context());
    assert.equal(registered.status,201);
    claims={sub:'google-maya',email:'maya@example.com',email_verified:true,name:'Maya'};
    const blocked=await finish();
    assert.equal(blocked.headers.get('location'),'http://localhost:5173/login.html?error=google_exists');
    assert.equal(session(blocked),'');

    // The response object is not what the browser sees. server/main.ts hands these
    // headers to Node, and collapsing the pair there dropped the session cookie and
    // left the handshake cleanup, so a finished Google sign-in arrived signed out.
    claims={sub:'google-wire',email:'wire@example.com',email_verified:true,name:'Wire'};
    const wire=await finish();
    const served=nodeHeaders(wire)['set-cookie'];
    assert.ok(Array.isArray(served)&&served.length===2,'both cookies must reach the browser');
    const servedSession=served.find(c=>c.startsWith('ontime_session='))!;
    assert.ok(servedSession,'the session cookie must survive serialization');
    assert.ok(served.some(c=>c.startsWith('ontime_oauth=')),'the handshake cookie is still cleared');
    const signedIn=await (await get('/api/auth/me',servedSession.split(';')[0])).json() as {user:{email:string}|null};
    assert.equal(signedIn.user?.email,'wire@example.com');

    // The handshake is single use and requires the browser's binding cookie.
    const {state,binding}=await handshake();
    assert.equal((await get(`/api/auth/google/callback?code=demo&state=${state}`)).headers.get('location'),'http://localhost:5173/login.html?error=google_expired');
    assert.equal((await get(`/api/auth/google/callback?code=demo&state=${state}`,binding)).headers.get('location'),'http://localhost:5173/login.html?error=google_expired');

    // Google-only accounts have no password to guess.
    const attempt=await handleRequest(new Request('http://localhost:5173/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:5173'},body:JSON.stringify({identifier:'ollie',password:'anything at all!!'})}),context());
    assert.equal(attempt.status,401);
  }finally{globalThis.fetch=realFetch;await client.close();await rm(directory,{recursive:true,force:true})}
});

test('friend groups, per-friend sharing, and what a busy viewer never receives',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ontime-friends-'));
  const client=new PGlite(directory);await client.waitReady;
  const db=drizzle(client,{schema});
  await migrateDatabase({db,client,mode:'local',close:()=>client.close()} as DatabaseConnection);
  const context=():Context=>({db,mode:'local',origins:['http://localhost:5173'],appOrigin:'http://localhost:5173',google:null,secureCookies:false,clientAddress:'test'});
  async function call(path:string,method='GET',data?:unknown,cookie='',expected=200){
    const response=await handleRequest(new Request('http://localhost:5173/api'+path,{method,headers:{'content-type':'application/json',origin:'http://localhost:5173',cookie},...(data===undefined?{}:{body:JSON.stringify(data)})}),context());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value:any=await response.json();assert.equal(response.status,expected,JSON.stringify(value));
    return {value,cookie:response.headers.get('set-cookie')?.split(';')[0]??cookie};
  }
  async function register(username:string){
    const {value,cookie}=await call('/auth/register','POST',{email:`${username}@example.com`,username,password,name:username},'',201);
    return {id:value.user.id as string,cookie};
  }
  const window=`?start=${encodeURIComponent('2030-09-30T00:00:00Z')}&end=${encodeURIComponent('2030-10-03T00:00:00Z')}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feed=async(cookie:string)=>(await call('/friends/calendar'+window,'GET',undefined,cookie)).value.friends as any[];
  try{
    const alice=await register('alice'),bob=await register('bob'),carol=await register('carol');
    // Two touching events, so a busy viewer also cannot read the seam between them.
    await call('/action','POST',{action:'save',event:{calendar:'personal-'+alice.id,title:'Dentist',start,end,location:'Fern Street Dental',invitees:'',notes:'Bring the referral',allDay:false}},alice.cookie);
    await call('/action','POST',{action:'save',event:{calendar:'personal-'+alice.id,title:'Gym',start:end,end:'2030-10-01T18:00:00Z',location:'',invitees:'',notes:'',allDay:false}},alice.cookie);

    // A pending request shares nothing yet.
    const request=await call('/friends/requests','POST',{userId:bob.id},alice.cookie,201);
    assert.deepEqual(await feed(bob.cookie),[]);
    await call(`/friends/${request.value.id}`,'PATCH',{action:'accept'},bob.cookie);

    // The account default is 'busy': one merged block, and not a single detail.
    const [busy]=await feed(bob.cookie);
    assert.equal(busy.sharing,'busy');
    assert.equal(busy.events.length,1,'touching events merge into one block');
    assert.deepEqual(Object.keys(busy.events[0]).sort(),['end','start']);
    assert.equal(busy.events[0].start,start);
    assert.equal(busy.events[0].end,'2030-10-01T18:00:00Z');
    assert.doesNotMatch(JSON.stringify(busy),/Dentist|Gym|Fern Street|referral/,'a busy viewer receives no titles, places, or notes');

    // A per-friend override opens the details up.
    await call(`/friends/sharing/${bob.id}`,'PUT',{sharing:'details'},alice.cookie);
    const [detailed]=await feed(bob.cookie);
    assert.equal(detailed.sharing,'details');
    assert.equal(detailed.events.length,2);
    assert.deepEqual(detailed.events.map((e:{title:string})=>e.title).sort(),['Dentist','Gym']);
    assert.equal(detailed.events.find((e:{title:string})=>e.title==='Dentist').location,'Fern Street Dental');
    // Details still stop short of the private fields the owner never offered.
    assert.doesNotMatch(JSON.stringify(detailed),/referral/,'notes stay with the owner');

    // A group carries the level, so filing a friend into it is enough.
    await call(`/friends/sharing/${bob.id}`,'PUT',{sharing:'default'},alice.cookie);
    assert.equal((await feed(bob.cookie))[0].sharing,'busy');
    const close=await call('/friends/groups','POST',{name:'Close friends',color:0,sharing:'details'},alice.cookie,201);
    const work=await call('/friends/groups','POST',{name:'Work',color:2,sharing:'busy'},alice.cookie,201);
    await call(`/friends/groups/${close.value.id}/members`,'PUT',{userIds:[bob.id]},alice.cookie);
    assert.equal((await feed(bob.cookie))[0].sharing,'details');

    // In two groups, the most permissive one decides.
    await call(`/friends/groups/${work.value.id}/members`,'PUT',{userIds:[bob.id]},alice.cookie);
    assert.equal((await feed(bob.cookie))[0].sharing,'details');

    // A per-person 'none' overrides even a group that grants details.
    await call(`/friends/sharing/${bob.id}`,'PUT',{sharing:'none'},alice.cookie);
    assert.deepEqual(await feed(bob.cookie),[],'an override of none hides the calendar outright');
    await call(`/friends/sharing/${bob.id}`,'PUT',{sharing:'default'},alice.cookie);

    // Changing the account default moves everyone who has no group and no override.
    await call('/action','POST',{action:'profile',profile:{defaultSharing:'none'}},alice.cookie);
    assert.equal((await feed(bob.cookie))[0].sharing,'details','a group still outranks the default');
    await call(`/friends/groups/${close.value.id}`,'DELETE',undefined,alice.cookie);
    await call(`/friends/groups/${work.value.id}`,'DELETE',undefined,alice.cookie);
    assert.deepEqual(await feed(bob.cookie),[],'with no group left the default hides it');
    await call('/action','POST',{action:'profile',profile:{defaultSharing:'busy'}},alice.cookie);

    // Carol is nobody's friend and sees nothing, whatever she asks for.
    assert.deepEqual(await feed(carol.cookie),[]);
    // Groups are for accepted friends only, so one cannot be used to reach a stranger.
    const strangers=await call('/friends/groups','POST',{name:'Strangers',sharing:'details'},alice.cookie,201);
    await call(`/friends/groups/${strangers.value.id}/members`,'PUT',{userIds:[carol.id]},alice.cookie,400);
    // Nor can a group be edited by someone who does not own it.
    await call(`/friends/groups/${strangers.value.id}`,'PATCH',{sharing:'details'},bob.cookie,404);
    await call(`/friends/groups/${strangers.value.id}/members`,'PUT',{userIds:[]},bob.cookie,404);
    await call(`/friends/sharing/${alice.id}`,'PUT',{sharing:'details'},carol.cookie,404);

    // Both directions are reported independently to the owner of the list.
    await call(`/friends/sharing/${bob.id}`,'PUT',{sharing:'details'},alice.cookie);
    const [listed]=(await call('/friends','GET',undefined,alice.cookie)).value.friends;
    assert.equal(listed.sharing,'details','what Alice shares with Bob');
    assert.equal(listed.theirSharing,'busy','what Bob shares with Alice');

    // Blocking cuts the calendar off in both directions at once.
    await call(`/friends/${request.value.id}`,'PATCH',{action:'block'},bob.cookie);
    assert.deepEqual(await feed(bob.cookie),[]);
    assert.deepEqual(await feed(alice.cookie),[]);
  }finally{await client.close();await rm(directory,{recursive:true,force:true})}
});

test('poll grid maths produce availability the server will accept',async()=>{
  // Local times, because the poll screen paints in the viewer's own day.
  const day=(date:string,h:number,m=0)=>new Date(new Date(date+'T00:00:00').setHours(h,m,0,0)).toISOString();
  const windows=dailyWindows('2030-10-01','2030-10-03',9*60,17*60);
  assert.equal(windows.length,3);
  assert.equal(windows[0].start,day('2030-10-01',9));
  assert.equal(windows[0].end,day('2030-10-01',17));
  // One window per day never overlaps the next, which is what the server checks.
  assert.ok(windows.every((w,i)=>i===0||Date.parse(w.start)>=Date.parse(windows[i-1].end)));
  assert.deepEqual(dailyWindows('2030-10-03','2030-10-01',9*60,17*60),[],'a backwards range yields nothing');
  assert.deepEqual(dailyWindows('2030-10-01','2030-10-02',17*60,9*60),[],'an end before the start yields nothing');
  assert.equal(dailyWindows('2030-10-01','2030-12-31',9*60,17*60).length,31,'capped at the server maximum');

  const grid=buildGrid(windows);
  assert.deepEqual(grid.days,['2030-10-01','2030-10-02','2030-10-03']);
  assert.equal(grid.times.length,16,'eight hours of half-hour cells');
  assert.equal(grid.times[0],9*60);
  assert.equal(grid.index.get('2030-10-01#'+9*60),Date.parse(day('2030-10-01',9)),'the grid indexes cells by timestamp');

  // An irregular poll leaves a real gap rather than inventing a cell.
  const ragged=buildGrid([{start:day('2030-10-01',9),end:day('2030-10-01',17)},{start:day('2030-10-02',9),end:day('2030-10-02',11)}]);
  assert.equal(ragged.index.get('2030-10-02#'+10*60),Date.parse(day('2030-10-02',10)));
  assert.equal(ragged.index.get('2030-10-02#'+15*60),undefined,'the short day has no afternoon cell');

  // Painting four touching cells must come back as one block, not four.
  const paint=new Map<number,string>();
  for(const h of [10,10.5,11,11.5])paint.set(Date.parse(day('2030-10-01',Math.floor(h),h%1?30:0)),'available');
  paint.set(Date.parse(day('2030-10-01',14)),'preferred');
  paint.set(Date.parse(day('2030-10-02',10)),'available');
  const blocks=toBlocks(paint,windows);
  assert.equal(blocks.length,3);
  assert.deepEqual(blocks[0],{start:day('2030-10-01',10),end:day('2030-10-01',12),status:'available'});
  assert.deepEqual(blocks[1],{start:day('2030-10-01',14),end:day('2030-10-01',14,30),status:'preferred'},'a lone cell is half an hour');
  // Every rule PUT /polls/:id/availability enforces, checked before it is ever sent.
  assert.ok(blocks.every((b,i)=>Date.parse(b.end)>Date.parse(b.start)&&(i===0||Date.parse(b.start)>=Date.parse(blocks[i-1].end))),'sorted and non-overlapping');
  assert.ok(blocks.every(b=>windows.some(w=>Date.parse(b.start)>=Date.parse(w.start)&&Date.parse(b.end)<=Date.parse(w.end))),'every block sits inside a window');
  assert.ok(blocks.length<=500);
  // A neighbour of a different status stays its own block rather than merging.
  assert.equal(toBlocks(new Map([[Date.parse(day('2030-10-01',10)),'available'],[Date.parse(day('2030-10-01',10,30)),'maybe']]),windows).length,2);
  // A cell outside every window is dropped rather than sent for the server to refuse.
  assert.deepEqual(toBlocks(new Map([[Date.parse(day('2030-10-01',3)),'available']]),windows),[]);

  // Reloading a saved poll repaints exactly the cells that were painted.
  const round=fromBlocks(blocks);
  assert.equal(round.size,paint.size);
  for(const [stamp,status] of paint)assert.equal(round.get(stamp),status);
  assert.deepEqual(toBlocks(round,windows),blocks,'and survives another trip');

  // A full week painted end to end still fits well inside the 500-block ceiling.
  // These windows abut exactly at midnight, so this is the case where a naive merge would
  // span two days and produce a block the server refuses as belonging to no single window.
  const week=dailyWindows('2030-10-07','2030-10-13',0,24*60);
  const full=new Map<number,string>();
  for(const w of week)for(let t=Date.parse(w.start);t<Date.parse(w.end);t+=30*60000)full.set(t,'available');
  const packed=toBlocks(full,week);
  assert.equal(packed.length,7,'one block per day, never merged across a window edge');
  assert.ok(packed.every(b=>week.some(w=>Date.parse(b.start)>=Date.parse(w.start)&&Date.parse(b.end)<=Date.parse(w.end))),'each still inside one window');
});
