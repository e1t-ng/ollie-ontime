import {pgTable,text,timestamp,bigserial,index,uniqueIndex,integer,boolean,jsonb,primaryKey,foreignKey,check} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
export const calendars=pgTable('calendars',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),color:text('color').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),seq:bigserial('seq',{mode:'number'}).notNull()},t=>[index('calendars_owner').on(t.owner)]);
export const events=pgTable('events',{id:text('id').primaryKey(),owner:text('owner').notNull(),calendar:text('calendar').notNull(),data:text('data').notNull(),token:text('token').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),seq:bigserial('seq',{mode:'number'}).notNull()},t=>[index('events_owner').on(t.owner),uniqueIndex('events_token').on(t.token)]);
export const profiles=pgTable('profiles',{owner:text('owner').primaryKey(),name:text('name').notNull(),birthday:text('birthday').notNull().default(''),homeCity:text('home_city').notNull().default(''),timeZone:text('time_zone').notNull().default(''),locationSharing:text('location_sharing').notNull().default('never'),bio:text('bio').notNull().default(''),visibility:text('visibility').notNull().default('friends'),phone:text('phone').notNull().default(''),gender:text('gender').notNull().default(''),eventRecommendations:boolean('event_recommendations').notNull().default(false),defaultSharing:text('default_sharing').notNull().default('busy')});
export const responses=pgTable('responses',{event:text('event').notNull(),user:text('user').notNull(),name:text('name').notNull(),status:text('status').notNull()},t=>[uniqueIndex('responses_event_user').on(t.event,t.user)]);

// Legacy owner IDs remain untouched. New accounts receive independent UUIDs.
// passwordHash is null for accounts created through Google; googleSub is null for
// password accounts. Postgres unique indexes ignore nulls, so both stay unique.
export const accounts=pgTable('accounts',{
  id:text('id').primaryKey(),email:text('email').notNull(),username:text('username').notNull(),
  passwordHash:text('password_hash'),googleSub:text('google_sub'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('accounts_email').on(t.email),uniqueIndex('accounts_username').on(t.username),uniqueIndex('accounts_google_sub').on(t.googleSub),
  check('accounts_credential',sql`${t.passwordHash} is not null or ${t.googleSub} is not null`)]);

// Short-lived OAuth handshake records. The browser also holds a binding cookie so a
// stolen or attacker-generated state value cannot complete someone else's sign-in.
export const oauthStates=pgTable('oauth_states',{
  state:text('state').primaryKey(),verifier:text('verifier').notNull(),bindingHash:text('binding_hash').notNull(),
  returnTo:text('return_to').notNull().default('/'),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
},t=>[index('oauth_states_expiry').on(t.expiresAt)]);

export const sessions=pgTable('sessions',{
  tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('sessions_user').on(t.userId),index('sessions_expiry').on(t.expiresAt)]);

export const authLimits=pgTable('auth_limits',{
  key:text('key').primaryKey(),count:integer('count').notNull(),resetAt:timestamp('reset_at',{withTimezone:true}).notNull(),
},t=>[index('auth_limits_expiry').on(t.resetAt)]);

export const friendships=pgTable('friendships',{
  id:text('id').primaryKey(),userLow:text('user_low').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  userHigh:text('user_high').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  requesterId:text('requester_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  status:text('status').notNull().default('pending'),blockedBy:text('blocked_by'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('friendships_pair').on(t.userLow,t.userHigh),index('friendships_high').on(t.userHigh),
  check('friendships_order',sql`${t.userLow} < ${t.userHigh}`),
  check('friendships_status',sql`${t.status} in ('pending','accepted','blocked')`)]);

export type PollWindow={start:string;end:string};
export const polls=pgTable('polls',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  title:text('title').notNull(),description:text('description').notNull().default(''),location:text('location').notNull().default(''),
  timeZone:text('time_zone').notNull(),durationMinutes:integer('duration_minutes').notNull(),
  minParticipants:integer('min_participants').notNull(),windows:jsonb('windows').$type<PollWindow[]>().notNull(),
  status:text('status').notNull().default('open'),eventId:text('event_id'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('polls_owner').on(t.ownerId),check('polls_status',sql`${t.status} in ('open','confirmed','cancelled')`)]);

export const pollMembers=pgTable('poll_members',{
  pollId:text('poll_id').notNull().references(()=>polls.id,{onDelete:'cascade'}),
  userId:text('user_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),required:boolean('required').notNull().default(false),
  submittedAt:timestamp('submitted_at',{withTimezone:true}),
},t=>[primaryKey({columns:[t.pollId,t.userId]}),index('poll_members_user').on(t.userId)]);

export const availabilityBlocks=pgTable('availability_blocks',{
  id:text('id').primaryKey(),pollId:text('poll_id').notNull(),userId:text('user_id').notNull(),
  startsAt:timestamp('starts_at',{withTimezone:true}).notNull(),endsAt:timestamp('ends_at',{withTimezone:true}).notNull(),status:text('status').notNull(),
},t=>[foreignKey({columns:[t.pollId,t.userId],foreignColumns:[pollMembers.pollId,pollMembers.userId]}).onDelete('cascade'),
  index('availability_poll_user').on(t.pollId,t.userId),check('availability_range',sql`${t.endsAt} > ${t.startsAt}`),
  check('availability_status',sql`${t.status} in ('preferred','available','maybe','unavailable')`)]);

// One shared event, separate attendance records; no duplicate event copies.
export const eventMembers=pgTable('event_members',{
  eventId:text('event_id').notNull().references(()=>events.id,{onDelete:'cascade'}),
  userId:text('user_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  status:text('status').notNull().default('Invited'),
},t=>[primaryKey({columns:[t.eventId,t.userId]}),index('event_members_user').on(t.userId),
  check('event_members_status',sql`${t.status} in ('Invited','Going','Maybe','Not going')`)]);

// How much of one account's calendar a friend may see. 'none' hides it, 'busy' shows
// opaque blocks with no titles, 'details' shows what the event is.
export const SHARING=['none','busy','details'] as const;
export type Sharing=typeof SHARING[number];

// Named circles an account sorts its friends into. The group carries the sharing level
// its members get, so "Close friends" and "Work" can differ without per-person setup.
export const friendGroups=pgTable('friend_groups',{
  id:text('id').primaryKey(),owner:text('owner').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  name:text('name').notNull(),color:text('color').notNull().default('1'),sharing:text('sharing').notNull().default('busy'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('friend_groups_owner_name').on(t.owner,t.name),index('friend_groups_owner').on(t.owner),
  check('friend_groups_sharing',sql`${t.sharing} in ('none','busy','details')`)]);

export const friendGroupMembers=pgTable('friend_group_members',{
  groupId:text('group_id').notNull().references(()=>friendGroups.id,{onDelete:'cascade'}),
  memberId:text('member_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
},t=>[primaryKey({columns:[t.groupId,t.memberId]}),index('friend_group_members_member').on(t.memberId)]);

// A per-person answer that overrides every group, including hiding the calendar from
// one member of an otherwise trusted group. Directional: owner decides what viewer sees.
export const calendarShares=pgTable('calendar_shares',{
  ownerId:text('owner_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  viewerId:text('viewer_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),
  sharing:text('sharing').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.viewerId]}),index('calendar_shares_viewer').on(t.viewerId),
  check('calendar_shares_sharing',sql`${t.sharing} in ('none','busy','details')`),
  check('calendar_shares_distinct',sql`${t.ownerId} <> ${t.viewerId}`)]);
