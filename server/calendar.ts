import {randomUUID} from 'node:crypto';
import {and,eq,inArray,asc} from 'drizzle-orm';
import {z} from 'zod';
import {accounts,calendars,events,eventMembers,profiles,responses,polls} from '../db/schema';
import type {Database} from './database';
import type {User} from './auth';
import {body,ensure,json} from './http';
import {profilePatch,updateProfile} from './social';

const eventSchema=z.object({id:z.string().max(150).optional(),calendar:z.string().min(1).max(150),title:z.string().trim().min(1).max(160),start:z.string().max(50),end:z.string().max(50),location:z.string().max(300).default(''),invitees:z.string().max(1000).default(''),notes:z.string().max(2000).default(''),allDay:z.boolean().default(false)}).refine(e=>Number.isFinite(Date.parse(e.start))&&Number.isFinite(Date.parse(e.end))&&Date.parse(e.end)>Date.parse(e.start),'End time must be after start time.');
export async function busyEvents(db:Database,userIds:string[]){
  const owned=await db.select().from(events).where(inArray(events.owner,userIds));
  const shared=await db.select({userId:eventMembers.userId,data:events.data}).from(eventMembers).innerJoin(events,eq(events.id,eventMembers.eventId)).where(and(inArray(eventMembers.userId,userIds),inArray(eventMembers.status,['Invited','Going','Maybe'])));
  return [...owned.map(e=>({userId:e.owner,data:e.data})),...shared].flatMap(e=>{const data=JSON.parse(e.data);return typeof data.start==='string'&&typeof data.end==='string'?[{userId:e.userId,start:data.start,end:data.end}]:[]});
}
export async function calendarRoute(req:Request,db:Database,user:User,path:string):Promise<Response|undefined>{
  if(path==='/api/state'&&req.method==='GET'){
    const ownCalendars=await db.select().from(calendars).where(eq(calendars.owner,user.id)).orderBy(asc(calendars.seq));
    const ownEvents=await db.select().from(events).where(eq(events.owner,user.id)).orderBy(asc(events.seq));
    const shared=await db.select({event:events,status:eventMembers.status}).from(eventMembers).innerJoin(events,eq(events.id,eventMembers.eventId)).where(eq(eventMembers.userId,user.id));
    const [profile]=await db.select().from(profiles).where(eq(profiles.owner,user.id));
    const sharedId='shared-'+user.id;
    return json({user:{...user,name:profile.name},profile,calendars:[...ownCalendars,...(shared.some(e=>e.event.owner!==user.id)?[{id:sharedId,name:'Shared plans',color:'2',readOnly:true}]:[])],events:[...ownEvents.map(e=>({...JSON.parse(e.data),id:e.id,token:e.token,canEdit:true})),...shared.filter(e=>e.event.owner!==user.id).map(({event:e,status})=>({...JSON.parse(e.data),id:e.id,calendar:sharedId,canEdit:false,attendance:status}))]});
  }
  if(path==='/api/action'&&req.method==='POST'){
    const b=await body(req,z.object({action:z.string()}).passthrough());
    if(b.action==='profile'){await updateProfile(db,user,profilePatch.parse(b.profile));return json({ok:true})}
    if(b.action==='calendar'){
      const name=z.string().trim().min(1).max(60).parse(b.name),color=z.coerce.number().int().min(0).max(2).default(1).parse(b.color);
      const id=randomUUID();await db.insert(calendars).values({id,owner:user.id,name,color:String(color)});return json({id},201);
    }
    if(b.action==='delete'){
      const id=z.string().min(1).max(150).parse(b.id);
      await db.transaction(async tx=>{
        await tx.select({id:accounts.id}).from(accounts).where(eq(accounts.id,user.id)).for('update');
        const [owned]=await tx.select().from(events).where(and(eq(events.id,id),eq(events.owner,user.id)));
        ensure(owned,404,'Event not found.');
        await tx.delete(responses).where(eq(responses.event,id));
        await tx.update(polls).set({status:'cancelled',eventId:null}).where(eq(polls.eventId,id));
        await tx.delete(events).where(eq(events.id,id));
      });return json({ok:true});
    }
    if(b.action==='save'||b.action==='import'){
      const list=z.array(eventSchema).min(1).max(500).parse(b.action==='save'?[b.event]:b.events);
      const ids:string[]=[];
      await db.transaction(async tx=>{
        // Same account lock as poll confirmation: busy data cannot change mid-confirm.
        await tx.select({id:accounts.id}).from(accounts).where(eq(accounts.id,user.id)).for('update');
        const owned=await tx.select({id:calendars.id}).from(calendars).where(eq(calendars.owner,user.id));
        ensure(list.every(e=>owned.some(c=>c.id===e.calendar)),403,'Calendar not found.');
        for(const e of list){
          const eventId=b.action==='save'&&e.id?e.id:randomUUID();ids.push(eventId);
          const data=JSON.stringify({...e,id:eventId});
          if(b.action==='save'&&e.id){
            const [ownedEvent]=await tx.select().from(events).where(and(eq(events.id,eventId),eq(events.owner,user.id)));
            ensure(ownedEvent,404,'Event not found.');
            const [confirmed]=await tx.select({id:polls.id}).from(polls).where(eq(polls.eventId,eventId));
            if(confirmed){const old=JSON.parse(ownedEvent.data);ensure(old.start===e.start&&old.end===e.end,409,'Create a new poll to reschedule a confirmed plan.');}
            await tx.update(events).set({calendar:e.calendar,data}).where(eq(events.id,eventId));
          }else await tx.insert(events).values({id:eventId,owner:user.id,calendar:e.calendar,data,token:randomUUID()});
        }
      });return json({ok:true,count:list.length,ids});
    }
    return json({error:'Unknown action.'},400);
  }
  const rsvpMatch=path.match(/^\/api\/events\/([^/]+)\/rsvp$/);
  if(path==='/api/rsvp'||rsvpMatch){
    if(!['GET','POST'].includes(req.method))return;
    const input=req.method==='POST'?await body(req,z.object({token:z.string().uuid().optional(),status:z.enum(['Going','Maybe','Not going'])})):null;
    const token=input?.token??new URL(req.url).searchParams.get('token');
    const [event]=await db.select().from(events).where(rsvpMatch?eq(events.id,rsvpMatch[1]):eq(events.token,token??''));
    ensure(event,404,'Invitation not found.');
    const [membership]=await db.select().from(eventMembers).where(and(eq(eventMembers.eventId,event.id),eq(eventMembers.userId,user.id)));
    ensure(!rsvpMatch||membership||event.owner===user.id,404,'Invitation not found.');
    if(input){
      const [profile]=await db.select().from(profiles).where(eq(profiles.owner,user.id));
      await db.transaction(async tx=>{
        await tx.select({id:accounts.id}).from(accounts).where(eq(accounts.id,user.id)).for('update');
        await tx.insert(eventMembers).values({eventId:event.id,userId:user.id,status:input.status}).onConflictDoUpdate({target:[eventMembers.eventId,eventMembers.userId],set:{status:input.status}});
        await tx.insert(responses).values({event:event.id,user:user.id,name:profile.name,status:input.status}).onConflictDoUpdate({target:[responses.event,responses.user],set:{name:profile.name,status:input.status}});
      });return json({ok:true});
    }
    const all=event.owner===user.id?await db.select({name:responses.name,status:responses.status}).from(responses).where(eq(responses.event,event.id)):[];
    const data=JSON.parse(event.data);
    return json({event:{id:event.id,title:data.title,start:data.start,end:data.end,location:data.location,notes:data.notes,allDay:data.allDay},responses:all,mine:membership?.status??null});
  }
}
