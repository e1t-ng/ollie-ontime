import {randomUUID} from 'node:crypto';
import {and,eq,or,inArray} from 'drizzle-orm';
import {z} from 'zod';
import {accounts,profiles,events,eventMembers,friendships,friendGroups,friendGroupMembers,calendarShares,SHARING,type Sharing} from '../db/schema';
import type {Database} from './database';
import type {User} from './auth';
import {body,ensure,json,id} from './http';

const RANK:Record<Sharing,number>={none:0,busy:1,details:2};
const sharing=z.enum(SHARING);
const groupInput=z.object({name:z.string().trim().min(1).max(60),color:z.coerce.number().int().min(0).max(2).default(1).transform(String),sharing:sharing.default('busy')});
const WINDOW_DAYS=62;

// Accepted friendships only. A pending request or a block shares nothing in either
// direction, whatever the group and per-person settings say.
export async function acceptedFriends(db:Database,userId:string){
  const rows=await db.select().from(friendships).where(and(or(eq(friendships.userLow,userId),eq(friendships.userHigh,userId)),eq(friendships.status,'accepted')));
  return rows.map(row=>row.userLow===userId?row.userHigh:row.userLow);
}

// What each owner lets this viewer see. Precedence is deliberate: a per-person override
// wins outright, so one member of a trusted group can still be shut out; otherwise the
// most permissive group the viewer belongs to applies; otherwise the owner's default.
export async function resolveSharing(db:Database,viewerId:string,ownerIds:string[]):Promise<Map<string,Sharing>>{
  const resolved=new Map<string,Sharing>();
  if(!ownerIds.length)return resolved;
  const friends=new Set(await acceptedFriends(db,viewerId));
  const visible=ownerIds.filter(owner=>friends.has(owner));
  for(const owner of ownerIds)resolved.set(owner,'none');
  if(!visible.length)return resolved;

  const overrides=new Map((await db.select().from(calendarShares).where(and(inArray(calendarShares.ownerId,visible),eq(calendarShares.viewerId,viewerId))))
    .map(row=>[row.ownerId,row.sharing as Sharing]));
  const groups=await db.select({owner:friendGroups.owner,sharing:friendGroups.sharing}).from(friendGroupMembers)
    .innerJoin(friendGroups,eq(friendGroups.id,friendGroupMembers.groupId))
    .where(and(inArray(friendGroups.owner,visible),eq(friendGroupMembers.memberId,viewerId)));
  const best=new Map<string,Sharing>();
  for(const row of groups){
    const level=row.sharing as Sharing;
    if(RANK[level]>RANK[best.get(row.owner)??'none'])best.set(row.owner,level);
  }
  const defaults=new Map((await db.select({owner:profiles.owner,defaultSharing:profiles.defaultSharing}).from(profiles).where(inArray(profiles.owner,visible)))
    .map(row=>[row.owner,row.defaultSharing as Sharing]));
  for(const owner of visible)resolved.set(owner,overrides.get(owner)??best.get(owner)??defaults.get(owner)??'busy');
  return resolved;
}

// The inverse view: what one owner shares with each of many viewers. Same precedence,
// resolved in bulk so listing friends does not query per person.
export async function sharingWithViewers(db:Database,ownerId:string,viewerIds:string[]):Promise<Map<string,Sharing>>{
  const resolved=new Map<string,Sharing>();
  for(const viewer of viewerIds)resolved.set(viewer,'none');
  const friends=new Set(await acceptedFriends(db,ownerId));
  const visible=viewerIds.filter(viewer=>friends.has(viewer));
  if(!visible.length)return resolved;
  const overrides=new Map((await db.select().from(calendarShares).where(and(eq(calendarShares.ownerId,ownerId),inArray(calendarShares.viewerId,visible))))
    .map(row=>[row.viewerId,row.sharing as Sharing]));
  const groups=await db.select({memberId:friendGroupMembers.memberId,sharing:friendGroups.sharing}).from(friendGroupMembers)
    .innerJoin(friendGroups,eq(friendGroups.id,friendGroupMembers.groupId))
    .where(and(eq(friendGroups.owner,ownerId),inArray(friendGroupMembers.memberId,visible)));
  const best=new Map<string,Sharing>();
  for(const row of groups){
    const level=row.sharing as Sharing;
    if(RANK[level]>RANK[best.get(row.memberId)??'none'])best.set(row.memberId,level);
  }
  const [profile]=await db.select({defaultSharing:profiles.defaultSharing}).from(profiles).where(eq(profiles.owner,ownerId));
  const fallback=(profile?.defaultSharing as Sharing)??'busy';
  for(const viewer of visible)resolved.set(viewer,overrides.get(viewer)??best.get(viewer)??fallback);
  return resolved;
}

type Block={start:string;end:string};
// Overlapping and touching blocks become one, so a viewer limited to 'busy' cannot count
// how many events fill an afternoon or where one ends and the next begins.
export function mergeBusy(blocks:Block[]):Block[]{
  const sorted=[...blocks].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  const merged:Block[]=[];
  for(const block of sorted){
    const last=merged[merged.length-1];
    if(last&&Date.parse(block.start)<=Date.parse(last.end)){
      if(Date.parse(block.end)>Date.parse(last.end))last.end=block.end;
    }else merged.push({...block});
  }
  return merged;
}

// Everything a friend is busy with: what they own plus what they have been invited to
// and not declined, the same set the scheduling polls already treat as busy.
async function calendarOf(db:Database,ownerIds:string[]){
  if(!ownerIds.length)return [];
  const owned=await db.select({userId:events.owner,data:events.data,id:events.id}).from(events).where(inArray(events.owner,ownerIds));
  const shared=await db.select({userId:eventMembers.userId,data:events.data,id:events.id}).from(eventMembers)
    .innerJoin(events,eq(events.id,eventMembers.eventId))
    .where(and(inArray(eventMembers.userId,ownerIds),inArray(eventMembers.status,['Invited','Going','Maybe'])));
  const seen=new Set<string>();
  return [...owned,...shared].flatMap(row=>{
    const key=row.userId+'|'+row.id;
    if(seen.has(key))return [];
    seen.add(key);
    let data:{start?:unknown;end?:unknown;title?:unknown;location?:unknown;allDay?:unknown};
    try{data=JSON.parse(row.data)}catch{return []}
    if(typeof data.start!=='string'||typeof data.end!=='string')return [];
    if(!Number.isFinite(Date.parse(data.start))||!Number.isFinite(Date.parse(data.end)))return [];
    return [{userId:row.userId,id:row.id,start:data.start,end:data.end,
      title:typeof data.title==='string'?data.title:'',location:typeof data.location==='string'?data.location:'',allDay:data.allDay===true}];
  });
}

export async function friendsRoute(req:Request,db:Database,user:User,path:string):Promise<Response|undefined>{
  const method=req.method;

  if(path==='/api/friends/groups'){
    if(method==='GET'){
      const rows=await db.select().from(friendGroups).where(eq(friendGroups.owner,user.id)).orderBy(friendGroups.createdAt);
      const members=rows.length?await db.select().from(friendGroupMembers).where(inArray(friendGroupMembers.groupId,rows.map(r=>r.id))):[];
      return json({groups:rows.map(group=>({id:group.id,name:group.name,color:group.color,sharing:group.sharing,
        members:members.filter(m=>m.groupId===group.id).map(m=>m.memberId)}))});
    }
    if(method==='POST'){
      const input=await body(req,groupInput);
      const groupId=randomUUID();
      await db.insert(friendGroups).values({id:groupId,owner:user.id,...input});
      return json({id:groupId,...input,members:[]},201);
    }
    return;
  }

  const groupMembers=path.match(/^\/api\/friends\/groups\/([^/]+)\/members$/);
  if(groupMembers&&method==='PUT'){
    const groupId=id.parse(groupMembers[1]);
    const {userIds}=await body(req,z.object({userIds:z.array(id).max(200)}));
    await db.transaction(async tx=>{
      const [group]=await tx.select().from(friendGroups).where(and(eq(friendGroups.id,groupId),eq(friendGroups.owner,user.id)));
      ensure(group,404,'Group not found.');
      // Only accepted friends can be filed into a group; the group is what grants sight
      // of the calendar, so an unaccepted account must never reach one.
      const friends=new Set(await acceptedFriends(tx,user.id));
      const unknown=userIds.find(candidate=>!friends.has(candidate));
      ensure(!unknown,400,'Add someone as a friend before putting them in a group.');
      await tx.delete(friendGroupMembers).where(eq(friendGroupMembers.groupId,groupId));
      if(userIds.length)await tx.insert(friendGroupMembers).values([...new Set(userIds)].map(memberId=>({groupId,memberId})));
    });
    return json({ok:true});
  }

  const groupMatch=path.match(/^\/api\/friends\/groups\/([^/]+)$/);
  if(groupMatch&&(method==='PATCH'||method==='DELETE')){
    const groupId=id.parse(groupMatch[1]);
    if(method==='DELETE'){
      const [removed]=await db.delete(friendGroups).where(and(eq(friendGroups.id,groupId),eq(friendGroups.owner,user.id))).returning({id:friendGroups.id});
      ensure(removed,404,'Group not found.');
      return json({ok:true});
    }
    const patch=await body(req,groupInput.partial());
    ensure(Object.keys(patch).length,400,'Nothing to update.');
    const [updated]=await db.update(friendGroups).set(patch).where(and(eq(friendGroups.id,groupId),eq(friendGroups.owner,user.id))).returning({id:friendGroups.id});
    ensure(updated,404,'Group not found.');
    return json({ok:true});
  }

  const sharingMatch=path.match(/^\/api\/friends\/sharing\/([^/]+)$/);
  if(sharingMatch&&method==='PUT'){
    const friendId=id.parse(sharingMatch[1]);
    ensure(friendId!==user.id,400,'You cannot set sharing for yourself.');
    // 'default' drops the override and hands the decision back to the groups.
    const {sharing:level}=await body(req,z.object({sharing:z.enum([...SHARING,'default'])}));
    const friends=new Set(await acceptedFriends(db,user.id));
    ensure(friends.has(friendId),404,'Friend not found.');
    if(level==='default')await db.delete(calendarShares).where(and(eq(calendarShares.ownerId,user.id),eq(calendarShares.viewerId,friendId)));
    else await db.insert(calendarShares).values({ownerId:user.id,viewerId:friendId,sharing:level})
      .onConflictDoUpdate({target:[calendarShares.ownerId,calendarShares.viewerId],set:{sharing:level}});
    return json({ok:true});
  }

  if(path==='/api/friends/calendar'&&method==='GET'){
    const url=new URL(req.url);
    const range=z.object({start:z.string(),end:z.string()}).parse({start:url.searchParams.get('start')??'',end:url.searchParams.get('end')??''});
    const from=Date.parse(range.start),to=Date.parse(range.end);
    ensure(Number.isFinite(from)&&Number.isFinite(to)&&to>from,400,'Provide a valid start and end.');
    ensure(to-from<=WINDOW_DAYS*86400000,400,`Ask for at most ${WINDOW_DAYS} days at a time.`);

    const friendIds=await acceptedFriends(db,user.id);
    const levels=await resolveSharing(db,user.id,friendIds);
    // Nobody sharing 'none' is queried at all, so their events never enter this process.
    const visible=friendIds.filter(friendId=>levels.get(friendId)!=='none');
    const people=visible.length?await db.select({id:accounts.id,username:accounts.username,name:profiles.name})
      .from(accounts).innerJoin(profiles,eq(profiles.owner,accounts.id)).where(inArray(accounts.id,visible)):[];
    const calendar=await calendarOf(db,visible);
    const within=calendar.filter(e=>Date.parse(e.start)<to&&Date.parse(e.end)>from);

    return json({friends:people.map(person=>{
      const level=levels.get(person.id)!;
      const mine=within.filter(e=>e.userId===person.id);
      return {userId:person.id,username:person.username,name:person.name,sharing:level,
        // A 'busy' viewer receives start and end and nothing else: no title, no location,
        // no id. The projection happens here so the browser never holds what it may not show.
        events:level==='details'
          ? mine.map(e=>({id:e.id,title:e.title,start:e.start,end:e.end,location:e.location,allDay:e.allDay}))
          : mergeBusy(mine.map(e=>({start:e.start,end:e.end})))};
    })});
  }
}
