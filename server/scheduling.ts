export type Range={start:string;end:string};
export type Availability=Range&{userId:string;status:string};
export type Busy=Range&{userId:string};
export type Member={userId:string;required:boolean};
export type Schedule={windows:Range[];durationMinutes:number;minParticipants:number};
const weights:Record<string,number>={unavailable:0,maybe:1,available:2,preferred:3};
const labels=['unavailable','maybe','available','preferred'];

// Gaps are unknown, even if the participant submitted another part of the poll.
export function availabilityAt(start:number,end:number,blocks:Availability[],busy:Busy[]){
  if(busy.some(b=>Date.parse(b.start)<end&&Date.parse(b.end)>start))return 'busy';
  let covered=start,score=3;
  for(const b of [...blocks].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))){
    const a=Date.parse(b.start),z=Date.parse(b.end);
    if(z<=covered||a>=end)continue;
    if(a>covered)return 'unknown';
    score=Math.min(score,weights[b.status]??0);covered=Math.max(covered,z);
    if(covered>=end)return labels[score];
  }
  return 'unknown';
}
export function rankSlots(poll:Schedule,members:Member[],blocks:Availability[],busy:Busy[]){
  const slots=[];const seen=new Set<number>();
  for(const window of poll.windows){
    const end=Date.parse(window.end),duration=poll.durationMinutes*60000;
    for(let start=Date.parse(window.start);start+duration<=end;start+=15*60000){
      if(seen.has(start))continue;seen.add(start);
      const participants=members.map(m=>({...m,status:availabilityAt(start,start+duration,blocks.filter(b=>b.userId===m.userId),busy.filter(b=>b.userId===m.userId))}));
      const available=participants.filter(p=>['available','preferred'].includes(p.status)).length;
      const preferred=participants.filter(p=>p.status==='preferred').length;
      const maybe=participants.filter(p=>p.status==='maybe').length;
      const qualified=available>=poll.minParticipants&&participants.every(p=>!p.required||['available','preferred'].includes(p.status));
      slots.push({start:new Date(start).toISOString(),end:new Date(start+duration).toISOString(),qualified,available,preferred,maybe,participants});
    }
  }
  return slots.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||b.available-a.available||b.preferred-a.preferred||b.maybe-a.maybe||a.start.localeCompare(b.start));
}
