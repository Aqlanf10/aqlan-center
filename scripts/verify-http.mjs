import './load-env.mjs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgConnection } from '../lib/pgConnection.ts';
import { hashPassword } from '../lib/auth.ts';
const original=process.env.DATABASE_URL;if(!original)throw Error('DATABASE_URL required');
const name=`http_check_${Date.now()}`;const target=new URL(original);target.pathname=`/${name}`;
const admin=new Client(pgConnection(original));await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
process.env.DATABASE_URL=target.toString();process.env.SESSION_SECRET='http-test-only-secret-never-production-2026';
const directory=await mkdtemp(join(tmpdir(),'aqlan-http-'));process.env.DOCUMENTS_DIR=directory;
const db=await import('../lib/db.ts');let server;let logs='';let checks=0;
const check=(label,ok)=>{assert.ok(ok,label);checks++;console.log(`✓ ${label}`);};
try {
  await db.ensureSchema();const password='http-test-password-2026';const passwordHash=await hashPassword(password);
  const owner=await db.createFirstAdmin({username:'admin',displayName:'Test admin',passwordHash});
  await db.createStaffUser({username:'doctor',displayName:'Test doctor',passwordHash,role:'doctor'});
  await db.createStaffUser({username:'reception',displayName:'Test reception',passwordHash,role:'reception'});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{logs=(logs+chunk.toString()).slice(-12000);});
  let ready=false;
  for(let i=0;i<120;i++){
    if(server.exitCode!==null)throw Error(`Server exited: ${logs}`);
    try{if((await fetch(base+'/api/ping')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  if(!ready)throw Error(`Server not ready: ${logs}`);
  const request=(path,cookie='',body,extra={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  const login=async username=>{const r=await request('/api/auth/login','',{username,password});assert.equal(r.status,200,await r.clone().text());return r.headers.getSetCookie()[0].split(';')[0];};
  const a=await login('admin'),d=await login('doctor'),reception=await login('reception');
  check('anonymous patient access denied',(await request('/api/patients')).status===401);
  check('doctor reads procedure catalog',(await request('/api/clinical/catalog',d)).status===200);
  check('doctor cannot change catalog prices',(await request('/api/services/catalog',d,{action:'import'})).status===403);
  check('reception cannot change catalog prices',(await request('/api/services/catalog',reception,{action:'import'})).status===403);
  check('cross-site mutation rejected',(await request('/api/services/catalog',a,{action:'import'},{origin:'https://untrusted.example','sec-fetch-site':'cross-site'})).status===403);
  check('admin imports catalog',(await request('/api/services/catalog',a,{action:'import'},{origin:base})).status===200);
  const catalog=await (await request('/api/clinical/catalog',d)).json();check('no commission fields in clinical catalog',catalog.doctors.every(p=>Object.keys(p).every(k=>['id','name'].includes(k))));
  const security=await request('/login');check('security headers present',security.headers.get('x-content-type-options')==='nosniff'&&security.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"));
  check('doctor cannot export database',(await request('/api/backup/full',d)).status===403);
  const backup=await request('/api/backup/full',a);check('admin full backup streams successfully',backup.ok&&(await backup.arrayBuffer()).byteLength>100);
  for(let i=0;i<10;i++)await request('/api/auth/login','',{username:'unknown-test',password:'wrong'});
  const limited=await request('/api/auth/login','',{username:'unknown-test',password:'wrong'});
  check('HTTP login rate limit with Retry-After',limited.status===429&&Number(limited.headers.get('retry-after'))>0);
  await db.updateUser(owner.id,{isActive:false});
  check('disabled account token rejected immediately',(await request('/api/patients',a)).status===401);
  check('revoked cookie can reach login without redirect loop',(await request('/login',a)).status===200);
  console.log(`${checks} HTTP checks passed.`);
}catch(e){console.error(logs);throw e;}finally{
  if(server&&server.exitCode===null){server.kill();await Promise.race([once(server,'exit'),new Promise(r=>setTimeout(r,5000))]);}
  // Normal DROP waits for closing pool connections without killing them.
  await db.getPool().end();await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();
  if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe test path');
  await rm(directory,{recursive:true,force:true});
}
