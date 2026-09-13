// Grid maths for the poll screen, kept out of the component so it can be tested on its
// own. The server is strict about what availability it accepts — blocks sorted, never
// overlapping, each inside a poll window, at most 500 — so `toBlocks` has to hold to it.
export type PollWindow={start:string;end:string};
export type Block={start:string;end:string;status:string};

export const CELL=30*60000;
export const dayKey=(t:number)=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const minuteOf=(t:number)=>{const d=new Date(t);return d.getHours()*60+d.getMinutes()};
export const clock=(m:number)=>`${(Math.floor(m/60)%12)||12}:${String(m%60).padStart(2,'0')} ${Math.floor(m/60)>=12?'PM':'AM'}`;
export const isoAt=(date:string,minutes:number)=>{const [y,m,d]=date.split('-').map(Number);return new Date(y,m-1,d,Math.floor(minutes/60),minutes%60).toISOString()};

// The poll's windows are the only truth about which cells exist, so an irregular poll
// (one day ending early, say) leaves real gaps in the grid rather than faking them.
export function buildGrid(windows:PollWindow[]){
  const stamps:number[]=[];
  for(const w of windows){const end=Date.parse(w.end);for(let t=Date.parse(w.start);t+CELL<=end;t+=CELL)stamps.push(t)}
  const index=new Map<string,number>();
  for(const t of stamps)index.set(dayKey(t)+'#'+minuteOf(t),t);
  return {days:[...new Set(stamps.map(dayKey))].sort(),times:[...new Set(stamps.map(minuteOf))].sort((a,b)=>a-b),index};
}
export type Grid=ReturnType<typeof buildGrid>;

export function fromBlocks(blocks:Block[]){
  const map=new Map<number,string>();
  for(const b of blocks){const end=Date.parse(b.end);for(let t=Date.parse(b.start);t<end;t+=CELL)map.set(t,b.status)}
  return map;
}

// Contiguous cells sharing a status collapse into one block, which keeps a painted week
// far under the server's ceiling. Merging stops at a window edge: the server requires
// every block to sit inside one window, so a run across two abutting days must not join
// into a block that belongs to neither. Cells outside every window are dropped for the
// same reason — they would be refused rather than saved.
export function toBlocks(paint:Map<number,string>,windows:PollWindow[]):Block[]{
  const bounds=windows.map(w=>[Date.parse(w.start),Date.parse(w.end)] as const);
  const windowOf=(t:number)=>bounds.findIndex(([start,end])=>t>=start&&t<end);
  const blocks:Block[]=[];
  let previous=-1;
  for(const [t,status] of [...paint.entries()].sort((a,b)=>a[0]-b[0])){
    const current=windowOf(t);
    if(current===-1)continue;
    const last=blocks[blocks.length-1];
    if(last&&current===previous&&last.status===status&&Date.parse(last.end)===t)last.end=new Date(t+CELL).toISOString();
    else blocks.push({start:new Date(t).toISOString(),end:new Date(t+CELL).toISOString(),status});
    previous=current;
  }
  return blocks;
}

// Days between two YYYY-MM-DD dates, each given the same daily window. One window per
// day never overlaps the next, which is what the server requires.
export function dailyWindows(from:string,to:string,startMinutes:number,endMinutes:number,limit=31):PollWindow[]{
  const list:PollWindow[]=[];
  const first=new Date(from+'T12:00:00'),last=new Date(to+'T12:00:00');
  if(!Number.isFinite(+first)||!Number.isFinite(+last)||last<first||endMinutes<=startMinutes)return list;
  for(const d=new Date(first);d<=last&&list.length<limit;d.setDate(d.getDate()+1)){
    const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    list.push({start:isoAt(day,startMinutes),end:isoAt(day,endMinutes)});
  }
  return list;
}
