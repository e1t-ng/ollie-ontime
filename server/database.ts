import './config';
import postgres from 'postgres';
import {drizzle as postgresDrizzle} from 'drizzle-orm/postgres-js';
import {drizzle as localDrizzle} from 'drizzle-orm/pglite';
import type {PgDatabase,PgQueryResultHKT} from 'drizzle-orm/pg-core';
import {PGlite} from '@electric-sql/pglite';
import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import * as schema from '../db/schema';

export type Database=PgDatabase<PgQueryResultHKT,typeof schema>;
export type DatabaseConnection={db:Database;mode:'local'|'tiger';client:PGlite|ReturnType<typeof postgres>;close:()=>Promise<void>};

export async function connectDatabase():Promise<DatabaseConnection>{
  if(process.env.DATABASE_MODE!=='local'&&process.env.DATABASE_URL){
    const client=postgres(process.env.DATABASE_URL,{prepare:false,max:5,connect_timeout:10,idle_timeout:20});
    return {db:postgresDrizzle(client,{schema}) as Database,mode:'tiger',client,close:()=>client.end()};
  }
  if(process.env.DATABASE_MODE==='tiger'||process.env.NODE_ENV==='production')throw new Error('DATABASE_URL is required for Tiger Data/production.');
  const dataPath=resolve(process.env.LOCAL_DATABASE_PATH||'.ontime/data');
  await mkdir(dirname(dataPath),{recursive:true});
  const client=new PGlite(dataPath);
  await client.waitReady;
  return {db:localDrizzle(client,{schema}) as Database,mode:'local',client,close:()=>client.close()};
}

export async function migrateDatabase(connection:DatabaseConnection){
  const options={migrationsFolder:'./drizzle'};
  if(connection.mode==='local'){
    const {migrate}=await import('drizzle-orm/pglite/migrator');
    await migrate(connection.db as unknown as ReturnType<typeof localDrizzle>,options);
  }else{
    const {migrate}=await import('drizzle-orm/postgres-js/migrator');
    await migrate(connection.db as unknown as ReturnType<typeof postgresDrizzle>,options);
  }
}
