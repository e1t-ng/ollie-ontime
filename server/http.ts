import {z} from 'zod';

export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export function ensure(condition:unknown,status:number,message:string):asserts condition{if(!condition)throw new ApiError(status,message)}
export function json(value:unknown,status=200,headers:Record<string,string>={}){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
// Node keeps one value per header name, so Object.fromEntries would silently drop every
// Set-Cookie but the last. The Google callback returns the new session alongside the
// handshake cleanup, so collapsing them signs the browser straight back out.
export function nodeHeaders(response:Response):Record<string,string|string[]>{
  const headers:Record<string,string|string[]>={};
  for(const [name,value] of response.headers)if(name!=='set-cookie')headers[name]=value;
  const cookies=response.headers.getSetCookie();
  if(cookies.length)headers['set-cookie']=cookies;
  return headers;
}
export async function body<T extends z.ZodTypeAny>(request:Request,schema:T):Promise<z.infer<T>>{
  ensure(request.headers.get('content-type')?.split(';')[0]==='application/json',415,'Use application/json.');
  const raw=await request.text();ensure(raw.length<=2_000_000,413,'Request too large.');
  let data:unknown;try{data=JSON.parse(raw)}catch{throw new ApiError(400,'Invalid JSON.')}
  return schema.parse(data);
}
export const id=z.string().uuid();
export const instant=z.string().datetime({offset:true});
export const timeZone=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}},'Use an IANA time zone, such as America/Chicago.');
export const username=z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/,'Username must be 3–30 letters, numbers, or underscores.');
export const birthday=z.string().refine(value=>{
  if(!value)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value&&+d<=Date.now();
},'Use a valid birthday that is not in the future.');
