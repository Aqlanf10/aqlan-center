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
  check('reception cannot create individual service',(await request('/api/services',reception,{name:'Forbidden test service',price:'100'})).status===403);
  check('doctor cannot create individual service',(await request('/api/services',d,{name:'Forbidden test service',price:'100'})).status===403);
  const edit=await fetch(base+`/api/services/${catalog.services[0].id}`,{method:'PATCH',headers:{cookie:reception,'content-type':'application/json'},body:JSON.stringify({price:'1'})});
  check('reception cannot edit individual service price',edit.status===403);
  const security=await request('/login');check('security headers present',security.headers.get('x-content-type-options')==='nosniff'&&security.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"));
  check('doctor cannot export database',(await request('/api/backup/full',d)).status===403);
  const backup=await request('/api/backup/full',a);check('admin full backup streams successfully',backup.ok&&(await backup.arrayBuffer()).byteLength>100);
  check('doctor cannot create inventory item',(await request('/api/inventory',d,{name:'Forbidden item',unit:'box'},{origin:base})).status===403);
  const madeItem=await request('/api/inventory',a,{name:'Gloves M',category:'consumable',unit:'box',minLevel:2},{origin:base});
  check('admin creates inventory item',madeItem.status===201);
  const inventoryId=(await madeItem.json()).id;
  check('doctor records a stock-in — the guard is on what is recorded, not who records it',(await request(`/api/inventory/${inventoryId}/movements`,d,{kind:'in',qty:3},{origin:base})).status===201);
  check('doctor cannot dispense more than the balance',(await request(`/api/inventory/${inventoryId}/movements`,d,{kind:'out',qty:99},{origin:base})).status===409);
  check('doctor cannot adjust stock without a written reason',(await request(`/api/inventory/${inventoryId}/movements`,d,{kind:'adjust',qty:-1},{origin:base})).status===409);
  const stop=await fetch(base+`/api/inventory/${inventoryId}`,{method:'PATCH',headers:{cookie:d,'content-type':'application/json',origin:base},body:JSON.stringify({isActive:false})});
  check('doctor cannot deactivate an inventory item',stop.status===403);
  // ── بوابة المريض: معزولة في الاتجاهين ──
  const portalPatient=await db.createPatient({fullName:'مريضة البوابة',phone:'770445566',altPhone:null,gender:'female',birthYear:2000,address:null,medicalAlert:null,note:null});
  for(const path of ['/api/portal/me','/api/portal/appointments','/api/portal/statement'])
    check(`portal ${path} denied without a portal session`,(await request(path)).status===401);
  check('portal statement rejects a staff cookie — one session never opens the other',(await request('/api/portal/statement',a)).status===401);
  check('portal login rejects a wrong file number',(await request('/api/portal/login','',{phone:'770445566',patientNumber:'P-NOPE'},{origin:base})).status===401);
  check('portal login rejects a wrong phone for a real file',(await request('/api/portal/login','',{phone:'770000000',patientNumber:portalPatient.patientNumber},{origin:base})).status===401);
  const portalIn=await request('/api/portal/login','',{phone:'770445566',patientNumber:portalPatient.patientNumber},{origin:base});
  check('portal login accepts the pair the patient owns',portalIn.status===200);
  const portalCookie=portalIn.headers.getSetCookie()[0].split(';')[0];
  check('portal cookie has its own name — not the staff cookie',portalCookie.startsWith('aqlan_portal_session='));
  check('portal reads its own statement',(await request('/api/portal/statement',portalCookie)).status===200);
  check('but a portal cookie opens no staff route',(await request('/api/patients',portalCookie)).status===401);
  check('and cannot read another patient ledger',(await request(`/api/patients/${owner.id}/ledger`,portalCookie)).status===401);
  const otherPatient=await db.createPatient({fullName:'مريض آخر',phone:'770777888',altPhone:null,gender:'male',birthYear:1990,address:null,medicalAlert:null,note:null});
  const otherAppointment=await db.createAppointment({patientId:otherPatient.id,date:new Date(Date.now()+86400000).toISOString().slice(0,10),time:'10:00',durationMinutes:30,note:null});
  check('portal intake denied without a portal session',(await request('/api/portal/intake')).status===401);
  const firstIntake=await request('/api/portal/intake',portalCookie,{conditions:['diabetes'],allergies:'البنسلين'},{origin:base});
  check('patient submits an intake form',firstIntake.status===201);
  await request('/api/portal/intake',portalCookie,{conditions:['diabetes','bleeding']},{origin:base});
  const history=await (await request(`/api/patients/${portalPatient.id}/intake`,a)).json();
  check('every submission is kept — health changes over time and when it changed is the question',history.intake.length===2);
  check('and the newest is first',history.intake[0].conditions.length===2);
  const alertAfter=await db.getPatient(portalPatient.id);
  check("intake never writes the clinical alert — the patient's word is not the doctor's",!alertAfter.medicalAlert);
  check('unknown condition keys are refused, not silently dropped',(await request('/api/portal/intake',portalCookie,{conditions:['not-a-key']},{origin:base})).status===400);
  check("confirming another patient's appointment is refused",(await request('/api/portal/appointments/confirm',portalCookie,{appointmentId:otherAppointment.id},{origin:base})).status===404);
  check('doctor cannot open the command room',(await request('/api/executive',d)).status===403);
  check('reception cannot open the command room either',(await request('/api/executive',reception)).status===403);
  check('and admin can',(await request('/api/executive',a)).status===200);
  // ── التثبيت على الجهاز: ملفاته تُطلب قبل الدخول وبلا كوكي ──
  const manifest=await request('/manifest.webmanifest');
  check('manifest served without a session — the browser asks for it before anyone logs in',manifest.status===200);
  const manifestBody=await manifest.json();
  check('manifest names the icons Android asks for',['192x192','512x512'].every(size=>manifestBody.icons.some(icon=>icon.sizes===size))&&manifestBody.icons.some(icon=>icon.purpose==='maskable'));
  check('manifest opens the app full screen at the day screen',manifestBody.display==='standalone'&&manifestBody.start_url==='/'&&manifestBody.dir==='rtl');
  await db.saveSettings({'clinic.name':'مركز التجربة للتقويم'});
  // ذاكرة الإعدادات تعيش خمس ثوانٍ داخل عملية الخادم — وهي عملية أخرى لا يُبطلها
  // حفظُنا هنا. فيُنتظر انقضاؤها لا أكثر: الاسم يتغيّر بلا نشرة جديدة، وهذا المقصود.
  let renamed=null;
  for(let i=0;i<40;i++){renamed=await (await request('/manifest.webmanifest')).json();if(renamed.name==='مركز التجربة للتقويم')break;await new Promise(r=>setTimeout(r,250));}
  check('the installed name follows the settings screen, not the build',renamed.name==='مركز التجربة للتقويم');
  await db.saveSettings({'clinic.name':'مركز الدكتور عقلان الكامل لتقويم وزراعة وتجميل الأسنان'});
  const worker=await request('/sw.js');
  const workerBody=await worker.text();
  check('service worker served from the root — its scope is the whole app',worker.status===200&&(worker.headers.get('content-type')??'').includes('javascript'));
  check('and it is the reviewed policy, not a redirect page',workerBody.includes('function shouldCache(pathname)'));
  check('offline page reachable without a session — it is precached before anyone logs in',(await request('/offline.html')).status===200);
  const iconResponse=await request('/icons/icon-192.png');
  check('install icon served without a session',iconResponse.status===200);
  check('and it is a real PNG',Buffer.from(await iconResponse.arrayBuffer()).subarray(0,8).toString('hex')==='89504e470d0a1a0a');
  check('opening the install files opened nothing else — a patient page still redirects',(await request('/patients')).status===307);
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
