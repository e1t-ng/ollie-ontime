'use client';
import {useState} from 'react';
import {CalendarPlus,ExternalLink,LocateFixed,MapPin,Search} from 'lucide-react';
import {api} from './ontime-dialogs';

export type DiscoveredEvent={
  id:string;name:string;url:string|null;imageUrl:string|null;category:string|null;genre:string|null;
  start:{dateTime:string|null;localDate:string|null;localTime:string|null;timeZone:string|null};
  venue:{name:string|null;city:string|null;state:string|null}|null;
  price:{currency:string|null;min:number|null;max:number|null}|null;
};

type Props={profile:{homeCity?:string;locationSharing?:string};onAdd:(event:DiscoveredEvent)=>void};

function when(event:DiscoveredEvent){
  const value=event.start.dateTime||(event.start.localDate?event.start.localDate+'T12:00:00':'');
  if(!value)return 'Date to be announced';
  const date=new Date(value);
  return Number.isFinite(+date)?date.toLocaleString([],{weekday:'short',month:'short',day:'numeric',...(event.start.dateTime?{hour:'numeric',minute:'2-digit'}:{})}):'Date to be announced';
}
function place(event:DiscoveredEvent){return [event.venue?.name,event.venue?.city,event.venue?.state].filter(Boolean).join(', ')||'Venue to be announced'}
function message(error:unknown){return error instanceof Error?error.message:'Please try again.'}

export function DiscoveryPanel({profile,onAdd}:Props){
  const [city,setCity]=useState(profile.homeCity||''),[keyword,setKeyword]=useState('');
  const [events,setEvents]=useState<DiscoveredEvent[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false);

  async function search(params:URLSearchParams){
    setLoading(true);setError('');setSearched(true);
    if(keyword.trim())params.set('keyword',keyword.trim());
    params.set('size','18');
    try{const data=await api('/api/discover/events?'+params);setEvents(data.events||[])}
    catch(e){setEvents([]);setError(message(e))}finally{setLoading(false)}
  }
  function searchCity(e:React.FormEvent){e.preventDefault();if(!city.trim()){setError('Enter a city or use your current location.');return}search(new URLSearchParams({city:city.trim()}))}
  function searchNearby(){
    if(profile.locationSharing==='never'){setError('Change Location preference in your profile before using device location. You can still search by city.');return}
    if(!navigator.geolocation){setError('This browser does not support location. Search by city instead.');return}
    setLoading(true);setError('');
    navigator.geolocation.getCurrentPosition(
      position=>search(new URLSearchParams({latitude:String(position.coords.latitude),longitude:String(position.coords.longitude)})),
      ()=>{setLoading(false);setError('Location was not available. Search by city instead.')},
      {enableHighAccuracy:false,timeout:8000,maximumAge:300000}
    );
  }

  return <section className="discovery-panel">
    <form className="discovery-search" onSubmit={searchCity}>
      <label><span>City</span><input value={city} onChange={e=>setCity(e.target.value)} maxLength={100} placeholder="Chicago, IL"/></label>
      <label><span>What sounds good? <small>optional</small></span><input value={keyword} onChange={e=>setKeyword(e.target.value)} maxLength={80} placeholder="concert, comedy, baseball"/></label>
      <button className="primary" disabled={loading} type="submit"><Search size={17}/>{loading?'Searching…':'Search events'}</button>
      <button className="outline" disabled={loading} type="button" onClick={searchNearby}><LocateFixed size={17}/>Use my location</button>
    </form>
    <p className="discovery-privacy">Precise location is sent only for this search. OnTime stores your location preference and home city, not device coordinates.</p>
    {error&&<div className="notice" role="alert">{error}</div>}
    {!loading&&searched&&!error&&!events.length&&<div className="notice">No matching events were found. Try a broader keyword or nearby city.</div>}
    <div className="event-discovery-grid">
      {events.map(event=><article className="discovery-card" key={event.id}>
        {event.imageUrl&&<div className="discovery-image" style={{backgroundImage:`url(${event.imageUrl})`}} role="img" aria-label=""/>}
        <div className="discovery-copy">
          <span className="discovery-category">{event.genre||event.category||'Local event'}</span>
          <h2>{event.name}</h2>
          <p><strong>{when(event)}</strong></p>
          <p><MapPin size={14}/>{place(event)}</p>
          <div className="discovery-actions">
            <button className="primary small" type="button" disabled={!event.start.dateTime&&!event.start.localDate} onClick={()=>onAdd(event)}><CalendarPlus size={16}/>Add to OnTime</button>
            {event.url&&<a className="outline" href={event.url} target="_blank" rel="noreferrer">Tickets <ExternalLink size={14}/></a>}
          </div>
        </div>
      </article>)}
    </div>
    {events.length>0&&<p className="discovery-source">Event information provided by Ticketmaster.</p>}
  </section>;
}
