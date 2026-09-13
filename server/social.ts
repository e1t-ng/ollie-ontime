import {randomUUID} from 'node:crypto';
import {and,eq,or,ne,ilike} from 'drizzle-orm';
import {z} from 'zod';
import {accounts,profiles,friendships,friendGroups,friendGroupMembers,calendarShares,SHARING} from '../db/schema';
import type {Database} from './database';
import type {User} from './auth';
import {body,ensure,json,id,username,timeZone,birthday} from './http';
import {resolveSharing,sharingWithViewers} from './friends';

export const gender=z.enum(['Woman','Man','Non-binary','Prefer not to say','']);
export const profilePatch=z.object({name:z.string().trim().min(1).max(100).optional(),username:username.optional(),birthday:birthday.optional(),homeCity:z.string().trim().max(100).optional(),timeZone:timeZone.optional(),locationSharing:z.enum(['never','while_using','always']).optional(),bio:z.string().trim().max(500).optional(),visibility:z.enum(['public','friends','private']).optional(),phone:z.string().trim().max(20).optional(),gender:gender.optional(),eventRecommendations:z.boolean().optional(),defaultSharing:z.enum(SHARING).optional()}).strict();
export const publicFields={id:accounts.id,username:accounts.username,name:profiles.name,bio:profiles.bio};
export async function relationship(db:Database,a:string,b:string){
  const [low,high]=[a,b].sort();
  return (await db.select().from(friendships).where(and(eq(friendships.userLow,low),eq(friendships.userHigh,high))).limit(1))[0];
}
export async function updateProfile(db:Database,user:User,input:z.infer<typeof profilePatch>){
  const {username,...fields}=input;
  await db.transaction(async tx=>{
    if(username)await tx.update(accounts).set({username}).where(eq(accounts.id,user.id));
    if(Object.keys(fields).length)await tx.update(profiles).set(fields).where(eq(profiles.owner,user.id));
  });
}
export async function socialRoute(req:Request,db:Database,user:User,path:string):Promise<Response|undefined>{
  const method=req.method;
  if(path==='/api/profile'){
    if(method==='PATCH')await updateProfile(db,user,await body(req,profilePatch));
    else if(method!=='GET')return;
    const [profile]=await db.select().from(profiles).where(eq(profiles.owner,user.id));
    const [account]=await db.select({username:accounts.username}).from(accounts).where(eq(accounts.id,user.id));
    return json({profile:{...profile,username:account.username}});
  }
  if(path==='/api/users'&&method==='GET'){
    const q=z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,30}$/).parse(new URL(req.url).searchParams.get('q'));
    const rows=await db.select(publicFields).from(accounts).innerJoin(profiles,eq(profiles.owner,accounts.id))
      .where(and(ne(accounts.id,user.id),ne(profiles.visibility,'private'),ilike(accounts.username,q.replaceAll('_','\\_')+'%'))).limit(30);
    const users=[];
    for(const row of rows)if((await relationship(db,user.id,row.id))?.status!=='blocked')users.push(row);
    return json({users});
  }
  const userMatch=path.match(/^\/api\/users\/([^/]+)$/);
  if(userMatch&&method==='GET'){
    const target=id.parse(userMatch[1]),rel=await relationship(db,user.id,target);
    const [row]=await db.select({...publicFields,visibility:profiles.visibility,timeZone:profiles.timeZone,homeCity:profiles.homeCity}).from(accounts).innerJoin(profiles,eq(profiles.owner,accounts.id)).where(eq(accounts.id,target));
    ensure(row&&rel?.status!=='blocked'&&(target===user.id||row.visibility==='public'||(row.visibility==='friends'&&rel?.status==='accepted')),404,'Profile not found.');
    return json({profile:row});
  }
  if(path==='/api/friends'&&method==='GET'){
    const rows=await db.select().from(friendships).where(or(eq(friendships.userLow,user.id),eq(friendships.userHigh,user.id)));
    const visible=rows.filter(row=>row.status!=='blocked'||row.blockedBy===user.id);
    const targets=visible.map(row=>row.userLow===user.id?row.userHigh:row.userLow);
    // Two directions, and they are independent: what they let me see, and what I let
    // them see. The UI needs both so neither is mistaken for the other.
    const theirs=await resolveSharing(db,user.id,targets);
    const mine=await sharingWithViewers(db,user.id,targets);
    const overrides=new Map((await db.select().from(calendarShares).where(eq(calendarShares.ownerId,user.id))).map(row=>[row.viewerId,row.sharing]));
    const memberships=await db.select({groupId:friendGroupMembers.groupId,memberId:friendGroupMembers.memberId}).from(friendGroupMembers)
      .innerJoin(friendGroups,eq(friendGroups.id,friendGroupMembers.groupId)).where(eq(friendGroups.owner,user.id));
    const friends=[];
    for(const row of visible){
      const target=row.userLow===user.id?row.userHigh:row.userLow;
      const [person]=await db.select(publicFields).from(accounts).innerJoin(profiles,eq(profiles.owner,accounts.id)).where(eq(accounts.id,target));
      friends.push({id:row.id,status:row.status,direction:row.requesterId===user.id?'outgoing':'incoming',user:person,
        sharing:row.status==='accepted'?mine.get(target)??'none':'none',
        sharingOverride:overrides.get(target)??null,
        theirSharing:row.status==='accepted'?theirs.get(target)??'none':'none',
        groups:memberships.filter(m=>m.memberId===target).map(m=>m.groupId)});
    }
    return json({friends});
  }
  if(path==='/api/friends/requests'&&method==='POST'){
    const {userId}=await body(req,z.object({userId:id}));ensure(userId!==user.id,400,'You cannot add yourself.');
    const [target]=await db.select().from(profiles).where(eq(profiles.owner,userId));
    const rel=await relationship(db,user.id,userId);
    ensure(target&&target.visibility!=='private'&&rel?.status!=='blocked',404,'User not found.');
    ensure(!rel,409,'A connection or request already exists.');
    const [userLow,userHigh]=[user.id,userId].sort();
    const requestId=randomUUID();await db.insert(friendships).values({id:requestId,userLow,userHigh,requesterId:user.id});
    return json({id:requestId,status:'pending'},201);
  }
  const friendMatch=path.match(/^\/api\/friends\/([^/]+)$/);
  if(friendMatch&&method==='PATCH'){
    const requestId=id.parse(friendMatch[1]);
    const {action}=await body(req,z.object({action:z.enum(['accept','decline','cancel','remove','block','unblock'])}));
    await db.transaction(async tx=>{
      const [rel]=await tx.select().from(friendships).where(eq(friendships.id,requestId)).for('update');
      ensure(rel&&(rel.userLow===user.id||rel.userHigh===user.id),404,'Connection not found.');
      if(action==='accept'){
        ensure(rel.status==='pending'&&rel.requesterId!==user.id,409,'Only the recipient can accept a pending request.');
        await tx.update(friendships).set({status:'accepted'}).where(eq(friendships.id,requestId));
      }else if(action==='block'){
        ensure(rel.status!=='blocked'||rel.blockedBy===user.id,404,'Connection not found.');
        await tx.update(friendships).set({status:'blocked',blockedBy:user.id}).where(eq(friendships.id,requestId));
      }else{
        ensure((action==='unblock'&&rel.status==='blocked'&&rel.blockedBy===user.id)||(action==='remove'&&rel.status==='accepted')||(action==='cancel'&&rel.status==='pending'&&rel.requesterId===user.id)||(action==='decline'&&rel.status==='pending'&&rel.requesterId!==user.id),409,'This action does not apply to the connection.');
        await tx.delete(friendships).where(eq(friendships.id,requestId));
      }
    });
    return json({ok:true});
  }
}
