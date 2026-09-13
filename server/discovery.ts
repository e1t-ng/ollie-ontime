import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {profiles} from '../db/schema';
import type {User} from './auth';
import type {Database} from './database';
import {ApiError,ensure,json} from './http';

type TicketmasterImage={url?:string;ratio?:string;width?:number;height?:number};
type TicketmasterVenue={name?:string;city?:{name?:string};state?:{name?:string;stateCode?:string};country?:{name?:string;countryCode?:string};address?:{line1?:string};location?:{latitude?:string;longitude?:string}};
type TicketmasterEvent={id?:string;name?:string;url?:string;info?:string;pleaseNote?:string;distance?:number;units?:string;images?:TicketmasterImage[];dates?:{timezone?:string;status?:{code?:string};start?:{dateTime?:string;localDate?:string;localTime?:string;dateTBD?:boolean;dateTBA?:boolean;timeTBA?:boolean}};classifications?:Array<{primary?:boolean;segment?:{name?:string};genre?:{name?:string};subGenre?:{name?:string}}> ;priceRanges?:Array<{type?:string;currency?:string;min?:number;max?:number}>;_embedded?:{venues?:TicketmasterVenue[]}};
type TicketmasterResponse={_embedded?:{events?:TicketmasterEvent[]};page?:{size?:number;totalElements?:number;totalPages?:number;number?:number};fault?:unknown};

const querySchema=z.object({
  latitude:z.coerce.number().min(-90).max(90).optional(),longitude:z.coerce.number().min(-180).max(180).optional(),
  city:z.string().trim().min(1).max(100).optional(),postalCode:z.string().trim().min(1).max(20).optional(),
  radius:z.coerce.number().int().min(1).max(100).default(25),unit:z.enum(['miles','km']).default('miles'),
  keyword:z.string().trim().max(80).optional(),category:z.string().trim().max(80).optional(),
  start:z.string().datetime({offset:true}).optional(),end:z.string().datetime({offset:true}).optional(),
  size:z.coerce.number().int().min(1).max(50).default(20),page:z.coerce.number().int().min(0).max(19).default(0),
}).superRefine((value,ctx)=>{
  if((value.latitude===undefined)!==(value.longitude===undefined))ctx.addIssue({code:'custom',message:'Provide both latitude and longitude.'});
  if(value.latitude===undefined&&!value.city&&!value.postalCode)ctx.addIssue({code:'custom',message:'Provide your location or search by city.'});
  if(value.start&&value.end&&Date.parse(value.end)<=Date.parse(value.start))ctx.addIssue({code:'custom',message:'End must follow start.'});
});

const BASE='https://app.ticketmaster.com/discovery/v2/events.json';
const cache=new Map<string,{expires:number,value:unknown}>();

// Ticketmaster recommends geoPoint over its deprecated latlong parameter.
export function geohash(latitude:number,longitude:number,precision=7){
  const alphabet='0123456789bcdefghjkmnpqrstuvwxyz',lat=[-90,90],lon=[-180,180];let even=true,bits=0,value=0,result='';
  while(result.length<precision){
    const range=even?lon:lat,coordinate=even?longitude:latitude,mid=(range[0]+range[1])/2;
    if(coordinate>=mid){value=value*2+1;range[0]=mid}else{value*=2;range[1]=mid}
    even=!even;if(++bits===5){result+=alphabet[value];bits=0;value=0}
  }
  return result;
}

// The UI accepts the familiar "City, ST" form, while Ticketmaster expects the
// city and two-letter state code as separate parameters.
export function cityFilter(value:string){
  const parts=value.split(',').map(part=>part.trim()).filter(Boolean),last=parts.at(-1)??'';
  const hasState=parts.length>1&&/^[a-z]{2}$/i.test(last);
  return {city:(hasState?parts.slice(0,-1):parts).join(', '),stateCode:hasState?last.toUpperCase():undefined};
}
export function ticketmasterDate(value:string|number|Date){
  return new Date(value).toISOString().replace(/\.\d{3}Z$/,'Z');
}

function bestImage(images:TicketmasterImage[]=[]){
  return [...images].filter(image=>image.url?.startsWith('https://')).sort((a,b)=>Number(b.ratio==='16_9')-Number(a.ratio==='16_9')||(b.width??0)-(a.width??0))[0]?.url??null;
}
export function normalizeTicketmasterEvent(event:TicketmasterEvent){
  const venue=event._embedded?.venues?.[0],classification=event.classifications?.find(item=>item.primary)??event.classifications?.[0],start=event.dates?.start;
  return {id:event.id??'',name:event.name??'Untitled event',url:event.url??null,imageUrl:bestImage(event.images),
    start:{dateTime:start?.dateTime??null,localDate:start?.localDate??null,localTime:start?.localTime??null,dateTBD:!!start?.dateTBD,dateTBA:!!start?.dateTBA,timeTBA:!!start?.timeTBA,timeZone:event.dates?.timezone??null},
    status:event.dates?.status?.code??null,distance:typeof event.distance==='number'?event.distance:null,distanceUnit:event.units??null,
    category:classification?.segment?.name??null,genre:classification?.genre?.name??null,subGenre:classification?.subGenre?.name??null,
    venue:venue?{name:venue.name??null,address:venue.address?.line1??null,city:venue.city?.name??null,state:venue.state?.stateCode??venue.state?.name??null,country:venue.country?.countryCode??venue.country?.name??null,latitude:venue.location?.latitude?Number(venue.location.latitude):null,longitude:venue.location?.longitude?Number(venue.location.longitude):null}:null,
    price:event.priceRanges?.[0]?{currency:event.priceRanges[0].currency??null,min:event.priceRanges[0].min??null,max:event.priceRanges[0].max??null}:null,
  };
}

export async function discoveryRoute(request:Request,db:Database,user:User,path:string,ticketmasterKey:string|undefined,fetcher:typeof fetch=fetch):Promise<Response|undefined>{
  if(path!=='/api/discover/events'||request.method!=='GET')return;
  ensure(ticketmasterKey,503,'Nearby event discovery is not configured.');
  const raw=Object.fromEntries(new URL(request.url).searchParams),input=querySchema.parse(raw);
  if(input.latitude!==undefined){
    const [profile]=await db.select({locationSharing:profiles.locationSharing}).from(profiles).where(eq(profiles.owner,user.id));
    ensure(profile?.locationSharing==='while_using'||profile?.locationSharing==='always',403,'Enable location use in your profile or search by city.');
  }
  const params=new URLSearchParams({apikey:ticketmasterKey,size:String(input.size),page:String(input.page),radius:String(input.radius),unit:input.unit,sort:input.latitude===undefined?'date,asc':'distance,date,asc',includeTBA:'no',includeTBD:'no'});
  if(input.latitude!==undefined)params.set('geoPoint',geohash(input.latitude,input.longitude!));
  if(input.city){const location=cityFilter(input.city);params.set('city',location.city);if(location.stateCode)params.set('stateCode',location.stateCode)}if(input.postalCode)params.set('postalCode',input.postalCode);
  if(input.keyword)params.set('keyword',input.keyword);if(input.category)params.set('classificationName',input.category);
  const start=input.start??new Date().toISOString();const end=input.end??new Date(Date.now()+90*86400000).toISOString();
  params.set('startDateTime',ticketmasterDate(start));params.set('endDateTime',ticketmasterDate(end));
  const cacheKey=params.toString().replace(/(?:^|&)apikey=[^&]*/,'');const cached=cache.get(cacheKey);
  if(cached&&cached.expires>Date.now())return json(cached.value,200,{'Cache-Control':'private, max-age=300'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  let upstream:Response;
  try{upstream=await fetcher(`${BASE}?${params}`,{signal:controller.signal,headers:{Accept:'application/json'}})}
  catch{throw new ApiError(502,'Nearby events are temporarily unavailable.')}
  finally{clearTimeout(timeout)}
  if(upstream.status===401||upstream.status===403)throw new ApiError(503,'Nearby event discovery is not configured correctly.');
  if(upstream.status===429)throw new ApiError(503,'Nearby event search is temporarily at capacity.');
  if(upstream.status===400)throw new ApiError(400,'Ticketmaster could not recognize that location. Try a city and two-letter state, such as Chicago, IL.');
  if(!upstream.ok)throw new ApiError(502,'Nearby events are temporarily unavailable.');
  const data=await upstream.json() as TicketmasterResponse;
  const value={events:(data._embedded?.events??[]).filter(event=>event.id).map(normalizeTicketmasterEvent),page:{number:data.page?.number??input.page,size:data.page?.size??input.size,totalElements:data.page?.totalElements??0,totalPages:data.page?.totalPages??0},source:'Ticketmaster'};
  if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(cacheKey,{expires:Date.now()+300000,value});
  return json(value,200,{'Cache-Control':'private, max-age=300'});
}
