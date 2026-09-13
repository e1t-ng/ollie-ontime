'use client';
import {useState,useEffect,useMemo,useRef} from 'react';
import {Plus,ArrowLeft,Check,X,CalendarCheck,Clock,MapPin,Users,CircleAlert} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {toast} from 'sonner';
import {Choice,api} from './ontime-dialogs';
import {clock,buildGrid,fromBlocks,toBlocks,dailyWindows,type Grid,type Block,type PollWindow} from '@/lib/polls';

// Painting happens in half hours. The server ranks meeting starts every 15 minutes, so a
// cell is a place to say "I am free", not a meeting slot — the two grids below differ.
const HEAT=['#f0f3f3','#dfefe5','#afdbc3','#68b18d'];
const PAINTS=[{value:'available',label:'Available'},{value:'preferred',label:'Preferred'},{value:'maybe',label:'If needed'}];
const PAINT_COLOR:Record<string,string>={available:'#68b18d',preferred:'#2f8f6f',maybe:'#c9dcd3'};

type Poll={id:string;ownerId:string;title:string;description:string;location:string;timeZone:string;durationMinutes:number;minParticipants:number;windows:PollWindow[];status:string;eventId:string|null};
type Member={id:string;username:string;name:string;required:boolean;submittedAt:string|null};
type Slot={start:string;end:string;qualified:boolean;available:number;preferred:number;maybe:number;participants:{userId:string;required:boolean;status:string}[]};
type Detail={poll:Poll;members:Member[];availability:Block[]};
type Friend={id:string;status:string;user:{id:string;username:string;name:string}};
type Props={friends:Friend[];userId:string|null;reload:()=>Promise<unknown>};

const message=(e:unknown)=>e instanceof Error?e.message:'Please try again.';
const when=(s:string)=>new Date(s).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export function PollsPanel({friends,userId,reload}:Props){
  const [polls,setPolls]=useState<{poll:Poll;required:boolean;submittedAt:string|null}[]>([]);
  const [openId,setOpenId]=useState<string|null>(null),[creating,setCreating]=useState(false),[version,setVersion]=useState(0);
  const [detail,setDetail]=useState<Detail|null>(null),[slots,setSlots]=useState<Slot[]>([]);
  const [paint,setPaint]=useState<Map<number,string>>(new Map()),[brush,setBrush]=useState('available'),[saving,setSaving]=useState(false);
  const drag=useRef<{erase:boolean}|null>(null);
  const accepted=friends.filter(f=>f.status==='accepted');

  useEffect(()=>{const live=new AbortController();
    api('/api/polls').then(d=>{if(!live.signal.aborted)setPolls(d.polls)}).catch(()=>{});
    return()=>live.abort();},[version]);

  useEffect(()=>{if(!openId)return;const live=new AbortController();
    Promise.all([api(`/api/polls/${openId}`),api(`/api/polls/${openId}/slots`)])
      .then(([d,s])=>{if(live.signal.aborted)return;setDetail(d);setSlots(s.slots);setPaint(fromBlocks(d.availability))})
      .catch(e=>{if(!live.signal.aborted)toast.error(message(e))});
    return()=>live.abort();},[openId,version]);

  // A drag that ends anywhere — off the grid, outside the window — still stops painting.
  useEffect(()=>{const stop=()=>{drag.current=null};
    window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);
    return()=>{window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop)}},[]);

  const grid=useMemo(()=>buildGrid(detail?.poll.windows??[]),[detail]);
  const slotAt=useMemo(()=>new Map(slots.map(s=>[Date.parse(s.start),s])),[slots]);
  const memberName=useMemo(()=>new Map((detail?.members??[]).map(m=>[m.id,m.name])),[detail]);

  function apply(stamp:number,erase:boolean){
    setPaint(prev=>{const next=new Map(prev);if(erase)next.delete(stamp);else next.set(stamp,brush);return next});
  }
  function onCellDown(stamp:number){
    const erase=paint.get(stamp)===brush;
    drag.current={erase};apply(stamp,erase);
  }
  async function saveAvailability(){
    if(!detail)return;
    setSaving(true);
    try{
      await api(`/api/polls/${detail.poll.id}/availability`,{blocks:toBlocks(paint,detail.poll.windows)},'PUT');
      setVersion(v=>v+1);toast.success('Availability saved');
    }catch(e){toast.error(message(e))}finally{setSaving(false)}
  }
  async function act(work:()=>Promise<unknown>,done:string){
    setSaving(true);
    try{await work();await reload();setVersion(v=>v+1);toast.success(done)}
    catch(e){toast.error(message(e))}finally{setSaving(false)}
  }

  if(creating)return <NewPoll friends={accepted} onCancel={()=>setCreating(false)}
    onCreated={id=>{setCreating(false);setVersion(v=>v+1);setOpenId(id)}}/>;

  if(openId&&detail){
    const {poll,members}=detail;
    const owner=poll.ownerId===userId;
    const ranked=slots.filter(s=>s.available>0).slice(0,6);
    const answered=members.filter(m=>m.submittedAt).length;
    return <section className="polls-panel">
      <button className="back-link" onClick={()=>{setOpenId(null);setDetail(null)}}><ArrowLeft size={16}/>All polls</button>
      <div className="poll-head">
        <div>
          <h2>{poll.title}</h2>
          <p className="poll-meta">
            <span><Clock size={14}/>{poll.durationMinutes} min</span>
            {poll.location&&<span><MapPin size={14}/>{poll.location}</span>}
            <span><Users size={14}/>{answered} of {members.length} answered</span>
            <span className={'poll-badge '+poll.status}>{poll.status}</span>
          </p>
          {poll.description&&<p className="poll-note">{poll.description}</p>}
        </div>
        {owner&&poll.status==='open'&&<button className="outline" disabled={saving}
          onClick={()=>act(()=>api(`/api/polls/${poll.id}/cancel`,{}),'Poll cancelled')}><X size={16}/>Cancel poll</button>}
      </div>

      {poll.status==='confirmed'&&<div className="notice"><CalendarCheck size={18}/>This poll is settled and the event is on everyone&apos;s calendar.</div>}
      {poll.status==='cancelled'&&<div className="notice"><CircleAlert size={18}/>This poll was cancelled.</div>}

      <div className="poll-grids">
        <div className="poll-grid-card">
          <div className="poll-grid-head">
            <div><h3>Your availability</h3><p>Drag across the times you can make. Drag over them again to clear.</p></div>
            <Choice label="Paint level" value={brush} onChange={setBrush} options={PAINTS}/>
          </div>
          <Grid grid={grid} label={t=>{
            const status=paint.get(t);
            return {background:status?PAINT_COLOR[status]:'#f7f9f9',title:status?PAINTS.find(p=>p.value===status)?.label??status:'Free to paint'};
          }}
            onDown={poll.status==='open'?onCellDown:undefined}
            onEnter={poll.status==='open'?stamp=>{if(drag.current)apply(stamp,drag.current.erase)}:undefined}/>
          <div className="poll-grid-foot">
            <span className="paint-key">{PAINTS.map(p=><span key={p.value}><i style={{background:PAINT_COLOR[p.value]}}/>{p.label}</span>)}</span>
            <button className="primary" disabled={saving||poll.status!=='open'} onClick={saveAvailability}>{saving?'Saving…':'Save my times'}</button>
          </div>
        </div>

        <div className="poll-grid-card">
          <div className="poll-grid-head">
            <div><h3>Everyone</h3><p>How many can attend a {poll.durationMinutes}-minute meeting starting at each time.</p></div>
          </div>
          <Grid grid={grid} label={t=>{
            const slot=slotAt.get(t);
            if(!slot)return {background:'#fbfcfc',title:`A ${poll.durationMinutes}-minute meeting does not fit here`};
            const free=slot.participants.filter(p=>['available','preferred'].includes(p.status)).map(p=>memberName.get(p.userId)??'Someone');
            const ratio=members.length?Math.ceil(slot.available/members.length*3):0;
            return {background:HEAT[ratio],title:`${slot.available} of ${members.length} free${free.length?': '+free.join(', '):''}`};
          }}/>
          <div className="poll-grid-foot">
            <span className="heat-key">Fewer<i/><i/><i/>Everyone</span>
            <span className="muted">{poll.minParticipants} needed to qualify</span>
          </div>
        </div>
      </div>

      <div className="poll-block">
        <h3>Best times</h3>
        {!ranked.length&&<p className="muted">No one has marked availability yet. Paint your times above to start it off.</p>}
        {ranked.map(slot=><div className={'slot-row'+(slot.qualified?' qualified':'')} key={slot.start}>
          <div className="slot-when"><strong>{when(slot.start)}</strong><small>{slot.available} of {members.length} free{slot.preferred?` · ${slot.preferred} prefer it`:''}</small></div>
          {slot.qualified?<span className="slot-tag"><Check size={14}/>Works for everyone required</span>:<span className="slot-tag short">Short of the minimum</span>}
          {owner&&poll.status==='open'&&<button className="primary small" disabled={saving||!slot.qualified}
            onClick={()=>act(()=>api(`/api/polls/${poll.id}/confirm`,{start:slot.start}),'Confirmed and added to your calendars')}>Pick this time</button>}
        </div>)}
      </div>

      <div className="poll-block">
        <h3>Who is in</h3>
        {members.map(m=><div className="friend-row" key={m.id}>
          <span className="avatar">{(m.name||'?')[0].toUpperCase()}</span>
          <div className="friend-name"><strong>{m.name}</strong><small>@{m.username}{m.required?' · required':''}</small></div>
          <small className={m.submittedAt?'muted':'pending'}>{m.submittedAt?'Answered':'Waiting'}</small>
        </div>)}
      </div>
    </section>;
  }

  return <section className="polls-panel">
    <div className="friends-default">
      <div>
        <strong>Find a time that works</strong>
        <span>Pick the days, let everyone paint when they are free, and the overlap comes back ranked.</span>
      </div>
      <button className="primary" onClick={()=>setCreating(true)}><Plus size={17}/>New poll</button>
    </div>
    <div className="poll-block">
      <h3>Your polls</h3>
      {!polls.length&&<p className="muted">No polls yet. Start one and invite the friends you want to meet.</p>}
      {polls.map(({poll,submittedAt})=><button className="poll-card" key={poll.id} onClick={()=>setOpenId(poll.id)}>
        <div>
          <strong>{poll.title}</strong>
          <small>{poll.windows.length} {poll.windows.length===1?'day':'days'} · {poll.durationMinutes} min{poll.windows[0]?' · from '+new Date(poll.windows[0].start).toLocaleDateString([],{month:'short',day:'numeric'}):''}</small>
        </div>
        {!submittedAt&&poll.status==='open'&&<span className="poll-tag">Needs your times</span>}
        <span className={'poll-badge '+poll.status}>{poll.status}</span>
      </button>)}
    </div>
  </section>;
}

function Grid({grid,label,onDown,onEnter}:{
  grid:Grid;
  label:(stamp:number)=>{background:string;title:string};
  onDown?:(stamp:number)=>void;onEnter?:(stamp:number)=>void;
}){
  if(!grid.days.length)return <p className="muted">This poll has no open times.</p>;
  return <div className="poll-grid-scroll"><div className="poll-grid" style={{gridTemplateColumns:`62px repeat(${grid.days.length},minmax(52px,1fr))`}}>
    <span/>
    {grid.days.map(day=><span className="poll-day" key={day}>
      <small>{new Date(day+'T12:00:00').toLocaleDateString([],{weekday:'short'}).toUpperCase()}</small>
      <strong>{new Date(day+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'})}</strong>
    </span>)}
    {grid.times.map(minutes=><Row key={minutes} minutes={minutes} grid={grid} label={label} onDown={onDown} onEnter={onEnter}/>)}
  </div></div>;
}
function Row({minutes,grid,label,onDown,onEnter}:{
  minutes:number;grid:Grid;
  label:(stamp:number)=>{background:string;title:string};
  onDown?:(stamp:number)=>void;onEnter?:(stamp:number)=>void;
}){
  return <>
    <span className="poll-time">{minutes%60===0?clock(minutes):''}</span>
    {grid.days.map(day=>{
      const stamp=grid.index.get(day+'#'+minutes);
      if(stamp===undefined)return <span className="poll-cell empty" key={day}/>;
      const {background,title}=label(stamp);
      return <button className={'poll-cell'+(onDown?'':' static')} key={day} style={{background}} title={title} aria-label={title}
        onPointerDown={onDown?e=>{e.preventDefault();onDown(stamp)}:undefined}
        onPointerEnter={onEnter?()=>onEnter(stamp):undefined}/>;
    })}
  </>;
}

function NewPoll({friends,onCancel,onCreated}:{friends:Friend[];onCancel:()=>void;onCreated:(id:string)=>void}){
  const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const [title,setTitle]=useState(''),[location,setLocation]=useState(''),[description,setDescription]=useState('');
  const [from,setFrom]=useState(()=>iso(new Date())),[to,setTo]=useState(()=>iso(new Date(Date.now()+6*86400000)));
  const [dayStart,setDayStart]=useState('09:00'),[dayEnd,setDayEnd]=useState('18:00');
  const [duration,setDuration]=useState('60'),[minimum,setMinimum]=useState('2');
  const [invited,setInvited]=useState<string[]>([]),[required,setRequired]=useState<string[]>([]),[saving,setSaving]=useState(false);

  const minutes=(hhmm:string)=>Number(hhmm.slice(0,2))*60+Number(hhmm.slice(3,5));
  const windows=useMemo(()=>dailyWindows(from,to,minutes(dayStart),minutes(dayEnd)),[from,to,dayStart,dayEnd]);
  const span=minutes(dayEnd)-minutes(dayStart);

  async function submit(e:React.FormEvent){
    e.preventDefault();
    if(!title.trim())return toast.info('Give the poll a title.');
    if(!windows.length)return toast.info('Choose a date range with an end time after the start time.');
    if(span<Number(duration))return toast.info(`Each day needs at least ${duration} minutes between the start and end times.`);
    if(Number(minimum)>invited.length+1)return toast.info('The minimum cannot exceed the number of people invited.');
    setSaving(true);
    try{
      const {id}=await api('/api/polls',{title:title.trim(),description:description.trim(),location:location.trim(),
        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',durationMinutes:Number(duration),
        minParticipants:Number(minimum),windows,invitees:invited.map(userId=>({userId,required:required.includes(userId)}))});
      onCreated(id);
    }catch(e){toast.error(message(e))}finally{setSaving(false)}
  }

  return <section className="polls-panel">
    <button className="back-link" onClick={onCancel}><ArrowLeft size={16}/>All polls</button>
    <form className="poll-block event-form" onSubmit={submit}>
      <h3>New poll</h3>
      <label>What are you planning?<input required maxLength={160} placeholder="Dinner, standup, study session" value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Location <small>optional</small><input maxLength={300} placeholder="A place or a meeting link" value={location} onChange={e=>setLocation(e.target.value)}/></label>
      <label>Notes <small>optional</small><textarea maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <div className="form-row">
        <label>First day<input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>Last day<input type="date" required value={to} onChange={e=>setTo(e.target.value)}/></label>
      </div>
      <div className="form-row">
        <label>No earlier than<input type="time" required step={1800} value={dayStart} onChange={e=>setDayStart(e.target.value)}/></label>
        <label>No later than<input type="time" required step={1800} value={dayEnd} onChange={e=>setDayEnd(e.target.value)}/></label>
      </div>
      <div className="form-row">
        <label>How long<Choice label="Meeting duration" value={duration} onChange={setDuration} options={[30,60,90,120].map(x=>({value:String(x),label:`${x} minutes`}))}/></label>
        <label>People needed<Choice label="Minimum attendance" value={minimum} onChange={setMinimum} options={Array.from({length:Math.min(invited.length+1,20)},(_,i)=>({value:String(i+1),label:`${i+1}`}))}/></label>
      </div>
      <p className="help">{windows.length?`${windows.length} ${windows.length===1?'day':'days'} · ${clock(minutes(dayStart))} to ${clock(minutes(dayEnd))} each day`:'Choose a date range of up to 31 days.'}</p>
      <div>
        <label className="field-label">Invite <small>accepted friends only · up to 19</small></label>
        {!friends.length&&<p className="muted">Add a friend first, then you can invite them to a poll.</p>}
        <div className="invite-list">
          {friends.map(f=><div className="invite-row" key={f.user.id}>
            <label>
              <Checkbox checked={invited.includes(f.user.id)} aria-label={`Invite ${f.user.name}`}
                onCheckedChange={v=>setInvited(prev=>v?[...prev,f.user.id].slice(0,19):prev.filter(x=>x!==f.user.id))}/>
              <span>{f.user.name}</span><small>@{f.user.username}</small>
            </label>
            {invited.includes(f.user.id)&&<label className="invite-required">
              <Checkbox checked={required.includes(f.user.id)} aria-label={`${f.user.name} must attend`}
                onCheckedChange={v=>setRequired(prev=>v?[...prev,f.user.id]:prev.filter(x=>x!==f.user.id))}/>
              <small>Must attend</small>
            </label>}
          </div>)}
        </div>
      </div>
      <div className="form-actions">
        <button className="outline" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" type="submit" disabled={saving}>{saving?'Creating…':'Create poll'}</button>
      </div>
    </form>
  </section>;
}
