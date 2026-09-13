'use client';
import {useState} from 'react';
import {UserPlus,Search,Trash2,Check,X,Users,Eye,EyeOff,Circle,Plus} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {toast} from 'sonner';
import {Choice,api} from './ontime-dialogs';

// One vocabulary for the three levels, written from the point of view of whoever is
// reading it, so "what they see of me" is never mistaken for "what I see of them".
export const SHARING_OPTIONS=[{value:'details',label:'My events'},{value:'busy',label:'Busy only'},{value:'none',label:'Nothing'}];
const YOU_SHOW:Record<string,string>={details:'Sees what your events are',busy:'Sees only that you are busy',none:'Cannot see your calendar'};
const THEY_SHOW:Record<string,string>={details:'You see their events',busy:'You see them as busy',none:'Their calendar is hidden'};
const GROUP_COLORS=['#329b91','#9792de','#e7b363'];

type Person={id:string;username:string;name:string;bio?:string};
// What the calendar feed returns per friend, as a union on the sharing level: 'details'
// carries a title and place, 'busy' carries nothing but the span. Keeping it a union
// means the compiler will not let a busy block be read as though it had a title.
type FeedBase={userId:string;username:string;name:string};
export type FriendFeed=
  (FeedBase&{sharing:'details';events:{id:string;title:string;start:string;end:string;location:string;allDay:boolean}[]})
 |(FeedBase&{sharing:'busy';events:{start:string;end:string}[]});
export type Friend={id:string;status:string;direction:string;user:Person;sharing:string;sharingOverride:string|null;theirSharing:string;groups:string[]};
export type Group={id:string;name:string;color:string;sharing:string;members:string[]};
type Props={friends:Friend[];groups:Group[];profile:{defaultSharing?:string};refresh:()=>Promise<void>};
const message=(e:unknown)=>e instanceof Error?e.message:'Please try again.';

export function FriendsPanel({friends,groups,profile,refresh}:Props){
  const [query,setQuery]=useState(''),[results,setResults]=useState<Person[]>([]),[searching,setSearching]=useState(false);
  const [groupName,setGroupName]=useState(''),[groupSharing,setGroupSharing]=useState('busy'),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState('');
  const accepted=friends.filter(f=>f.status==='accepted');
  const incoming=friends.filter(f=>f.status==='pending'&&f.direction==='incoming');
  const outgoing=friends.filter(f=>f.status==='pending'&&f.direction==='outgoing');
  const blocked=friends.filter(f=>f.status==='blocked');

  async function run(key:string,work:()=>Promise<unknown>,done?:string){
    setBusy(key);
    try{await work();await refresh();if(done)toast.success(done)}
    catch(e){toast.error(message(e))}
    finally{setBusy('')}
  }
  async function search(e:React.FormEvent){
    e.preventDefault();
    const q=query.trim().toLowerCase();
    if(!/^[a-z0-9_]{2,30}$/.test(q)){setResults([]);toast.info('Search by username: 2–30 letters, numbers, or underscores.');return}
    setSearching(true);
    try{const d=await api('/api/users?q='+encodeURIComponent(q));setResults(d.users)}
    catch(e){toast.error(message(e))}
    finally{setSearching(false)}
  }
  const known=(id:string)=>friends.some(f=>f.user?.id===id);

  return <section className="friends-panel">
    <div className="friends-default">
      <div>
        <strong>Everyone else you add</strong>
        <span>Where a friend is in no group and has no setting of their own, this is what they get.</span>
      </div>
      <Choice label="Default sharing" value={profile.defaultSharing||'busy'} options={SHARING_OPTIONS}
        onChange={v=>run('default',()=>api('/api/action',{action:'profile',profile:{defaultSharing:v}}),'Default updated')}/>
    </div>

    {incoming.length>0&&<div className="friends-block">
      <h3>Waiting on you</h3>
      {incoming.map(f=><div className="friend-row" key={f.id}>
        <span className="avatar">{(f.user?.name||'?')[0].toUpperCase()}</span>
        <div className="friend-name"><strong>{f.user?.name}</strong><small>@{f.user?.username}</small></div>
        <button className="primary small" disabled={!!busy} onClick={()=>run(f.id,()=>api(`/api/friends/${f.id}`,{action:'accept'},'PATCH'),'Friend added')}><Check size={15}/>Accept</button>
        <button className="outline small" disabled={!!busy} onClick={()=>run(f.id,()=>api(`/api/friends/${f.id}`,{action:'decline'},'PATCH'))}><X size={15}/>Decline</button>
      </div>)}
    </div>}

    <div className="friends-block">
      <div className="friends-block-head">
        <h3>Groups</h3>
        <span>A group sets one sharing level for everyone in it.</span>
      </div>
      {groups.map(g=><div className="group-card" key={g.id}>
        <div className="group-head">
          <span className="group-dot" style={{background:GROUP_COLORS[Number(g.color)||0]}}/>
          <strong>{g.name}</strong>
          <small>{g.members.length} {g.members.length===1?'person':'people'}</small>
          <Choice label={`Sharing for ${g.name}`} value={g.sharing} options={SHARING_OPTIONS}
            onChange={v=>run(g.id,()=>api(`/api/friends/groups/${g.id}`,{sharing:v},'PATCH'),`${g.name} updated`)}/>
          <button className="link-button" onClick={()=>setEditing(editing===g.id?null:g.id)}>{editing===g.id?'Done':'Edit people'}</button>
          <button className="icon-button" aria-label={`Delete ${g.name}`} disabled={!!busy}
            onClick={()=>run(g.id,()=>api(`/api/friends/groups/${g.id}`,undefined,'DELETE'),`${g.name} deleted`)}><Trash2 size={16}/></button>
        </div>
        {editing===g.id&&<div className="group-members">
          {!accepted.length&&<p className="muted">Add a friend first, then you can put them in this group.</p>}
          {accepted.map(f=><label key={f.user.id}>
            <Checkbox checked={g.members.includes(f.user.id)} aria-label={`${f.user.name} in ${g.name}`}
              onCheckedChange={v=>{
                const next=v?[...g.members,f.user.id]:g.members.filter((m:string)=>m!==f.user.id);
                run(g.id,()=>api(`/api/friends/groups/${g.id}/members`,{userIds:next},'PUT'));
              }}/>
            <span>{f.user.name}</span><small>@{f.user.username}</small>
          </label>)}
        </div>}
      </div>)}
      <form className="group-new" onSubmit={e=>{
        e.preventDefault();
        const name=groupName.trim();
        if(!name){toast.info('Give the group a name.');return}
        run('new-group',async()=>{await api('/api/friends/groups',{name,color:String(groups.length%3),sharing:groupSharing});setGroupName('')},`${name} created`);
      }}>
        <input aria-label="New group name" maxLength={60} placeholder="Name a group — Close friends, Work, Family" value={groupName} onChange={e=>setGroupName(e.target.value)}/>
        <Choice label="Sharing for the new group" value={groupSharing} options={SHARING_OPTIONS} onChange={setGroupSharing}/>
        <button className="outline" type="submit" disabled={busy==='new-group'}><Plus size={16}/>Create</button>
      </form>
    </div>

    <div className="friends-block">
      <div className="friends-block-head">
        <h3>Friends</h3>
        <span>A setting here overrides every group, including hiding your calendar from one person.</span>
      </div>
      {!accepted.length&&<p className="muted">No friends yet. Search for someone below to connect your calendars.</p>}
      {accepted.map(f=>{
        const inGroups=groups.filter(g=>g.members.includes(f.user.id));
        return <div className="friend-row wide" key={f.id}>
          <span className="avatar">{(f.user?.name||'?')[0].toUpperCase()}</span>
          <div className="friend-name">
            <strong>{f.user?.name}</strong><small>@{f.user?.username}</small>
            <p className="friend-status">
              {f.theirSharing==='details'?<Eye size={13}/>:f.theirSharing==='busy'?<Circle size={13}/>:<EyeOff size={13}/>}
              {THEY_SHOW[f.theirSharing]}
            </p>
          </div>
          <div className="friend-sharing">
            <label>They see</label>
            <Choice label={`What ${f.user?.name} sees`} value={f.sharingOverride??'default'}
              options={[{value:'default',label:inGroups.length?`Group setting (${inGroups.map(g=>g.name).join(', ')})`:`My default (${SHARING_OPTIONS.find(o=>o.value===(profile.defaultSharing||'busy'))?.label})`},...SHARING_OPTIONS]}
              onChange={v=>run(f.id,()=>api(`/api/friends/sharing/${f.user.id}`,{sharing:v},'PUT'),'Sharing updated')}/>
            <small>{YOU_SHOW[f.sharing]}</small>
          </div>
          <button className="icon-button" aria-label={`Remove ${f.user?.name}`} disabled={!!busy}
            onClick={()=>run(f.id,()=>api(`/api/friends/${f.id}`,{action:'remove'},'PATCH'),'Friend removed')}><Trash2 size={16}/></button>
        </div>;
      })}
    </div>

    {outgoing.length>0&&<div className="friends-block">
      <h3>Invitations you sent</h3>
      {outgoing.map(f=><div className="friend-row" key={f.id}>
        <span className="avatar">{(f.user?.name||'?')[0].toUpperCase()}</span>
        <div className="friend-name"><strong>{f.user?.name}</strong><small>@{f.user?.username}</small></div>
        <small className="muted">Waiting for them</small>
        <button className="outline small" disabled={!!busy} onClick={()=>run(f.id,()=>api(`/api/friends/${f.id}`,{action:'cancel'},'PATCH'))}>Cancel</button>
      </div>)}
    </div>}

    {blocked.length>0&&<div className="friends-block">
      <h3>Blocked</h3>
      {blocked.map(f=><div className="friend-row" key={f.id}>
        <span className="avatar">{(f.user?.name||'?')[0].toUpperCase()}</span>
        <div className="friend-name"><strong>{f.user?.name}</strong><small>@{f.user?.username}</small></div>
        <button className="outline small" disabled={!!busy} onClick={()=>run(f.id,()=>api(`/api/friends/${f.id}`,{action:'unblock'},'PATCH'),'Unblocked')}>Unblock</button>
      </div>)}
    </div>}

    <div className="friends-block">
      <h3>Add a friend</h3>
      <form className="friend-search" onSubmit={search}>
        <input aria-label="Find someone by username" maxLength={30} placeholder="Find someone by username" value={query} onChange={e=>setQuery(e.target.value)}/>
        <button className="outline" type="submit" disabled={searching}><Search size={16}/>{searching?'Searching…':'Search'}</button>
      </form>
      {results.map(person=><div className="friend-row" key={person.id}>
        <span className="avatar">{(person.name||'?')[0].toUpperCase()}</span>
        <div className="friend-name"><strong>{person.name}</strong><small>@{person.username}</small></div>
        {known(person.id)
          ?<small className="muted">Already connected</small>
          :<button className="primary small" disabled={!!busy} onClick={()=>run(person.id,()=>api('/api/friends/requests',{userId:person.id}),'Invitation sent')}><UserPlus size={15}/>Add</button>}
      </div>)}
      {!results.length&&<p className="muted"><Users size={14}/> Friends see your calendar at whatever level you choose — and nothing until you choose it.</p>}
    </div>
  </section>;
}
