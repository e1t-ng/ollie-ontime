import {randomUUID} from 'node:crypto';
import {and,eq,inArray,asc} from 'drizzle-orm';
import {z} from 'zod';
import {accounts,profiles,calendars,events,eventMembers,responses,polls,pollMembers,availabilityBlocks} from '../db/schema';
import type {Database} from './database';
import type {User} from './auth';
import {body,ensure,json,id,instant,timeZone} from './http';
import {relationship,publicFields} from './social';
import {busyEvents} from './calendar';
import {rankSlots} from './scheduling';

const range=z.object({start:instant,end:instant}).refine(w=>Date.parse(w.end)>Date.parse(w.start),'End must follow start.');
const createPoll=z.object({title:z.string().trim().min(1).max(160),description:z.string().max(2000).default(''),location:z.string().max(300).default(''),timeZone,durationMinutes:z.number().int().min(15).max(240).multipleOf(15),minParticipants:z.number().int().min(1).max(20),windows:z.array(range).min(1).max(31),invitees:z.array(z.object({userId:id,required:z.boolean().default(false)})).max(19).default([])});
async function loadPoll(db:Database,pollId:string,userId:string,lock=false){
  const query=db.select().from(polls).where(eq(polls.id,pollId));
  const [poll]=await (lock?query.for('update'):query);
  const [member]=await db.select().from(pollMembers).where(and(eq(pollMembers.pollId,pollId),eq(pollMembers.userId,userId)));
  ensure(poll&&member,404,'Poll not found.');return poll;
}
async function schedule(db:Database,poll:typeof polls.$inferSelect){
  const members=await db.select().from(pollMembers).where(eq(pollMembers.pollId,poll.id));
  const blocks=await db.select().from(availabilityBlocks).where(eq(availabilityBlocks.pollId,poll.id));
  const busy=await busyEvents(db,members.map(m=>m.userId));
  return {members,blocks,slots:rankSlots(poll,members,blocks.map(b=>({userId:b.userId,start:b.startsAt.toISOString(),end:b.endsAt.toISOString(),status:b.status})),busy)};
}
export async function pollRoute(req:Request,db:Database,user:User,path:string):Promise<Response|undefined>{
  if(path==='/api/polls'&&req.method==='GET'){
    const rows=await db.select({poll:polls,required:pollMembers.required,submittedAt:pollMembers.submittedAt}).from(pollMembers).innerJoin(polls,eq(polls.id,pollMembers.pollId)).where(eq(pollMembers.userId,user.id));
    return json({polls:rows});
  }
  if(path==='/api/polls'&&req.method==='POST'){
    const b=await body(req,createPoll),windows=[...b.windows].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    ensure(new Set(b.invitees.map(i=>i.userId)).size===b.invitees.length&&!b.invitees.some(i=>i.userId===user.id),400,'Invitees must be distinct other users.');
    ensure(b.minParticipants<=b.invitees.length+1,400,'Minimum attendance exceeds the member count.');
    ensure(Date.parse(windows[windows.length-1].end)-Date.parse(windows[0].start)<=31*86400000,400,'Choose windows within 31 days.');
    ensure(windows.every((w,i)=>Date.parse(w.end)-Date.parse(w.start)>=b.durationMinutes*60000&&(i===0||Date.parse(w.start)>=Date.parse(windows[i-1].end))),400,'Windows must not overlap and must fit the meeting duration.');
    for(const invitee of b.invitees)ensure((await relationship(db,user.id,invitee.userId))?.status==='accepted',403,'Invite accepted friends only.');
    const pollId=randomUUID();
    await db.transaction(async tx=>{
      const {invitees,...values}=b;await tx.insert(polls).values({...values,windows,id:pollId,ownerId:user.id});
      await tx.insert(pollMembers).values([{pollId,userId:user.id,required:true},...invitees.map(i=>({pollId,...i}))]);
    });return json({id:pollId},201);
  }
  const match=path.match(/^\/api\/polls\/([^/]+)(?:\/(availability|slots|confirm|cancel))?$/);
  if(!match)return;
  const pollId=id.parse(match[1]),action=match[2];
  if(req.method==='GET'){
    const poll=await loadPoll(db,pollId,user.id);
    if(action==='slots'){
      const result=await schedule(db,poll);return json({slots:result.slots,computedAt:new Date().toISOString()});
    }
    if(action)return;
    const members=await db.select({...publicFields,required:pollMembers.required,submittedAt:pollMembers.submittedAt}).from(pollMembers).innerJoin(accounts,eq(accounts.id,pollMembers.userId)).innerJoin(profiles,eq(profiles.owner,accounts.id)).where(eq(pollMembers.pollId,pollId));
    const availability=await db.select({start:availabilityBlocks.startsAt,end:availabilityBlocks.endsAt,status:availabilityBlocks.status}).from(availabilityBlocks).where(and(eq(availabilityBlocks.pollId,pollId),eq(availabilityBlocks.userId,user.id)));
    return json({poll,members,availability});
  }
  if(action==='availability'&&req.method==='PUT'){
    const {blocks}=await body(req,z.object({blocks:z.array(z.object({start:instant,end:instant,status:z.enum(['preferred','available','maybe','unavailable'])})).max(500)}));
    blocks.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    await db.transaction(async tx=>{
      const poll=await loadPoll(tx,pollId,user.id,true);ensure(poll.status==='open',409,'This poll is closed.');
      ensure(blocks.every((b,i)=>Date.parse(b.end)>Date.parse(b.start)&&(i===0||Date.parse(b.start)>=Date.parse(blocks[i-1].end))&&poll.windows.some(w=>Date.parse(b.start)>=Date.parse(w.start)&&Date.parse(b.end)<=Date.parse(w.end))),400,'Availability must not overlap and must stay inside a poll window.');
      await tx.delete(availabilityBlocks).where(and(eq(availabilityBlocks.pollId,pollId),eq(availabilityBlocks.userId,user.id)));
      if(blocks.length)await tx.insert(availabilityBlocks).values(blocks.map(b=>({id:randomUUID(),pollId,userId:user.id,startsAt:new Date(b.start),endsAt:new Date(b.end),status:b.status})));
      await tx.update(pollMembers).set({submittedAt:new Date()}).where(and(eq(pollMembers.pollId,pollId),eq(pollMembers.userId,user.id)));
    });return json({ok:true});
  }
  if(action==='cancel'&&req.method==='POST'){
    await db.transaction(async tx=>{const poll=await loadPoll(tx,pollId,user.id,true);ensure(poll.ownerId===user.id,403,'Only the organizer can cancel.');ensure(poll.status==='open',409,'Only an open poll can be cancelled.');await tx.update(polls).set({status:'cancelled'}).where(eq(polls.id,pollId));});return json({ok:true});
  }
  if(action==='confirm'&&req.method==='POST'){
    const {start}=await body(req,z.object({start:instant}));
    const eventId=await db.transaction(async tx=>{
      const poll=await loadPoll(tx,pollId,user.id,true);ensure(poll.ownerId===user.id,403,'Only the organizer can confirm.');
      if(poll.status==='confirmed'){
        const [event]=await tx.select().from(events).where(eq(events.id,poll.eventId!));
        ensure(event&&Date.parse(JSON.parse(event.data).start)===Date.parse(start),409,'This poll was already confirmed at another time.');return event.id;
      }
      ensure(poll.status==='open',409,'This poll is closed.');
      const members=await tx.select().from(pollMembers).where(eq(pollMembers.pollId,pollId));
      await tx.select({id:accounts.id}).from(accounts).where(inArray(accounts.id,members.map(m=>m.userId))).orderBy(asc(accounts.id)).for('update');
      const result=await schedule(tx,poll),slot=result.slots.find(s=>Date.parse(s.start)===Date.parse(start));
      ensure(slot?.qualified,409,'This time no longer satisfies availability and attendance requirements.');
      const eventId=randomUUID(),calendar='personal-'+user.id;
      await tx.insert(calendars).values({id:calendar,owner:user.id,name:'Personal',color:'0'}).onConflictDoNothing();
      await tx.insert(events).values({id:eventId,owner:user.id,calendar,token:randomUUID(),data:JSON.stringify({id:eventId,calendar,title:poll.title,start:slot.start,end:slot.end,location:poll.location,notes:poll.description,invitees:'',allDay:false,pollId})});
      await tx.insert(eventMembers).values(members.map(m=>({eventId,userId:m.userId,status:m.userId===user.id?'Going':'Invited'})));
      const [profile]=await tx.select().from(profiles).where(eq(profiles.owner,user.id));
      await tx.insert(responses).values({event:eventId,user:user.id,name:profile.name,status:'Going'});
      await tx.update(polls).set({status:'confirmed',eventId}).where(eq(polls.id,pollId));return eventId;
    });return json({eventId});
  }
}
