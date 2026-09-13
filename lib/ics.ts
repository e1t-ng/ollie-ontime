import ICAL from 'ical.js';
import type {CalEvent} from './calendar';
import {localDate} from './calendar';
export function parseICS(text:string,calendar:string){
 if(text.length>2000000)throw new Error('Choose an ICS file smaller than 2 MB.');
 const root=new ICAL.Component(ICAL.parse(text));if(root.name!=='vcalendar')throw new Error('This is not an iCalendar file.');
 for(const tz of root.getAllSubcomponents('vtimezone'))ICAL.TimezoneService.register(new ICAL.Timezone(tz));
 const rows:Omit<CalEvent,'id'>[]=[];const now=new Date();const floor=new Date(now.getFullYear()-1,now.getMonth(),now.getDate());const horizon=new Date(now.getFullYear()+1,now.getMonth(),now.getDate());let recurring=false;
 for(const c of root.getAllSubcomponents('vevent')){
  for(const field of ['dtstart','dtend']){const tz=c.getFirstProperty(field)?.getParameter('tzid');if(tz&&typeof tz==='string'&&!ICAL.TimezoneService.has(tz))throw new Error(`The file uses ${tz} without a timezone definition. Export it with VTIMEZONE data or in UTC.`);}
  const event=new ICAL.Event(c);if(event.isRecurrenceException())continue;
  if(!c.hasProperty('dtstart'))throw new Error('An event is missing its start date.');
  if(c.getFirstPropertyValue('status')==='CANCELLED'||c.getFirstPropertyValue('transp')==='TRANSPARENT')continue;
  const push=(start:any,end:any,item:any)=>{if(item.component.getFirstPropertyValue('status')==='CANCELLED')return;const s=start.toJSDate(),e=end.toJSDate();if(+e<=+s){e.setTime(+s+(start.isDate?86400000:3600000));}rows.push({calendar,title:(item.summary||'Untitled event').slice(0,160),start:s.toISOString(),end:e.toISOString(),allDay:!!start.isDate,location:(item.location||'').slice(0,300),notes:(item.description||'').slice(0,2000),invitees:''});if(rows.length>500)throw new Error('This file contains more than 500 events. Export a smaller date range.');};
  if(event.isRecurring()){recurring=true;const iter=event.iterator();let steps=0;let occurrence;while((occurrence=iter.next())){if(++steps>20000)throw new Error('This recurrence is too large. Export a smaller date range.');if(occurrence.toJSDate()>horizon)break;const details=event.getOccurrenceDetails(occurrence);if(details.endDate.toJSDate()>=floor)push(details.startDate,details.endDate,details.item);}}
  else push(event.startDate,event.endDate,event);
 }
 if(!rows.length)throw new Error('No busy events were found in this file.');
 return {events:rows,notice:recurring?`Repeating events are expanded from ${localDate(floor)} through ${localDate(horizon)}. Re-import to extend this range.`:null};
}
export function exportICS(events:CalEvent[]){const cal=new ICAL.Component(['vcalendar',[],[]]);cal.updatePropertyWithValue('version','2.0');cal.updatePropertyWithValue('prodid','-//OnTime//Calendar//EN');for(const row of events){const c=new ICAL.Component('vevent');const e=new ICAL.Event(c);e.uid=row.id+'@ontime';e.summary=row.title;e.description=row.notes;e.location=row.location;if(row.allDay){e.startDate=ICAL.Time.fromDateString(localDate(new Date(row.start)));e.endDate=ICAL.Time.fromDateString(localDate(new Date(row.end)));}else{e.startDate=ICAL.Time.fromJSDate(new Date(row.start),true);e.endDate=ICAL.Time.fromJSDate(new Date(row.end),true);}c.updatePropertyWithValue('dtstamp',ICAL.Time.now());cal.addSubcomponent(c);}return cal.toString();}
