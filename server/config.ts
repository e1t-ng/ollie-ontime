import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {resolve} from 'node:path';

// Existing process environment wins. Never print database URLs or credentials.
for(const file of ['.env.local','.env','.dev.vars']){
  if(existsSync(resolve(file)))loadEnvFile(resolve(file));
}

export type GoogleConfig={clientId:string;clientSecret:string;redirectUri:string};

// The browser reaches the API through the frontend origin, so Google must redirect
// back to that origin; the frontend forwards /api/* to this process.
export function googleConfig(appOrigin:string):GoogleConfig|null{
  const clientId=process.env.GOOGLE_CLIENT_ID?.trim(),clientSecret=process.env.GOOGLE_CLIENT_SECRET?.trim();
  if(!clientId||!clientSecret)return null;
  const redirectUri=process.env.GOOGLE_REDIRECT_URI?.trim()||appOrigin+'/api/auth/google/callback';
  return {clientId,clientSecret,redirectUri};
}

export function config(){
  const origins=(process.env.APP_ORIGIN||'http://localhost:5173,http://127.0.0.1:5173').split(',').map(x=>new URL(x.trim()).origin);
  if(process.env.NODE_ENV==='production'&&origins.some(x=>!x.startsWith('https://')))throw new Error('Production APP_ORIGIN must use HTTPS.');
  return {origins,appOrigin:origins[0],google:googleConfig(origins[0]),ticketmasterKey:process.env.TICKETMASTER_API_KEY?.trim()||undefined,secureCookies:origins.every(x=>x.startsWith('https://')),port:Number(process.env.API_PORT||process.env.PORT||3001)};
}
