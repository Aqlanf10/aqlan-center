import './load-env.mjs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgConnection } from '../lib/pgConnection.ts';
import { hashPassword } from '../lib/auth.ts';
import { addDays, clinicDateString } from '../lib/schedule.ts';
import { PROVISIONAL_PRICES } from '../lib/provisionalPrices.ts';
import { LAB_WORK_CATALOG } from '../lib/labWorkCatalog.ts';
import { CLINIC_ZONE_FALLBACK } from '../lib/clinicZone.ts';
const original=process.env.DATABASE_URL;if(!original)throw Error('DATABASE_URL required');
const name=`http_check_${Date.now()}`;const target=new URL(original);target.pathname=`/${name}`;
const admin=new Client(pgConnection(original));await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
process.env.DATABASE_URL=target.toString();process.env.SESSION_SECRET='http-test-only-secret-never-production-2026';
const directory=await mkdtemp(join(tmpdir(),'aqlan-http-'));process.env.DOCUMENTS_DIR=directory;
const db=await import('../lib/db.ts');let server;let logs='';let checks=0;
const check=(label,ok,extra='')=>{assert.ok(ok,extra?`${label} — ${extra}`:label);checks++;console.log(`✓ ${label}`);};
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

  /*
   * ── نسخةٌ بُدئت ليست نسخةً أُخذت ──
   *
   * وموضع هذا الفحص هنا مقصود: **قبل أن تنجح نسخةٌ واحدة في هذه الرحلة**. فبعد
   * أوّل نسخةٍ مكتملة يصير البند «تمام» على كلّ حال، فلا يفرّق بين قراءةٍ صادقة
   * وقراءةٍ كاذبة. وهنا وحده يظهر الفرق.
   *
   * و`backup.download` يُسجَّل قبل أوّل بايت — وهذا مقصود، فالمراجعة الأمنيّة تريد
   * أثرًا لأرشيفٍ بدأ بالخروج. ويسجّله أيضًا `/api/backup/documents` لأرشيف
   * الأشعّة وحده. فلو قرأته الجاهزيةُ لقالت «أُخذت نسخة» بعد تنزيلٍ قُطع في
   * منتصفه، وقاعدةُ المرضى والمال لم تُنسخ قطّ.
   */
  const item=async key=>(await (await request('/api/settings/readiness',a)).json()).checks.find(c=>c.key===key);
  const countAudit=async action=>Number((await db.getPool().query('SELECT COUNT(*)::int AS n FROM audit_log WHERE action=$1',[action])).rows[0].n);
  const countRows=async sql=>Number((await db.getPool().query(sql)).rows[0].n);
  check('before any backup, the blocking item is open',(await item('backup')).level==='blocked');
  const startedBefore=await countAudit('backup.download');
  const completedBefore=await countAudit('backup.complete');
  const cut=new AbortController();
  const cutBackup=await fetch(base+'/api/backup',{headers:{cookie:a},signal:cut.signal});
  const cutReader=cutBackup.body.getReader();
  await cutReader.read();  // أوّل دفعةٍ وحدها، ثم تُقطع كما يقطعها المتصفّح
  cut.abort();
  await new Promise(r=>setTimeout(r,400));
  check('a cut backup is recorded as started — and never as complete',
    await countAudit('backup.download')===startedBefore+1
    &&await countAudit('backup.complete')===completedBefore);
  // **وهذا هو الفحص الذي يسقط إن عادت الجاهزية تقرأ بدء التنزيل.**
  check('and it does not close the item — half an archive is not a backup',
    (await item('backup')).level==='blocked');
  const whole=await request('/api/backup',a);
  const wholeSql=await whole.text();
  // والملفّ نفسه يختم نفسه: السطر الأخير علامةُ اكتمال لا يكتبها بثٌّ منقطع.
  check('a backup streamed to its last line is recorded complete',
    wholeSql.includes('-- AQLAN_BACKUP_COMPLETE')
    &&await countAudit('backup.complete')===completedBefore+1);
  check('and only then does the item close',(await item('backup')).level==='ok');
  // وهما واقعتان مختلفتان لا اسمان لواحدة: البدء وقع أكثر ممّا وقع الاكتمال.
  check('the two are different facts — more downloads began than backups finished',
    await countAudit('backup.download')>await countAudit('backup.complete'));

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
  // ── الدراسة السيفالومترية: سريريّةٌ لا إدارية ──
  const studyPatient=await db.createPatient({fullName:'مريضة الدراسة',phone:'770334455',altPhone:null,gender:'female',birthYear:2010,address:null,medicalAlert:null,note:null});
  check('ceph studies denied without a session',(await request(`/api/patients/${studyPatient.id}/ceph-studies`)).status===401);
  check('reception cannot read a cephalometric study — landmark positions are a diagnosis, not an appointment state',
    (await request(`/api/patients/${studyPatient.id}/ceph-studies`,reception)).status===403);
  check('nor create one',(await request(`/api/patients/${studyPatient.id}/ceph-studies`,reception,{documentId:1,phase:'pre'},{origin:base})).status===403);
  // المسار يقبل PATCH لا POST: `request` تُرسل POST متى وُجد جسم، فتردّ 405 لا 403
  // — وفحصٌ يمرّ على رمزٍ آخر ليس فحصًا للحارس المقصود.
  const patch=(path,cookie,body)=>fetch(base+path,{method:'PATCH',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify(body),redirect:'manual'});
  check('nor approve one',(await patch('/api/ceph/studies/1',reception,{action:'approve'})).status===403);
  check('the doctor can read the list',(await request(`/api/patients/${studyPatient.id}/ceph-studies`,d)).status===200);
  check('a study on a document that is not an x-ray is refused',
    (await request(`/api/patients/${studyPatient.id}/ceph-studies`,d,{documentId:999999,phase:'pre'},{origin:base})).status===400);
  check('a study with no treatment phase is refused',
    (await request(`/api/patients/${studyPatient.id}/ceph-studies`,d,{documentId:1},{origin:base})).status===400);
  check('a study that does not exist returns 404',(await request('/api/ceph/studies/999999',d)).status===404);
  check('and approving one that does not exist is refused, not crashed',
    (await patch('/api/ceph/studies/999999',d,{action:'approve'})).status===409);
  check('an unknown action is refused',
    (await patch('/api/ceph/studies/1',d,{action:'delete'})).status===400);

  const rxPatientForLab=await db.createPatient({fullName:'مريض المختبر',phone:'770998877',altPhone:null,gender:'male',birthYear:1985,address:null,medicalAlert:null,note:null});
  // ── كتالوج أعمال المختبر وأسعارها ──
  check('the catalogue is readable by anyone with a session — it is a picker, not a secret',
    (await request('/api/lab/services',d)).status===200);
  check('but only the admin adds to it',(await request('/api/lab/services',d,{name:'تاج زيركون'},{origin:base})).status===403);
  check('a service with no name is refused',(await request('/api/lab/services',a,{name:''},{origin:base})).status===400);
  check('an unknown category is refused, not silently defaulted',
    (await request('/api/lab/services',a,{name:'تاج',category:'زرع'},{origin:base})).status===400);
  const svc=await request('/api/lab/services',a,{name:'تاج زيركون',category:'prostho',defaultDays:10},{origin:base});
  check('the admin adds one',svc.status===201);
  const svcId=(await svc.json()).id;
  check('and the same name twice is refused — it would split its own report',
    (await request('/api/lab/services',a,{name:'تاج زيركون'},{origin:base})).status===409);

  // الأسعار للمدير وحده: كشفُها للطبيب يُطلعه على هامش العيادة في كل عمل.
  check('lab prices are the admin\'s alone',(await request('/api/lab/prices',d)).status===403);
  const lab=await db.createParty({kind:'lab',name:'مختبر الأسعار',phone:null,note:null,commissionPercent:0});
  check('a price on a party that is not a lab is refused',
    (await request('/api/lab/prices',a,{partyId:999999,serviceId:svcId,cost:'20000',effectiveFrom:'2026-01-01'},{origin:base})).status===400);
  check('a price of zero is refused — zero means free, and free hides a debt',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'0',effectiveFrom:'2026-01-01'},{origin:base})).status===400);
  check('the admin sets one',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'20000',effectiveFrom:'2026-01-01'},{origin:base})).status===201);
  // مدّتان تشملان يومًا واحدًا تجعلان للسعر جوابين، فيُحاسَب المختبر بسعرٍ لا يُفهم من أين جاء.
  check('**and an overlapping period is refused, with what to do**',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'26000',effectiveFrom:'2026-06-01'},{origin:base})).status===409);

  const priceList=await (await request(`/api/lab/prices?partyId=${lab.id}`,a)).json();
  const openPrice=priceList.prices.find(p=>p.effectiveTo===null);
  check('closing a price before it started is refused',
    (await patch(`/api/lab/prices/${openPrice.id}`,a,{effectiveTo:'2025-01-01'})).status===409);
  check('and closing it properly works',
    (await patch(`/api/lab/prices/${openPrice.id}`,a,{effectiveTo:'2026-05-31'})).status===200);
  check('then the next period is accepted — a day ends and a day begins',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'26000',effectiveFrom:'2026-06-01'},{origin:base})).status===201);

  // والفرق عن المتّفق يُقال مع الحفظ — لا يُمنع الحفظ ولا يُسكت عن الفرق.
  const labPatient=await db.createPatient({fullName:'مريض التسعير',phone:'770112233',altPhone:null,gender:'male',birthYear:1990,address:null,medicalAlert:null,note:null});
  const order=await request('/api/lab',a,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:svcId,sentDate:'2026-09-01',dueDate:'2026-09-11',partyId:lab.id,cost:'31000'},{origin:base});
  check('an order priced above the agreement is still saved',order.status===201);
  const orderBody=await order.json();
  check('**and the gap is said, not swallowed**',
    orderBody.priceNotice&&orderBody.priceNotice.deltaMinor===5000&&orderBody.priceNotice.agreedMinor===26000);
  const matching=await request('/api/lab',a,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:svcId,sentDate:'2026-09-01',dueDate:'2026-09-11',partyId:lab.id,cost:'26000'},{origin:base});
  check('and an order at the agreed price raises nothing',(await matching.json()).priceNotice===null);

  /*
   * ── السعر المتّفق عليه لا يخرج لغير المدير ──
   *
   * فـ`/api/lab/prices` تمنعه عن الطبيب والاستقبال لأنه هامش العيادة في كل عمل.
   * وهذا المسار يُنشئ أمرًا بأيّ جلسة — فلو خرج التنبيه فيه لصار بابًا خلفيًّا:
   * يرسل الطبيب تكلفةً لا تطابق ويقرأ المتّفق عليه في الجواب.
   *
   * ولا يكفي حجب الرقم: المرسِل يعرف ما كتب، فالفرقُ معه يكشف المتّفق طرحًا،
   * و«يختلف/لا يختلف» وحدها تكشفه بالتنصيف. فالجواب يُفحص كلُّه نصًّا.
   */
  for (const [who,cookie] of [['the doctor',d],['reception',reception]]) {
    const sneak=await request('/api/lab',cookie,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:svcId,sentDate:'2026-09-01',dueDate:'2026-09-11',partyId:lab.id,cost:'31000'},{origin:base});
    check(`${who} can still record a lab order with a cost`,sneak.status===201);
    const text=await sneak.text();
    // والفحص على الجواب كلِّه نصًّا: الرقم قد يخرج في حقلٍ أو في رسالة.
    check(`**and the negotiated price never reaches ${who} — no number, no message, no gap to subtract**`,
      JSON.parse(text).priceNotice===null&&!text.includes('26000')&&!text.includes('5000'));
  }
  check('while the admin still gets it — the notice is his, and it stays useful',
    (await (await request('/api/lab',a,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:svcId,sentDate:'2026-09-01',dueDate:'2026-09-11',partyId:lab.id,cost:'31000'},{origin:base})).json()).priceNotice.agreedMinor===26000);

  /*
   * ── استبدال سعرٍ نافذٍ اليوم ──
   *
   * وهو أشيع سير عملٍ في الوحدة: يرفع المختبر سعره فيُسجَّل اليوم. والحدود شاملة
   * في الطرفين، فإغلاق القديم اليوم وبدء الجديد اليوم يتداخلان — وكانت الشاشة
   * تُغلق اليوم وتبدأ اليوم، فلا سبيل فيها إلى إغلاق القديم أمس.
   */
  const todayText=new Date().toISOString().slice(0,10);
  const yesterday=addDays(todayText,-1);
  const livePrice=(await (await request(`/api/lab/prices?partyId=${lab.id}`,a)).json()).prices.find(p=>p.effectiveTo===null);
  check('a price starting today is refused while the running one is open — bounds are inclusive',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'33000',effectiveFrom:todayText},{origin:base})).status===409);
  check('**and closing it today does not help — that day would carry two prices**',
    (await patch(`/api/lab/prices/${livePrice.id}`,a,{effectiveTo:todayText})).status===200
    &&(await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'33000',effectiveFrom:todayText},{origin:base})).status===409);
  const replaced=await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'33000',effectiveFrom:todayText,replace:true},{origin:base});
  check('**the replacement goes through from the screen, with no trick**',replaced.status===201);
  const replacedBody=await replaced.json();
  check('and it says which period it ended — the trail explains a period nobody closed by hand',
    replacedBody.closedIds.includes(livePrice.id));
  const afterList=(await (await request(`/api/lab/prices?partyId=${lab.id}`,a)).json()).prices;
  const oldRow=afterList.find(p=>p.id===livePrice.id),newRow=afterList.find(p=>p.id===replacedBody.id);
  check('the old period ends the day before — a day ends and a day begins',oldRow.effectiveTo===yesterday);
  check('and its history is untouched: same start, same price',
    oldRow.effectiveFrom===livePrice.effectiveFrom&&oldRow.costMinor===livePrice.costMinor);
  check('the new one runs from today, open-ended',newRow.effectiveFrom===todayText&&newRow.effectiveTo===null);
  const sameDay=afterList.filter(p=>p.serviceId===svcId
    &&p.effectiveFrom<=todayText&&(p.effectiveTo===null||p.effectiveTo>=todayText));
  check('**and today carries exactly one price**',sameDay.length===1&&sameDay[0].id===replacedBody.id);
  check('replacing what starts today is refused with what to do — an end before a start is no answer',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'34000',effectiveFrom:todayText,replace:true},{origin:base})).status===409);
  /*
   * ── مُنتظَرو اليوم على شاشة العمليات ──
   *
   * شكوى المالك الأولى المكتوبة هي **الزحمة**. وشاشةُ العمليات كانت لا تعرف
   * مواعيد اليوم إطلاقًا: مريضٌ حجز قبل شهرٍ يقف أمام الاستقبال فيُكتب اسمُه من
   * جديد ويُنتظر البحث ويُختار من المتشابهين — والطابور خلفه.
   */
  const arrivalPatient=await db.createPatient({fullName:'مريض الموعد',phone:'770334455',altPhone:null,gender:'male',birthYear:1990,address:null,medicalAlert:null,note:null});
  const arrivalDay=clinicDateString(new Date(),process.env.CLINIC_TIME_ZONE || CLINIC_ZONE_FALLBACK);
  const booking=await db.createAppointment({patientId:arrivalPatient.id,date:arrivalDay,time:'09:00',durationMinutes:30,note:null});
  check('the day list is readable by anyone with a session — reception runs the queue',
    (await request(`/api/appointments?date=${arrivalDay}`,reception)).status===200);
  const dayList=async cookie=>(await (await request(`/api/appointments?date=${arrivalDay}`,cookie)).json());
  check('the booked patient shows on today\'s list before arriving',
    (await dayList(a)).some(one=>one.id===booking.id&&one.status==='booked'));

  const arrive=(cookie,id)=>fetch(base+`/api/appointments/${id}`,{method:'PATCH',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify({action:'arrive'})});
  check('marking arrival is denied without a session',(await arrive('',booking.id)).status===401);
  const visitsBefore=(await (await request('/api/visits',a)).json()).length;
  check('**one press opens his row on the board**',(await arrive(reception,booking.id)).status===200);
  const visitsAfter=await (await request('/api/visits',a)).json();
  check('and the board really grew by exactly one',visitsAfter.length===visitsBefore+1,
    `${visitsBefore} → ${visitsAfter.length}`);
  /*
   * **والصفُّ مربوطٌ بملفّه لا باسمٍ مكتوب.**
   *
   * وهذا هو الفرق كلُّه: صفٌّ بلا `patientId` لا يفتح ملفًّا ولا يُنتج فاتورةً
   * على حساب المريض، فيصير اسمًا على شاشةٍ ثم يضيع.
   */
  const openedRow=visitsAfter.find(one=>one.patientId===arrivalPatient.id);
  check('**and it carries his file, not just his name**',Boolean(openedRow));

  /*
   * **ومن وصل يسقط من المنتظَرين وحده** — القائمة مشتقّة من حالة الموعد.
   *
   * ولو كانت تُصان بيدٍ لبقي مريضٌ معروضًا بعد جلوسه على الكرسي.
   */
  check('and he leaves the awaited list on his own — it is derived, not maintained',
    (await dayList(a)).find(one=>one.id===booking.id)?.status==='arrived');
  // وضغطتان متسرّعتان لا تفتحان صفّين: الشرط في UPDATE نفسه.
  check('a second press opens no second row — the guard is in the statement',
    (await arrive(reception,booking.id)).status===409);
  check('and the board did not grow again',
    (await (await request('/api/visits',a)).json()).length===visitsAfter.length);

  check('a service id that is not in the catalogue is refused',
    (await request('/api/lab',a,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:999999,sentDate:'2026-09-01',dueDate:'2026-09-11'},{origin:base})).status===400);

  /*
   * ── كتالوج أعمال المعامل: قائمةٌ معروفةٌ في المهنة، بلا أسعار ──
   *
   * طلبه المالك: «اشغال معامل الاسنان معروفه وانا بحدد الاسعار تبعه». فما تعمله
   * المعامل معروفٌ عالميًّا، وما تتقاضاه اتفاقُ كلِّ مركزٍ مع كلِّ معمل.
   */
  check('the catalogue plan is the admin\'s alone',(await request('/api/lab/services/catalog',d)).status===403);
  check('and denied without a session',(await request('/api/lab/services/catalog')).status===401);
  check('nor can the reception import it',
    (await request('/api/lab/services/catalog',reception,{},{origin:base})).status===403);
  const catalogBefore=await (await request('/api/lab/services/catalog',a)).json();
  // والزرّ يقول ماذا سيفعل قبل أن يُضغط: «استورد الناقص (٤٢)» لا «استورد».
  check('it says how many works are missing before the button is pressed',
    catalogBefore.missing>0&&catalogBefore.total===LAB_WORK_CATALOG.length,
    `${catalogBefore.missing}/${catalogBefore.total}`);
  /*
   * و«تاج زيركون» أُدخل أعلاه بمهلة **عشرة أيام**، وفي الكتالوج مهلته خمسة.
   *
   * فهو الحدُّ الذي يفرّق: استيرادٌ يكتب فوق المسجَّل يمحو ما عدّله المالك.
   */
  check('a work the owner already tuned is counted as present, not missing',
    catalogBefore.present>=1);

  const imported=await request('/api/lab/services/catalog',a,{},{origin:base});
  check('the admin imports the profession\'s catalogue',imported.status===201);
  const importedBody=await imported.json();
  check('and it says what actually went in, not what was attempted',
    importedBody.added===catalogBefore.missing,`${importedBody.added} vs ${catalogBefore.missing}`);

  const labServices=(await (await request('/api/lab/services?all=1',a)).json()).services;
  check('a well-known work is now in the catalogue',
    labServices.some(one=>one.name==='مثبّت شفاف'));
  // والقائمة بلا أسعار: السعر اتفاقُ المركز مع معمله، يُكتب لكلّ معملٍ على حدة.
  check('**and it came in with no price** — the price is the clinic\'s agreement, per lab',
    labServices.every(one=>!('costMinor' in one)&&!('priceMinor' in one)));
  /*
   * **وما كان مسجَّلًا لم يُمسّ.**
   *
   * «تاج زيركون» بقي بمهلة العشرة التي كتبها المالك، لا خمسةِ الكتالوج.
   */
  check('**and the work the owner had tuned kept his days, not the catalogue\'s**',
    labServices.find(one=>one.name==='تاج زيركون')?.defaultDays===10,
    `${labServices.find(one=>one.name==='تاج زيركون')?.defaultDays}`);
  check('importing again says so — it does not add a second copy',
    (await request('/api/lab/services/catalog',a,{},{origin:base})).status===409);
  const afterImport=(await (await request('/api/lab/services?all=1',a)).json()).services;
  check('and the catalogue did not double',afterImport.length===labServices.length);

  /*
   * ── عملة الاتفاق مع المعمل ──
   *
   * شكا المالك أنّ الشاشة لا تعرض إلا الريال اليمني. ومعاملُ الزيركون والزرعات
   * تُسعّر بالدولار أو بالريال السعودي، والاتفاق معها بها — وحفظُ سعرها بعملة
   * المركز يجمّد سعرَ صرفٍ في رقمٍ لا يقول إنّه محوَّل.
   */
  const retainer=afterImport.find(one=>one.name==='مثبّت شفاف');
  const fx=await request('/api/lab/prices',a,{partyId:lab.id,serviceId:retainer.id,cost:'30',currency:'USD',effectiveFrom:'2026-09-01'},{origin:base});
  check('a lab price can be agreed in a currency that is not the clinic\'s',fx.status===201);
  const fxId=(await fx.json()).id;
  const fxRow=(await (await request(`/api/lab/prices?partyId=${lab.id}`,a)).json()).prices.find(p=>p.id===fxId);
  check('**and it is stored in that currency, not converted at today\'s rate**',
    fxRow&&fxRow.currency==='USD'&&fxRow.costMinor===3000,`${fxRow&&fxRow.currency} ${fxRow&&fxRow.costMinor}`);
  /*
   * **وعملةٌ مكتوبةٌ وغيرُ معروفة تُردّ ولا تُبدَّل بعملة المركز.**
   *
   * فالردّ إلى الأساس صامت: من كتب «usd» يظنّ أنّه سعّر بالدولار، ويُحفظ ثلاثون
   * ريالًا يمنيًّا — أقلُّ بمئتي ضعفٍ من المتّفق عليه، ويُقارَن به كلُّ أمرٍ بعده.
   */
  check('an unknown currency is refused, not quietly stored in the clinic\'s',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:retainer.id,cost:'40',currency:'usd',effectiveFrom:'2027-01-01'},{origin:base})).status===400);
  // وحذفُ الحقل شيءٌ آخر: من لم يكتب عملةً يقصد عملة مركزه.
  check('while omitting it still means the clinic\'s own currency',
    (await request('/api/lab/prices',a,{partyId:lab.id,serviceId:svcId,cost:'50000',effectiveFrom:'2020-01-01',effectiveTo:'2020-12-31'},{origin:base})).status===201);

  /*
   * **والاتفاق بعملةٍ والتكلفة بأخرى: يُقال ولا يُقارَن.**
   *
   * فالمقارنة تحتاج سعر صرف يوم الاتفاق ولا يُحفظ، وتحويلُه بسعر اليوم يُنتج
   * «فرقًا» هو حركةُ الصرف لا خلافًا مع المعمل. **والسكوت وحده أسوأ**: من كتب
   * التكلفة يظنّ أنّها قورنت وسكت التنبيه.
   */
  const crossed=await (await request('/api/lab',a,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:retainer.id,sentDate:'2026-09-05',dueDate:'2026-09-12',partyId:lab.id,cost:'20000'},{origin:base})).json();
  check('a cost in another currency than the agreement is not compared',crossed.priceNotice===null);
  check('**but the silence is named** — the admin is told why nothing was compared',
    crossed.currencyNotice&&crossed.currencyNotice.agreedCurrency==='USD'&&crossed.currencyNotice.costCurrency==='YER',
    JSON.stringify(crossed.currencyNotice));
  // ولا يخرج شيءٌ منه لغير المدير: وجودُ اتفاقٍ وعملتُه من هامش العيادة أيضًا.
  const crossedText=await (await request('/api/lab',d,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:retainer.id,sentDate:'2026-09-05',dueDate:'2026-09-12',partyId:lab.id,cost:'20000'},{origin:base})).text();
  check('and the doctor is told nothing — not even that an agreement exists',
    JSON.parse(crossedText).currencyNotice===null&&!crossedText.includes('USD'));
  /*
   * ── عمر الدين بالأقدم-أوّلًا ──
   *
   * وكان يُحسب من أقدم فاتورةٍ بلا نظرٍ إلى ما دفع. فمريضٌ عليه رصيدٌ افتتاحي
   * من ٢٠٢٤ سدّده كاملًا، وعليه اليوم فاتورةٌ جديدة، كان يظهر «منذ ست مئة
   * يوم» ويُصنَّف دَينًا ميتًا — فيُطارَد بمكالماتٍ يستحقّها غيره، أو يُشطب
   * دينُه وهو حاضرٌ يدفع.
   *
   * والرصيد الافتتاحي تاريخُه بيدنا، فيُفحص به بلا حاجةٍ إلى تزوير تواريخ.
   */
  const settled=await db.createPatient({fullName:'مريض سدّد القديم',phone:'770445566',altPhone:null,gender:'male',birthYear:1980,address:null,medicalAlert:null,note:null});
  await db.setPatientOpeningBalance({patientId:settled.id,amountMinor:100000,asOfDate:'2024-01-15',note:null,createdBy:'shots'});
  const settledShift=await db.openShift({openedBy:'shots',opening:{YER:0,SAR:0,USD:0}});
  await db.recordPayment({patientId:settled.id,invoiceId:null,kind:'payment',amountMinor:100000,currency:'YER',baseCurrency:'YER',exchangeRate:1,method:'cash',note:null,createdBy:'shots'});
  await db.createInvoice({patientId:settled.id,baseCurrency:'YER',discountMinor:0,note:null,createdBy:'shots',items:[{serviceId:null,doctorId:null,description:'علاج اليوم',quantity:1,unitPriceMinor:40000}]});
  const aged=(await db.patientDebtReport(1)).find(r=>r.patientId===settled.id);
  check("a patient who cleared an old balance still owes today's invoice",aged&&aged.dueMinor===40000,`${aged&&aged.dueMinor}`);
  // ست مئة يومٍ كان الجواب القديم؛ والصحيح صفر — فاتورةُ اليوم.
  check('**and its age is today, not the day of the balance he already paid**',
    aged&&aged.ageDays===0,`${aged&&aged.ageDays} يومًا`);

  /*
   * ── رصيدٌ افتتاحيٌّ أُدخل اليوم على مريضٍ له فاتورةٌ أقدم منه ──
   *
   * حقلُ التاريخ في شاشة الرصيد الافتتاحي اختياري، ومن تركه فارغًا وضع المسارُ
   * تاريخ اليوم — وهو مسارٌ مسلوكٌ لا نادر. والرصيد **عملٌ سابقٌ للنظام كلِّه**
   * مهما كان تاريخ إدخاله، فهو أقدم من كل فاتورةٍ فيه بالضرورة.
   *
   * وترتيبٌ بالتاريخ وحده كان يضع الفاتورة القديمة قبله، فتغطّيها دفعةٌ بقيمة
   * الافتتاحيّ ويبقى الافتتاحيُّ وحده «غير مسدَّد» — فيقول التقرير إنّ عمر الدين
   * صفر بينما فاتورةُ العام الماضي هي التي لم تُسدَّد.
   *
   * والفاتورة تُؤرَّخ بـ`created_at`، فتُرجَّع بالكتابة في العمود الذي يقرؤه
   * التقرير نفسه — لا بحقنِ نتيجةٍ جاهزة.
   */
  const backdated=await db.createPatient({fullName:'مريض فاتورةٍ قديمة',phone:'770112233',altPhone:null,gender:'male',birthYear:1975,address:null,medicalAlert:null,note:null});
  const oldInvoice=await db.createInvoice({patientId:backdated.id,baseCurrency:'YER',discountMinor:0,note:null,createdBy:'shots',items:[{serviceId:null,doctorId:null,description:'علاجٌ من العام الماضي',quantity:1,unitPriceMinor:20000}]});
  await db.getPool().query(`UPDATE invoices SET created_at = $2::timestamptz WHERE id = $1`,[oldInvoice.id,'2025-06-10 09:00:00+03']);
  // بلا `asOfDate` — كما تُرسلها الشاشة حين يُترك الحقل فارغًا.
  const typedToday=await request('/api/opening-balances',a,{patientId:backdated.id,amount:'20000'},{origin:base});
  const openingSaved=typedToday.status===201?await typedToday.json():null;
  const clinicToday=clinicDateString(new Date(),db.CLINIC_TIME_ZONE);
  check('an opening balance saved with no date is dated today — the path this bug travels',
    openingSaved&&openingSaved.asOfDate===clinicToday,`${openingSaved&&openingSaved.asOfDate}`);
  await db.recordPayment({patientId:backdated.id,invoiceId:null,kind:'payment',amountMinor:20000,currency:'YER',baseCurrency:'YER',exchangeRate:1,method:'cash',note:null,createdBy:'shots'});
  const backdatedRow=(await db.patientDebtReport(1)).find(r=>r.patientId===backdated.id);
  check('he still owes one of the two — the payment covered the other',
    backdatedRow&&backdatedRow.dueMinor===20000,`${backdatedRow&&backdatedRow.dueMinor}`);
  // صفرٌ كان الجواب القديم — والصحيح عمرُ الفاتورة التي لم تُسدَّد.
  check('**and the opening balance goes first however late it was typed — the age is the old invoice**',
    backdatedRow&&backdatedRow.oldestUnpaidDate==='2025-06-10'&&backdatedRow.ageDays>400,
    `${backdatedRow&&backdatedRow.oldestUnpaidDate} — ${backdatedRow&&backdatedRow.ageDays} يومًا`);

  /*
   * ── المجموع وتفصيلُه من لقطةٍ واحدة ──
   *
   * المبلغ يُقرأ في استعلامٍ مجمَّع، والعمرُ من ثلاثة استعلاماتٍ بعده. وكلٌّ على
   * اتّصالٍ من المجمَّع يرى لقطةً مستقلّة، فدفعةٌ تُقيَّد بينها تترك المبلغ موجبًا
   * من اللقطة الأولى بينما يرى حسابُ العمر الدفعةَ فيقول «لا دَين ولا عمر» —
   * فيقع الصفّ في خانةٍ ليست له: مبلغٌ بلا تاريخ.
   *
   * والدفعة تُقيَّد من `recordPayment` نفسها لا بكتابةٍ مصطنعة، وتُثبَّت بين
   * الاستعلامين تمامًا — فالسباق مُعادٌ لا مُنتظَر.
   */
  const snap=await db.createPatient({fullName:'مريض اللقطة',phone:'770223344',altPhone:null,gender:'male',birthYear:1995,address:null,medicalAlert:null,note:null});
  await db.createInvoice({patientId:snap.id,baseCurrency:'YER',discountMinor:0,note:null,createdBy:'shots',items:[{serviceId:null,doctorId:null,description:'علاج اليوم',quantity:1,unitPriceMinor:40000}]});
  const snapshotClient=await db.getPool().connect();
  // ومن يمرّر اتّصاله يفتح لقطته بنفسه: الدالّة لا تبدأ معاملةً على اتّصالٍ لا
  // تملكه — ولو فعلت لألغى `ROLLBACK` في نهايتها معاملةَ من استدعاها.
  await snapshotClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let injected=false;
  const oneSnapshot={
    query:async(text,values)=>{
      const result=await snapshotClient.query(text,values);
      if(!injected&&String(text).includes('WITH billed AS')){
        injected=true;
        await db.recordPayment({patientId:snap.id,invoiceId:null,kind:'payment',amountMinor:40000,currency:'YER',baseCurrency:'YER',exchangeRate:1,method:'cash',note:null,createdBy:'shots'});
      }
      return result;
    },
    release:()=>{},
  };
  let racedRow;
  try{racedRow=(await db.patientDebtReport(1,oneSnapshot)).find(r=>r.patientId===snap.id);}
  finally{await snapshotClient.query('ROLLBACK').catch(()=>{});snapshotClient.release();}
  check('a payment really was committed between the total and its detail',injected);
  check('**and the report answers from one snapshot — an amount owed still carries the date it is owed from**',
    racedRow&&racedRow.dueMinor===40000&&racedRow.oldestUnpaidDate!==null,
    `${racedRow&&racedRow.dueMinor} — ${racedRow&&racedRow.oldestUnpaidDate}`);
  // ولم تكن الدفعة وهمًا: التقرير التالي لا يعرف هذا المريض أصلًا.
  check('and the next report, taken after it, no longer lists him at all',
    !(await db.patientDebtReport(1)).some(r=>r.patientId===snap.id));

  if(settledShift) await db.closeShift({id:settledShift.id,closedBy:'shots',counted:{YER:160000,SAR:0,USD:0},note:null});


  // ── خصم تكلفة المختبر من عمولة الطبيب ──
  check('a lab order with a doctor id that is not a doctor is refused, not silently dropped',
    (await request('/api/lab',a,{patientId:rxPatientForLab.id,labName:'مختبر الاختبار',workType:'تاج',sentDate:'2026-09-01',dueDate:'2026-09-08',doctorId:999999},{origin:base})).status===400);
  // ونسبةُ عملٍ قائم إلى طبيبه — المخرج من «تكلفةٌ بلا طبيب».
  const doctorParty=await db.createParty({kind:'doctor',name:'د. الفحص',phone:null,note:null,commissionPercent:40});
  const orphan=await request('/api/lab',a,{patientId:rxPatientForLab.id,labName:'مختبر بلا طبيب',workType:'تاج',sentDate:'2026-09-02',dueDate:'2026-09-09'},{origin:base});
  const orphanId=(await orphan.json()).id;
  check('an order can be created without a doctor — as every old order is',orphan.status===201);
  check('reception cannot reassign it — that would deduct from a colleague',
    (await patch(`/api/lab/${orphanId}`,reception,{doctorId:doctorParty.id})).status===403);
  check('a party that is not a doctor is refused',
    (await patch(`/api/lab/${orphanId}`,a,{doctorId:999999})).status===400);
  check('**and the admin can attribute it — so the warning can be closed**',
    (await patch(`/api/lab/${orphanId}`,a,{doctorId:doctorParty.id})).status===200);
  check('and cleared again',(await patch(`/api/lab/${orphanId}`,a,{doctorId:null})).status===200);

  const commissions=await (await request('/api/finance/commissions?from=2026-09-01&to=2026-09-30',a)).json();
  check('the commissions screen says which rule it computed on',typeof commissions.deductsLabCost==='boolean');
  check('and reports lab cost that carries no doctor rather than splitting it by guess',
    typeof commissions.unattributedLabCostMinor==='number');
  // **حصّته من التكلفة بنسبته لا التكلفة كاملةً** — وإلّا ظُلم الطبيب بثلثي عمولته.
  check('each row carries both the full lab cost and the doctor\'s share of it',
    commissions.rows.every(r=>typeof r.labCostMinor==='number'&&typeof r.labShareMinor==='number'));
  check('every row carries the deduction line, not just a total',
    commissions.rows.every(r=>typeof r.labCostMinor==='number'&&typeof r.netEarnedMinor==='number'&&typeof r.uncoveredLabCostMinor==='number'));
  // القيمة تحكم مالًا يُصرف، فلا تُخمَّن: «نعم» ليست yes.
  check('the deduction setting refuses anything but yes or no',
    (await patch('/api/settings',a,{'finance.commission_deducts_lab_cost':'نعم'})).status===400);
  check('and accepts no',(await patch('/api/settings',a,{'finance.commission_deducts_lab_cost':'no'})).status===200);
  check('and yes — the owner decided the deduction',
    (await patch('/api/settings',a,{'finance.commission_deducts_lab_cost':'yes'})).status===200);

  /*
   * ── نسبة إهلاك المواد لكل تخصّص ──
   *
   * طلبها المالك بديلًا عن خصم تكلفة المواد الفعلية. والتكلفة الفعلية لا تُنسب
   * إلى عملٍ بعينه — قفّازٌ ومخدّرٌ وشاشٌ لا يُعدّ — فخصمُها يخصم من طبيبٍ سجّل
   * ولا يخصم من طبيبٍ لم يسجّل. والنسبةُ تقديرٌ متّفقٌ عليه سلفًا.
   */
  const rates=(cookie,body)=>fetch(base+'/api/finance/material-rates',{method:'PATCH',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify(body)});
  check('material rates denied without a session',(await request('/api/finance/material-rates')).status===401);
  // والنسبة تكشف كم تُقدّر العيادة ربحها من عمل الطبيب — فهي كأسعار المختبر وسقوف المصروف.
  check('and the reception cannot read them',(await request('/api/finance/material-rates',reception)).status===403);
  check('nor the doctor — he would read what the clinic estimates it keeps of his work',
    (await request('/api/finance/material-rates',d)).status===403);
  check('and the reception cannot set one',(await rates(reception,{category:'ortho',rate:'10'})).status===403);
  check('an unknown speciality is refused — a rate on nothing deducts from nobody',
    (await rates(a,{category:'لا وجود له',rate:'10'})).status===400);
  /*
   * **وما فوق المئة يُردّ.**
   *
   * فنسبةٌ فوقها تعني موادَّ كلّفت أكثر ممّا حُصّل من العمل: تأكل العمولة كلَّها
   * ويبقى فائضٌ — ولا معنى له إلا أنّ أحدًا كتب ٧٥٠ حيث أراد ٧٫٥.
   */
  check('a rate above 100% is refused — 750 where 7.5 was meant',
    (await rates(a,{category:'ortho',rate:'750'})).status===400);
  check('and a negative one — a negative wear would raise the commission',
    (await rates(a,{category:'ortho',rate:'-5'})).status===400);
  check('the admin sets one',(await rates(a,{category:'ortho',rate:'10'})).status===200);
  const rateList=async()=>(await (await request('/api/finance/material-rates',a)).json()).rates;
  check('and it comes back in basis points, an integer like money',
    (await rateList()).find(one=>one.category==='ortho')?.rateBp===1000);

  /*
   * **والخصم مفتاحٌ مستقلّ عن خصم المختبر.**
   *
   * قال المالك: «اجعلني استطيع اطبقه من الاعدادات **او بدلا منها** نسبة اهلاك» —
   * فمفتاحان لا مفتاح، ولا يُفرض أحدهما مع الآخر.
   */
  check('the material deduction is its own switch, and it refuses anything but yes or no',
    (await patch('/api/settings',a,{'finance.commission_deducts_material_cost':'نعم'})).status===400);
  check('and the owner turns it on',
    (await patch('/api/settings',a,{'finance.commission_deducts_material_cost':'yes'})).status===200);

  /*
   * والحساب من طرفه إلى طرفه: عملٌ بمئة ألف **دُفع نصفُه**، ونسبة إهلاكٍ عشرة،
   * ونسبة طبيبٍ أربعون.
   *
   * **والنصف مقصود.** فلو دُفعت الفاتورة كاملةً لتساوى المحصَّل والمفوتَر، ولمرّ
   * الفحص سواءٌ قيس الإهلاك على هذا أو ذاك — وهو فحصٌ يمرّ بالصدفة. وبالنصف
   * يفترقان: المحصَّل ٥٠٬٠٠٠ والمفوتَر ١٠٠٬٠٠٠.
   *
   * فالمتوقَّع ٤٠٪ × (٥٠٬٠٠٠ − ٥٬٠٠٠) = ١٨٬٠٠٠ — لا ١٥٬٠٠٠ التي يعطيها طرحُ
   * الإهلاك كاملًا من المكتسب، وهو الخطأ الذي كلّف طبيبًا ثلثي عمولته في خصم المختبر.
   */
  const orthoService=(await db.listServices(true)).find(one=>one.category==='ortho');
  check('the catalog has an orthodontic service to price the work with',Boolean(orthoService));
  const wearPatient=await db.createPatient({fullName:'مريض الإهلاك',phone:'770998877',altPhone:null,gender:'male',birthYear:1995,address:null,medicalAlert:null,note:null});
  await db.createInvoice({patientId:wearPatient.id,baseCurrency:'YER',discountMinor:0,note:null,createdBy:'shots',
    items:[{serviceId:orthoService.id,doctorId:doctorParty.id,description:'تركيب تقويم',quantity:1,unitPriceMinor:100000}]});
  const wearShift=await db.openShift({openedBy:'shots',opening:{YER:0,SAR:0,USD:0}});
  await db.recordPayment({patientId:wearPatient.id,invoiceId:null,kind:'payment',amountMinor:50000,currency:'YER',baseCurrency:'YER',exchangeRate:1,method:'cash',note:null,createdBy:'shots'});
  const wearDay=clinicDateString(new Date(),process.env.CLINIC_TIME_ZONE || CLINIC_ZONE_FALLBACK);
  const wearReport=await (await request(`/api/finance/commissions?from=${wearDay}&to=${wearDay}`,a)).json();
  const wearRow=wearReport.rows.find(one=>one.doctorId===doctorParty.id);
  check('the screen says the material rule it computed on',wearReport.deductsMaterialCost===true);
  check('the doctor earned his percent of what was collected, not of what was billed',
    wearRow&&wearRow.earnedMinor===20000,`${wearRow&&wearRow.earnedMinor}`);
  /*
   * **والإهلاك على المحصَّل لا المفوتَر.**
   *
   * فلو قيس على المفوتَر لصار ١٠٬٠٠٠، وصار الطبيب مدينًا بموادّ مريضٍ لم يدفع —
   * وهو بالضبط ما بُني حساب العمولة كلُّه ليتجنّبه.
   */
  check('**the estimated material cost is the rate on what was collected, not on what was billed**',
    wearRow&&wearRow.materialCostMinor===5000,`${wearRow&&wearRow.materialCostMinor}`);
  /*
   * **وحصّته منها بنسبته لا كلُّها** — والفرق بين الرقمين هو الخطأ بعينه.
   */
  check('**and his share of it is his percent of it, not all of it**',
    wearRow&&wearRow.materialShareMinor===2000,`${wearRow&&wearRow.materialShareMinor}`);
  check('so the net is his percent of (collected − wear), not (his percent of collected) − wear',
    wearRow&&wearRow.netEarnedMinor===18000,`${wearRow&&wearRow.netEarnedMinor}`);

  /*
   * ورفعُ النسبة ليس كتابةَ صفر.
   *
   * الصفر يقول «هذا العمل بلا موادّ»، والرفع يقول «لم تُحدَّد نسبته» — ويظهر
   * محصَّلُه في التقرير رقمًا لم يُخصم منه شيء، فيُقرَّر فيه.
   */
  check('the admin clears a rate',(await rates(a,{category:'ortho',rate:null})).status===200);
  check('and clearing removes the row — it does not write a zero',
    !(await rateList()).some(one=>one.category==='ortho'));
  const clearedReport=await (await request(`/api/finance/commissions?from=${wearDay}&to=${wearDay}`,a)).json();
  const clearedRow=clearedReport.rows.find(one=>one.doctorId===doctorParty.id);
  check('**so nothing is deducted, and the uncharged collection is reported rather than silently zeroed**',
    clearedRow&&clearedRow.materialShareMinor===0&&clearedRow.unratedCoveredMinor===50000,
    `${clearedRow&&clearedRow.materialShareMinor} · ${clearedRow&&clearedRow.unratedCoveredMinor}`);
  if(wearShift) await db.closeShift({id:wearShift.id,closedBy:'shots',counted:{YER:50000,SAR:0,USD:0},note:null});
  check('and the owner can turn the material deduction back off',
    (await patch('/api/settings',a,{'finance.commission_deducts_material_cost':'no'})).status===200);

  // ── جاهزية النظام: خارطةُ ما ينقص، وهي للمدير وحده ──
  check('readiness denied without a session',(await request('/api/settings/readiness')).status===401);
  // فالبنود تقول كم حسابًا في النظام ومتى آخر نسخة احتياطية وأرمزُ التنصيب حيّ —
  // وهي بعينها ما يحتاجه من أراد الدخول، فلا تُعطى لكل من يملك جلسة.
  check('reception cannot read readiness — it maps what is missing',(await request('/api/settings/readiness',reception)).status===403);
  check('doctor cannot read readiness either',(await request('/api/settings/readiness',d)).status===403);
  const readiness=await (await request('/api/settings/readiness',a)).json();
  check('admin reads readiness',Array.isArray(readiness.checks)&&readiness.checks.length>0);
  check('every readiness item says what it is, why it matters, and how bad it is',
    readiness.checks.every(c=>c.key&&c.title&&c.detail&&c.why&&['blocked','warn','ok'].includes(c.level)));
  // والحاجز فوق التحذير: من يفتح الشاشة يجد ما يوقفه في أعلاها لا بعد تمريرة.
  const levelRank={blocked:0,warn:1,ok:2};
  check('blocking items come first',readiness.checks.every((c,i)=>i===0||levelRank[readiness.checks[i-1].level]<=levelRank[c.level]));
  // ولا يُقال «جاهز» ما دام بندٌ حاجز مفتوحًا — وهذه قاعدةٌ بلا نسخة احتياطية بعد.
  check('the verdict follows the items, it is not a separate opinion',
    readiness.verdict.blocked===readiness.checks.filter(c=>c.level==='blocked').length
    &&readiness.verdict.warnings===readiness.checks.filter(c=>c.level==='warn').length
    &&readiness.verdict.ready===(readiness.verdict.blocked===0));
  // والنسخة الاحتياطية تُقرأ من سجلّ التدقيق لا من ظنّ: هذه الرحلة نزّلت نسخةً
  // كاملة أعلاه، فلا بدّ أن تراها الجاهزيةُ نسخةَ اليوم. ولو كانت تقرأ من مفتاحٍ
  // يُكتب بيد أو من افتراض، لبقيت «لم تُؤخذ نسخة بعد» بعد نسخةٍ أُخذت فعلًا.
  check('readiness sees the backup this run actually downloaded',
    readiness.checks.find(c=>c.key==='backup').level==='ok');
  // والوقائع من مصادرها لا من ظنّ: ثلاثة مستخدمين أُنشئوا في أعلى هذا الملف.
  const users=readiness.checks.find(c=>c.key==='users');
  check('readiness counts the real users, not a guess',users.detail.includes('admin')&&users.detail.includes('doctor'));

  // ── والوقائع نفسها: كلُّ رقمٍ من الجدول الذي يملكه، وكلُّ حكمٍ يسقط إن كُسر ──

  /*
   * ٢) الخدمات بلا أسعار ليست خدمات.
   *
   * استيراد دليل العيادة أعلاه أدرج صفوفًا فعّالة بـ`price_configured = FALSE`،
   * و`validateProcedures` يردّ أيًّا منها. فعدُّ الصفوف يقول «تمام» ولا خدمةَ
   * تُختار في زيارة.
   */
  const activeServices=await countRows('SELECT COUNT(*)::int AS n FROM services WHERE is_active');
  const pricedServices=await countRows('SELECT COUNT(*)::int AS n FROM services WHERE is_active AND price_configured');
  check('the imported catalog really did leave services with no price',activeServices>pricedServices);
  const servicesItem=await item('services');
  check('so the item counts the priced ones and says both numbers, not one',
    servicesItem.detail.includes(String(pricedServices))&&servicesItem.detail.includes(String(activeServices)));

  /*
   * ٢ب) بوّابة المرضى — بُنيت وتعمل، وكان لا شيء في البرنامج يدلّ عليها.
   *
   * **والرقم المعروض من لا يستطيع الدخول**: الدخول رقمُ الملف والجوال، فمريضٌ
   * بلا جوالٍ لا يدخل مهما أُرسل إليه الرابط — وسكوتُ الشاشة عن ذلك يجعل المالك
   * يظنّ البوّابة معطوبة وهي تعمل، فيبحث عن عطبٍ لا وجود له.
   */
  /*
   * ومريضٌ بلا جوال — والفراغ عدمٌ لا نصٌّ فارغ.
   *
   * فحقلٌ فُتح ثم أُفرغ يصل نصًّا فارغًا، **و`normalizePatientPhone` تردّه عدمًا
   * في كل مسار كتابة**. فالعدّ بـ`phone IS NULL` يكفي، وهذا الفحص يُثبت
   * المقدّمة التي يقوم عليها بدل أن يفترضها: أُنشئ مريضٌ بفراغٍ صريح، ويجب أن
   * يُقرأ عدمًا في القاعدة. ولو تغيّرت تلك القاعدة يومًا سقط هنا لا في تقريرٍ
   * يقول إنّ الجميع يقدرون على البوّابة وفيهم من لا يقدر.
   */
  const blankPhone=await db.createPatient({fullName:'مريض بجوالٍ فارغ',phone:'   ',altPhone:null,gender:'female',birthYear:1992,address:null,medicalAlert:null,note:null});
  await db.createPatient({fullName:'مريض بلا جوال',phone:null,altPhone:null,gender:'male',birthYear:1993,address:null,medicalAlert:null,note:null});
  const blankRow=await db.getPool().query('SELECT phone IS NULL AS isnull FROM patients WHERE id = $1',[blankPhone.id]);
  check('**a blank phone is stored as none at all** — so counting the phoneless by IS NULL is complete',
    blankRow.rows[0]?.isnull===true);
  const allPatients=await countRows('SELECT COUNT(*)::int AS n FROM patients');
  const phoneless=await countRows("SELECT COUNT(*)::int AS n FROM patients WHERE phone IS NULL OR btrim(phone) = ''");
  check('and the phoneless are really fewer than everyone — the counts are not the same number',
    phoneless>0&&phoneless<allPatients,`${phoneless}/${allPatients}`);
  const portalItem=await item('portal');
  check('the readiness screen carries the portal at all — it used to be nowhere in the app',
    Boolean(portalItem));
  /*
   * والمقارنة بالنصّ كاملًا لا بـ`includes`.
   *
   * فـ«٤١ مريضًا · ٠ بلا جوال» يحوي «١» داخل «٤١»، فيمرّ فحصٌ يبحث عن «١»
   * وعددُ من لا يدخل صفر. وهو فحصٌ يمرّ بالصدفة — أسوأ من لا فحص.
   */
  check('**and it names who cannot get in, not just that a portal exists**',
    portalItem.detail===`${allPatients} مريضًا · ${phoneless} بلا جوال`,
    `${portalItem.detail} ≠ ${allPatients} مريضًا · ${phoneless} بلا جوال`);
  check('and it warns rather than blocks while some of them can still get in',
    portalItem.level==='warn');
  // والبوّابة نفسها تُفتح بلا جلسة موظّف: المريض ليس من طاقم المركز.
  check('the portal itself opens without a staff session — the patient is not staff',
    (await request('/portal')).status===200);
  check('but it hands out nothing before the patient logs in',
    (await request('/api/portal/me')).status===401);

  /*
   * ٣) سعرٌ واحدٌ حُدِّث اليوم لا يُبيّض رفيقَه.
   *
   * شاشة الإعدادات تحفظ الحقول المتغيّرة وحدها، فمفتاح الدولار قد لا يكون كُتب
   * قطّ. و`MAX` على التاريخين كان يجعل حفظَ السعوديّ اليوم يقول «تمام».
   */
  check('one rate saved today',(await patch('/api/settings',a,{'finance.rate.SAR':'141'})).status===200);
  const oneRate=await item('rates');
  check('yet the item follows the older key — and a key never saved is not neutral',
    oneRate.level==='warn'&&oneRate.detail.includes('لم يُحفظ قط'));
  check('the other rate saved too',(await patch('/api/settings',a,{'finance.rate.USD':'531'})).status===200);
  check('only then is the item clear — every currency was decided by the owner',
    (await item('rates')).level==='ok');

  /*
   * ٤) الوردية تُقاس بأيّام العيادة لا بساعات.
   *
   * وردية فُتحت أمس قبل منتصف الليل عمرُها ساعات، وقد جمعت قبضَ يومين في جردٍ
   * واحد — وهو الشرط الذي كُتب البند لأجله. وقسمةُ الثواني على ٨٦٤٠٠ كانت
   * تعطيها صفرًا فتُسقط ذكرها.
   */
  const zone=process.env.CLINIC_TIME_ZONE || CLINIC_ZONE_FALLBACK;
  await db.getPool().query(
    `INSERT INTO cashier_shifts (opened_by, opened_at)
     VALUES ('admin', ((((NOW() AT TIME ZONE $1)::date - 1) + TIME '23:59:59') AT TIME ZONE $1))`,[zone]);
  const openAge=await countRows("SELECT EXTRACT(EPOCH FROM (NOW() - opened_at))::int AS n FROM cashier_shifts WHERE status='open'");
  check('the shift was opened less than twenty-four hours ago',openAge>0&&openAge<86400);
  check('yet it already crossed into a second clinic day, and readiness says one day',
    (await db.readinessFacts()).openShiftAgeDays===1);
  const stuck=(await (await request('/api/settings/readiness',a)).json()).checks.find(c=>c.key==='shifts');
  check('and the screen raises it — the very case the item was written for',stuck&&stuck.level==='warn');
  await db.getPool().query("DELETE FROM cashier_shifts WHERE status='open'");
  check('with no shift open the item is not raised at all',
    (await db.readinessFacts()).openShiftAgeDays===null);
  // ── بطاقة المريض: ورقةٌ تخرج بيده فيها رقمُ ملفّه وموعدُه ──
  const cardPatient=await db.createPatient({fullName:'مريض البطاقة',phone:'771122334',altPhone:null,gender:'female',birthYear:2001,address:null,medicalAlert:'حساسية من اللاتكس',note:null});
  const cardPath=`/print/patient-card/${cardPatient.id}`;
  // البطاقة تحمل اسم مريضٍ ورقمَ ملفّه — فلا تُفتح بلا جلسة. والحارس هنا الوسيط
  // (middleware) لا الصفحة: أُعيد العطب — رُفع شرط الجلسة من الصفحة — فلم يسقط
  // هذا الفحص، لأنّ الوسيط يردّ المجهول قبل أن تصل إليه. فهو يشهد بالسلوك من
  // الطرف إلى الطرف لا بحارس الصفحة، وحارسُ الصفحة يُثبَت في اختبار الوحدة
  // («ودورٌ مجهول أو غائب لا يطبع شيئًا» في `__tests__/prints.test.ts`).
  check('the patient card is not reachable without a session',[302,307,404].includes((await request(cardPath)).status));
  // وهي عملُ الاستقبال أوّلًا، والطبيب يطبعها في الكرسي: الثلاثة يفتحونها.
  for (const [who,cookie] of [['admin',a],['reception',reception],['doctor',d]]) {
    check(`${who} can print the patient card`,(await request(cardPath,cookie)).status===200);
  }
  const cardHtml=await (await request(cardPath,reception)).text();
  check('the card carries the file number — the whole point of it',cardHtml.includes(cardPatient.patientNumber));
  check('and the patient name',cardHtml.includes('مريض البطاقة'));
  // **ولا تحمل تنبيهًا طبيًّا**: ورقةٌ تُحمل في جيبٍ وتُنسى على طاولة، وإفشاءُ
  // حساسية المريض عليها لا يحتاجه غرضُها — وهو أن يُعرف رقمُ ملفّه.
  check('the card does not leak the medical alert',!cardHtml.includes('حساسية من اللاتكس'));
  // وتحمل تاريخ طبعها: بطاقةٌ بلا تاريخٍ تُقرأ بعد ستة أشهر على أنها اليوم.
  check('the card says when it was printed',cardHtml.includes('طُبعت في'));
  /*
   * وتاريخ التسجيل بتوقيت العيادة كتاريخ الطبع تمامًا.
   *
   * فـ`createdAt` طابعٌ بتوقيت غرينتش، وقصُّ عشرة أحرفٍ منه يعطي **اليوم السابق**
   * لمن سُجّل بين منتصف الليل والثالثة فجرًا باليمن (+٣) — والعيادة تسجّل في تلك
   * الساعات في ليالي رمضان. والفخّ مكتوبٌ في `CLAUDE.md` بعينه.
   */
  const midnightPatient=await db.createPatient({fullName:'مريض منتصف الليل',phone:'770998877',altPhone:null,gender:'male',birthYear:1990,address:null,medicalAlert:null,note:null});
  // الواحدة والنصف فجرًا بتوقيت العيادة = 22:30 من اليوم السابق بغرينتش.
  await db.getPool().query("UPDATE patients SET created_at = $2 WHERE id = $1",[midnightPatient.id,'2026-03-15T22:30:00Z']);
  const midnightHtml=await (await request(`/print/patient-card/${midnightPatient.id}`,reception)).text();
  // والصيغة «16/03/2026» لا ISO — `friendlyDateLong` يوم/شهر/سنة.
  check('the registration date is the clinic day, not the UTC one that reads a day early',
    midnightHtml.includes('16/03/2026')&&!midnightHtml.includes('15/03/2026'),
    midnightHtml.includes('15/03/2026')?'طُبع 15/03 — يومًا قبل التسجيل':'لم يظهر أيّ من التاريخين');
  // ومريضٌ لا وجود له ٤٠٤، لا بطاقةً باسمٍ فارغ على ترويسة المركز.
  check('a patient that does not exist gets no card',(await request('/print/patient-card/99999999',reception)).status===404);
  // وطبعتها تُسجَّل بنوعها: نوعٌ يُسجَّل باسم آخر يفسد عدّاد المستندات المالية.
  check('the card print is logged under its own type, not another',
    (await request('/api/print-log',reception,{docType:'patient-card',docId:cardPatient.id},{origin:base})).status===200);
  /*
   * ── ميزانيّات بنود المصروف ──
   *
   * سقفٌ يُقارَن به المصروف ولا يمنعه. والسقوف تكشف بنية تكاليف المركز — كم
   * على الرواتب وكم على المختبرات — فهي مع تقارير الدخل ممّا لا يراه الاستقبال.
   */
  check('budgets are denied without a session',(await request('/api/finance/budgets')).status===401);
  check('reception cannot read budgets — they lay out what the clinic costs',
    (await request('/api/finance/budgets',reception)).status===403);
  check('nor the doctor',(await request('/api/finance/budgets',d)).status===403);
  check('nor write one',
    (await request('/api/finance/budgets',reception,{category:'materials',amount:'100000',effectiveFrom:'2026-01'},{origin:base})).status===403);

  const budgetMonth=clinicDateString(new Date(),db.CLINIC_TIME_ZONE).slice(0,7);
  // بندٌ غير معروف يُردّ ولا يُحفظ تحت اسمٍ مخترع.
  check('an unknown expense category is refused',
    (await request('/api/finance/budgets',a,{category:'سفريات',amount:'5000',effectiveFrom:budgetMonth},{origin:base})).status===400);
  check('a month that is not YYYY-MM is refused',
    (await request('/api/finance/budgets',a,{category:'materials',amount:'5000',effectiveFrom:'2026-13'},{origin:base})).status===400);
  check('a negative ceiling is refused — a ceiling below zero is no ceiling',
    (await request('/api/finance/budgets',a,{category:'materials',amount:'-5000',effectiveFrom:budgetMonth},{origin:base})).status===400);
  check('the admin writes one',
    (await request('/api/finance/budgets',a,{category:'materials',amount:'50000',effectiveFrom:budgetMonth},{origin:base})).status===201);

  // ولا سقفَ لبقيّة البنود، فتُعرض «بلا سقف» لا خضراء كأنّها في حدودها.
  const budgets=await (await request(`/api/finance/budgets?month=${budgetMonth}`,a)).json();
  check('every category is listed — one missing from the list reads as zero',
    Array.isArray(budgets.lines)&&budgets.lines.length===7);
  const materials=budgets.lines.find(l=>l.category==='materials');
  const rent=budgets.lines.find(l=>l.category==='rent');
  check('the one with a ceiling carries it',materials&&materials.budgetMinor===50000);
  check('**and the one without says so rather than showing green**',rent&&rent.status.level==='none');
  // والعملة تخرج مع الأرقام: شاشةٌ تفترض الريال تعرض دولارًا على أنه ريال.
  check('the response names the currency its numbers are in',typeof budgets.baseCurrency==='string');
  /*
   * **والجواب يقول لأيّ شهرٍ هو.**
   *
   * فالشاشة تُهمل جوابَ شهرٍ لم يعد مختارًا — يبدّل المدير الشهر فتنطلق قراءةٌ
   * ثانية قبل عودة الأولى، والردّان يعودان بأيّ ترتيب. وبلا هذا الحقل لا سبيل
   * إلى التمييز، فيكتب القديمُ فوق الجديد بلا رسالة.
   */
  check('and the month it answers for — the screen drops a reply for a month no longer chosen',
    budgets.month===budgetMonth);
  const otherMonth=await (await request('/api/finance/budgets?month=2026-01',a)).json();
  check('a different month answers with that month, not the default',otherMonth.month==='2026-01');

  /*
   * **وعملةٌ أساسية غير صالحة تُردّ ولا تُفترَض.**
   *
   * فالسقف يُخزَّن بها ويُقارَن بمصروفٍ محفوظٍ بها. وافتراضُ «الريال» عند فسادها
   * يخزّن سقفًا بوحدةٍ ويقارنه بمصروفٍ بوحدةٍ أخرى — ورقمٌ خاطئ يُبنى عليه قرارُ
   * إنفاق. و`/api/expenses` و`/api/payments` يردّان في هذه الحال، وهذا مثلهما.
   */
  /*
   * والكتابة في الجدول مباشرةً لأنّ `PATCH /api/settings` يرفض القيمة الفاسدة —
   * فالحالُ لا يُبلَغ من داخل التطبيق، وإنّما من تعديلٍ على القاعدة أو استعادةٍ من
   * نسخةٍ أجنبية. ثمّ انتظارٌ يتجاوز ذاكرة الإعدادات (٥ ثوانٍ) وإلّا أجاب الخادم
   * من نسخته القديمة — **والفحص حينها يشهد للذاكرة لا للحارس**.
   */
  // والصفُّ قد لا يكون مكتوبًا أصلًا (القيمة من الافتراضات)، فـ`UPDATE` وحده لا يصيب شيئًا.
  await db.getPool().query("INSERT INTO settings (key, value) VALUES ('finance.base_currency','XXX') ON CONFLICT (key) DO UPDATE SET value = 'XXX'");
  await new Promise(r=>setTimeout(r,5500));
  check('an invalid base currency refuses the read rather than guessing riyals',
    (await request(`/api/finance/budgets?month=${budgetMonth}`,a)).status===500);
  check('and refuses the write — a ceiling in a guessed unit is a wrong number',
    (await request('/api/finance/budgets',a,{category:'rent',amount:'10000',effectiveFrom:budgetMonth},{origin:base})).status===500);
  await db.getPool().query("INSERT INTO settings (key, value) VALUES ('finance.base_currency','YER') ON CONFLICT (key) DO UPDATE SET value = 'YER'");
  await new Promise(r=>setTimeout(r,5500));
  check('and it works again once the setting is sound',
    (await request(`/api/finance/budgets?month=${budgetMonth}`,a)).status===200);

  /*
   * والمصروف يُجمَع بشهر العيادة لا بشهر غرينتش.
   *
   * اليمن على +٣، فمصروفُ آخر ليلةٍ في الشهر يقع في الشهر التالي بتوقيت غرينتش —
   * فيُنقَص من شهرٍ ويُزاد على شهرٍ لم يقع فيه، وكلا الرقمين خطأ.
   */
  const budgetShift=await db.openShift({openedBy:'shots',opening:{YER:0,SAR:0,USD:0}});
  const spend=await db.recordExpense({category:'materials',partyId:null,payeeText:'مورّد الفحص',amountMinor:20000,currency:'YER',baseCurrency:'YER',exchangeRate:1,payableId:null,note:null,createdBy:'shots'});
  if(spend.expense){
    /*
     * **الحدّ الذي يفترق عنده التوقيتان**: 21:30Z من آخر يومٍ في الشهر السابق
     * هو 00:30 من أوّل يومٍ في هذا الشهر بتوقيت العيادة (+٣).
     *
     * فبشهر العيادة يُحسب المصروف هنا، وبشهر غرينتش يُحسب في الشهر الماضي —
     * فيُنقَص من شهرٍ ويُزاد على شهرٍ لم يقع فيه. وأيُّ تاريخٍ في وسط الشهر
     * يعطي الشهر نفسه في التوقيتين، فيمرّ الفحص بالصدفة ولا يُثبت شيئًا.
     */
    const firstOfMonth=new Date(`${budgetMonth}-01T00:00:00Z`);
    const lastNight=new Date(firstOfMonth.getTime()-2.5*3600*1000).toISOString();
    await db.getPool().query('UPDATE expenses SET created_at = $2 WHERE id = $1',[spend.expense.id,lastNight]);
    const afterSpend=await (await request(`/api/finance/budgets?month=${budgetMonth}`,a)).json();
    const line=afterSpend.lines.find(l=>l.category==='materials');
    check('the spend is counted in the clinic month it happened in',line&&line.spentMinor===20000);
    check('and it is measured against the ceiling, not just reported',
      line&&line.status.percent===40&&line.status.remainingMinor===30000);
  }
  if(budgetShift) await db.closeShift({id:budgetShift.id,closedBy:'shots',counted:{YER:-20000,SAR:0,USD:0},note:null});

  /*
   * ── جولة تسعير الأعمال ──
   *
   * أعمال المركز أُدخلت بلا أسعار، والخدمة غير المسعّرة تُرفض عند الفوترة وتحجب
   * شاشةُ الجاهزية البدء. وتسعيرُها واحدةً واحدةً ٨٦ ذهابًا وإيابًا.
   */
  const priceOne=await db.createService({name:'تسعير أ',category:'عام',priceMinor:0});
  const priceTwo=await db.createService({name:'تسعير ب',category:'عام',priceMinor:0});
  // وغيرُ المسعّرة هي ما يُنشئه استيراد الدليل (`price_configured` زائفة) — لا ما سعرُه صفر.
  await db.getPool().query('UPDATE services SET price_configured = FALSE WHERE id = ANY($1::int[])',
    [[priceOne.id,priceTwo.id]]);
  const bulk=(cookie,prices)=>fetch(base+'/api/services/prices',{method:'PATCH',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify({prices})});
  check('bulk pricing is denied without a session',(await bulk('',[{id:priceOne.id,price:'100'}])).status===401);
  check('and the reception cannot price in bulk either',(await bulk(reception,[{id:priceOne.id,price:'100'}])).status===403);
  check('nor the doctor',(await bulk(d,[{id:priceOne.id,price:'100'}])).status===403);

  /*
   * **وسعرٌ خاطئ يردّ الدفعة كلَّها.**
   *
   * فنصفُ دليلٍ مسعّرٍ أسوأ من دليلٍ بلا أسعار: الجاهزية تقول «جاهز» لوجود مسعّرٍ
   * واحد، ثم يصطدم الاستقبال بغير المسعّر عند أوّل فاتورة.
   */
  const rejected=await bulk(a,[{id:priceOne.id,price:'5000'},{id:priceTwo.id,price:'ليس رقمًا'}]);
  check('a bad price rejects the whole batch',rejected.status===400);
  // والرسالة تسمّي صاحبه: «سطرٌ ما» في ٨٦ سطرًا لا يُبحث عنه.
  check('and names which service it was',(await rejected.json()).message.includes('تسعير ب'));
  // ولا يُحفظ الأوّل: لو حُفظ لكان نصفُ الدفعة قد مرّ.
  const afterReject=(await db.listServices(true)).find(one=>one.id===priceOne.id);
  check('**and nothing from it was saved** — not even the row before the bad one',
    afterReject&&afterReject.priceConfigured===false);

  check('zero is refused — a service billed at nothing is not a price',
    (await bulk(a,[{id:priceOne.id,price:'0'}])).status===400);
  const priced=await bulk(a,[{id:priceOne.id,price:'5000'},{id:priceTwo.id,price:'7500'}]);
  check('the admin prices the batch',priced.status===200);
  const pricedBody=await priced.json();
  // ويُقال ما تغيّر فعلًا لا ما أُرسل.
  check('and it reports what actually changed',pricedBody.updated===2&&pricedBody.sent===2);
  const afterPricing=await db.listServices(true);
  check('both are now configured',
    afterPricing.filter(one=>[priceOne.id,priceTwo.id].includes(one.id)).every(one=>one.priceConfigured));
  check('and the remaining unpriced count comes back with the save',
    typeof pricedBody.unpriced==='number');

  /*
   * ── أسعارٌ تخمينية للتجربة ──
   *
   * طلبها المالك ليبدأ التجربة قبل أن يُقرّ قائمته. **وخطرُها أنّها تعمل**: تُفوتَر
   * بها زيارةُ مريضٍ حقيقيّ ولا شيء في فاتورته يقول إنّها تخمين. فالمُثبَت هنا
   * ليس صحّة الرقم — لا أحد يُثبت أنّ الكشف ثلاثة آلاف — بل أنّها لا تمحو قرارًا
   * للمالك، وأنّها تبقى موسومةً حتى يستبدلها.
   */
  const fill=cookie=>fetch(base+'/api/services/prices',{method:'POST',headers:{cookie,origin:base}});
  check('the provisional fill is denied without a session',(await fill('')).status===401);
  check('and the reception cannot fill either',(await fill(reception)).status===403);
  check('nor the doctor',(await fill(d)).status===403);

  const byCode=async code=>(await db.listServices(true)).find(one=>one.catalogCode===code);
  const decided=await byCode('exam');
  // سعرٌ قرّره المالك بيده قبل الملء — وهو ما يجب ألّا يُمسّ.
  check('the owner prices one by hand first',
    (await fetch(base+`/api/services/${decided.id}`,{method:'PATCH',headers:{cookie:a,'content-type':'application/json',origin:base},body:JSON.stringify({price:'9999'})})).status===200);

  const filled=await fill(a);
  check('the admin fills the rest with estimates',filled.status===201);
  const fillBody=await filled.json();
  check('and it says how many it filled',fillBody.filled>0);

  /*
   * **وما قرّره المالك لا يُمسّ.**
   *
   * والشرط في `UPDATE` نفسه لا في فحصٍ قبله: بين قراءة المرشَّحين وكتابتهم قد
   * يسعّر المالك خدمةً من شاشةٍ أخرى، فيُكتب التخمين فوق قراره.
   */
  const stillDecided=await byCode('exam');
  check('**the price the owner decided is untouched** — and unmarked',
    stillDecided.priceMinor===9999&&stillDecided.priceProvisional===false,
    `${stillDecided.priceMinor} · ${stillDecided.priceProvisional}`);

  const guessed=await byCode('zirconia');
  check('the unpriced one took the catalog estimate',
    guessed.priceMinor===PROVISIONAL_PRICES.zirconia,`${guessed.priceMinor}`);
  // والوسم هو كلُّ ما يفرّق بين رقمٍ قرّره أحدٌ ورقمٍ اخترعه النظام.
  check('**and it is marked provisional** — nothing else says the number was invented',
    guessed.priceProvisional===true);

  /* ومن كتب السعر بيده قرّر، فيسقط وسمُ التخمين. */
  check('the owner overwrites an estimate',
    (await fetch(base+`/api/services/${guessed.id}`,{method:'PATCH',headers:{cookie:a,'content-type':'application/json',origin:base},body:JSON.stringify({price:'77000'})})).status===200);
  const overwritten=await byCode('zirconia');
  check('and the provisional mark falls off — the owner decided it now',
    overwritten.priceMinor===77000&&overwritten.priceProvisional===false,
    `${overwritten.priceMinor} · ${overwritten.priceProvisional}`);

  // ولا شيءَ ليُملأ بعد الآن: ٤٠٩ لا ٢٠١ بـ«صفرٍ مُلئ» — الصفر يُقرأ نجاحًا.
  check('filling again when nothing is left says so, it does not report a silent zero',
    (await fill(a)).status===409);

  /*
   * ── تكلفة المخزون ──
   *
   * المخزون كان يعرف الكمّيّات ولا يعرف أثمانها، فلا يُعرف كم في الرفّ من مال
   * ولا كم كلّفت مواد عملٍ بعينه. والثمن يدخل مع الدفعة، والقيمة تُشتقّ منه.
   */
  const invItem=await db.createInventoryItem({name:'قفازات الفحص',category:'other',unit:'علبة',minLevel:2,note:null,actor:'shots'});
  check('the inventory item was created',invItem.ok);
  const movePath=`/api/inventory/${invItem.id}/movements`;
  // الثمن يكشف تكاليف المركز — فهو للمدير وحده كأسعار المختبر.
  check('the purchase price is the admin\'s alone',
    (await request(movePath,reception,{kind:'in',qty:10,unitCost:'500'},{origin:base})).status===403);
  check('and the doctor cannot write one either',
    (await request(movePath,d,{kind:'in',qty:10,unitCost:'500'},{origin:base})).status===403);
  // لكنّ الصرف على الكرسي عملٌ سريريّ لا يُوقَف: بلا ثمنٍ يمرّ للطبيب.
  check('but issuing at the chair still works without one — clinical work is not blocked',
    (await request(movePath,d,{kind:'in',qty:10},{origin:base})).status===201);
  // والثمن مع الإدخال المُشترى وحده: الصرف والتسوية تُقوَّمان بالمتوسّط.
  check('a price on an issue is refused — it would give the item two prices',
    (await request(movePath,a,{kind:'out',qty:1,unitCost:'500'},{origin:base})).status===400);
  check('the admin buys with a price',
    (await request(movePath,a,{kind:'in',qty:10,unitCost:'700'},{origin:base})).status===201);
  /*
   * وإدخالٌ بلا ثمنٍ **بعد** شراءٍ مسعَّر — وهو الحدُّ الذي يفرّق.
   *
   * فالإدخال الأوّل بلا ثمنٍ دخل ولا متوسّط بعد، فيدخل بصفرٍ في الحالين ولا
   * يُثبت شيئًا. أمّا هذا فيدخل بالمتوسّط القائم (٣٥٠) — ولو حُسب بصفرٍ لخفضه
   * إلى ٢٣٣، فتبدو مادّةٌ اشتُريت أرخص ممّا كلّفت.
   */
  check('a later unpriced entry comes in at the standing average',
    (await request(movePath,d,{kind:'in',qty:10},{origin:base})).status===201);

  check('the stock value is the admin\'s alone',(await request('/api/inventory/value',reception)).status===403);
  check('and denied without a session',(await request('/api/inventory/value')).status===401);
  const value=await (await request('/api/inventory/value',a)).json();
  const valued=value.items.find(one=>one.itemId===invItem.id);
  /*
   * **والإدخال بلا ثمنٍ يدخل بالمتوسّط القائم لا بصفر.**
   *
   * عشرةٌ بلا ثمنٍ أوّلًا (ولا متوسّط بعد، فبصفر)، ثمّ عشرةٌ بسبع مئة = ٧٬٠٠٠
   * على عشرين، فالمتوسّط ٣٥٠. ولو حُسب الإدخال الأوّل بصفرٍ **بعد** الشراء
   * لخفض المتوسّط — وهو ما يجعل مادّةً اشتُريت تبدو أرخص ممّا كلّفت.
   */
  check('the value is derived from the movements, priced and unpriced together',
    valued&&valued.qty===30&&valued.valueMinor===10500,`${valued&&valued.qty} × ${valued&&valued.valueMinor}`);
  check('**and the average is not dragged down by an unpriced entry**',
    valued&&valued.unitCostMinor===350,`${valued&&valued.unitCostMinor}`);
  check('the response names the currency its numbers are in',typeof value.baseCurrency==='string');

  // ── الوصفة الطبية: وثيقةٌ تخرج بيد المريض ──
  const rxPatient=await db.createPatient({fullName:'مريض الوصفة',phone:'770556677',altPhone:null,gender:'male',birthYear:1990,address:null,medicalAlert:'حساسية من البنسلين',note:null});
  const rxPath=`/api/patients/${rxPatient.id}/prescriptions`;
  check('prescriptions denied without a session',(await request(rxPath)).status===401);
  check('reception cannot read a prescription — it is a diagnosis, not a receipt',(await request(rxPath,reception)).status===403);
  check('nor write one',(await request(rxPath,reception,{items:[{name:'Amoxicillin'}]},{origin:base})).status===403);
  check('a prescription with no drug is refused, not saved empty',
    (await request(rxPath,d,{items:[]},{origin:base})).status===400);
  check('a line with a dose but no drug name is not a drug',
    (await request(rxPath,d,{items:[{dose:'500mg'}]},{origin:base})).status===400);
  check('an unknown instructions language is refused, not silently defaulted',
    (await request(rxPath,d,{items:[{name:'Amoxicillin'}],instructionsLang:'fr'},{origin:base})).status===400);
  const issued=await request(rxPath,d,{items:[{name:'Amoxicillin',dose:'500mg',frequency:'every 8 hours'}],diagnosis:'خراج سنّي'},{origin:base});
  check('the doctor issues one',issued.status===201);
  const rxId=(await issued.json()).id;
  // زيارةُ مريضٍ آخر: الوصفة تُنسب إلى ملفٍ ليس ملفَها.
  check("a visit that belongs to another patient is refused",
    (await request(rxPath,d,{items:[{name:'Brufen'}],visitId:999999},{origin:base})).status===400);
  check('the paper is a doctor page — reception is not let in',(await fetch(base+`/print/prescription/${rxId}`,{headers:{cookie:reception},redirect:'manual'})).status===404);
  const paper=await fetch(base+`/print/prescription/${rxId}`,{headers:{cookie:d},redirect:'manual'});
  check('and the doctor gets it',paper.status===200);
  const paperHtml=await paper.text();
  check('the sheet carries the drug that was saved',paperHtml.includes('Amoxicillin'));
  // أهمّ سطرٍ في الورقة — يُقرأ من الملف لا من ذاكرة من يكتب.
  check("and the patient's allergy from the file",paperHtml.includes('حساسية من البنسلين'));
  check('a prescription that does not exist is 404, not an invented sample',
    (await fetch(base+'/print/prescription/999999',{headers:{cookie:d},redirect:'manual'})).status===404);
  /*
   * **اللقطة**: الوصفة وثيقةٌ خرجت بيد المريض، فلا يغيّرها تعديلٌ على ملفّه.
   *
   * وأخطرُ ما فيها التنبيه الطبي: نسخةٌ لاحقة تُحذف منها الحساسية تبدو كأنّ
   * الوصفة كُتبت وهي معلومة وليست، أو تُضاف إليها فيبدو أنّ الطبيب حُذّر ولم يكن.
   */
  await db.updatePatient(rxPatient.id,{fullName:'اسمٌ صُحّح بعد الإصدار',medicalAlert:null});
  const afterEdit=await (await fetch(base+`/print/prescription/${rxId}`,{headers:{cookie:d},redirect:'manual'})).text();
  check("editing the file afterwards does not rewrite the issued sheet",
    afterEdit.includes('مريض الوصفة')&&!afterEdit.includes('اسمٌ صُحّح بعد الإصدار'));
  check("nor erase the allergy the sheet was issued with",afterEdit.includes('حساسية من البنسلين'));
  // واسمُ دواءٍ بالعربية وحدها لا يجده الصيدليّ.
  check('an Arabic-only drug name is refused with a reason that says why',
    (await request(rxPath,d,{items:[{name:'أموكسيسيلين'}]},{origin:base})).status===400);
  check('voiding needs a reason that will still read in a year',
    (await request(`/api/prescriptions/${rxId}/void`,d,{reason:'خطأ'},{origin:base})).status===400);
  check('reception cannot void one',(await request(`/api/prescriptions/${rxId}/void`,reception,{reason:'سببٌ كافٍ للإبطال'},{origin:base})).status===403);
  check('the doctor voids it with a reason',
    (await request(`/api/prescriptions/${rxId}/void`,d,{reason:'تغيّرت الخطة بعد الأشعة'},{origin:base})).status===200);
  check('and it is not voided twice',
    (await request(`/api/prescriptions/${rxId}/void`,d,{reason:'تغيّرت الخطة بعد الأشعة'},{origin:base})).status===400);
  const voidedHtml=await (await fetch(base+`/print/prescription/${rxId}`,{headers:{cookie:d},redirect:'manual'})).text();
  check('the voided sheet still prints, stamped and reasoned',
    voidedHtml.includes('مُبطَلة')&&voidedHtml.includes('تغيّرت الخطة بعد الأشعة'));

  // ── الرسائل الداخلية: خيطُ اثنين لا يُفتح لثالث ──
  check('messages denied without a session',(await request('/api/messages?conversations=1')).status===401);
  check('a portal cookie opens no staff message',(await request('/api/messages?conversations=1',portalCookie)).status===401);
  const adminList=await (await request('/api/messages?conversations=1',a)).json();
  const doctorId=adminList.conversations.find(row=>row.role==='doctor').userId;
  check('the conversation list carries every active colleague and the team box',
    adminList.conversations.length===3&&adminList.conversations.some(row=>row.userId===null));
  const sent=await request('/api/messages',a,{to:{kind:'user',userId:doctorId},kind:'text',body:'الطبيب مطلوب على الكرسي الثاني.'},{origin:base});
  check('admin sends a direct message',sent.status===201);
  const sentId=(await sent.json()).id;
  // من جهة الطبيب، الطرف الآخر هو المرسِل — لا نفسه.
  check('the doctor reads it',(await (await request(`/api/messages?withUser=${owner.id}`,d)).json()).messages.some(m=>m.id===sentId));
  // والاستقبال تفتح خيطها هي مع المرسِل نفسه: الخيط زوجٌ لا شخص.
  const thirdParty=await (await request(`/api/messages?withUser=${owner.id}`,reception)).json();
  check('but reception opening the same thread sees nothing of it — a thread is the pair, not the person',
    !thirdParty.messages.some(m=>m.id===sentId));
  check('and opening the thread cleared the unread count for the reader',
    (await (await request('/api/messages?unread=1',d)).json()).unread===0);
  check('a message to a colleague who does not exist is refused',
    (await request('/api/messages',a,{to:{kind:'user',userId:9999999},kind:'text',body:'x'},{origin:base})).status===404);
  check('an empty message is refused with an Arabic reason',
    (await (await request('/api/messages',a,{to:'broadcast',kind:'text',body:'   '},{origin:base})).json()).message==='اكتب نصّ الرسالة.');
  check('a voice note that is not audio is refused',
    (await request('/api/messages',a,{to:'broadcast',kind:'voice',voiceMime:'text/html',voiceData:'AAAA',voiceMs:1000},{origin:base})).status===400);
  check('comparing studies is denied without a session',(await request('/api/ceph/compare?first=1&second=2')).status===401);
  check('and reception cannot compare either',(await request('/api/ceph/compare?first=1&second=2',reception)).status===403);
  check('comparing a study with itself is refused',(await request('/api/ceph/compare?first=5&second=5',d)).status===400);
  check('and a missing id is refused before the database is touched',(await request('/api/ceph/compare?first=5',d)).status===400);
  check('comparing studies that do not exist returns 404',(await request('/api/ceph/compare?first=999998&second=999999',d)).status===404);

  check('superimposing is denied without a session',(await request('/api/ceph/superimpose?first=1&second=2')).status===401);
  check('and reception cannot superimpose either',(await request('/api/ceph/superimpose?first=1&second=2',reception)).status===403);
  check('superimposing a study on itself is refused',(await request('/api/ceph/superimpose?first=5&second=5',d)).status===400);
  check('and studies that do not exist return 404',(await request('/api/ceph/superimpose?first=999998&second=999999',d)).status===404);

  check('a voice link the listener does not own returns 404, not 403 — 403 would say it exists',
    (await request('/api/messages/voice/999999',reception)).status===404);

  // ── التثبيت على الجهاز: ملفاته تُطلب قبل الدخول وبلا كوكي ──
  const manifest=await request('/manifest.webmanifest');
  check('manifest served without a session — the browser asks for it before anyone logs in',manifest.status===200);

  /*
   * ── كلُّ شاشةٍ تُفتح فعلًا ──
   *
   * أُضيف هذا بعد عطبٍ مرّ من ثلاث بوّابات: `tsc` نظيف، و٧٨٠ اختبارًا تمرّ،
   * و`next build` ينجح — **وشاشةٌ لا تُفتح**. فنداءُ خُطّافٍ في نطاق الوحدة
   * صحيحٌ نحويًّا ويُبنى، ثمّ يسقط عند أوّل تصيير.
   *
   * والقائمة **تُشتقّ من المجلّد لا تُكتب بيد**: شاشةٌ تُضاف غدًا تُفحص بلا أن
   * يتذكّرها أحد. ومن يكتبها بيده ينسى الجديدة — وهي بالضبط الأرجحُ عطبًا.
   *
   * وذواتُ المُعرّفات (`[id]`) تُستثنى: تحتاج رقمًا حقيقيًّا، ومسارُها مفحوصٌ
   * في مواضعه من هذه الرحلة.
   */
  const screens=[];
  const walkScreens=(dir,route)=>{
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(entry.isDirectory()){
        if(entry.name.startsWith('[')||entry.name==='api') continue;
        // مجموعات المسارات `(name)` لا تظهر في العنوان.
        const next=entry.name.startsWith('(')?route:`${route}/${entry.name}`;
        walkScreens(join(dir,entry.name),next);
      } else if(entry.name==='page.tsx') screens.push(route||'/');
    }
  };
  walkScreens(fileURLToPath(new URL('../app',import.meta.url)),'');
  /*
   * والدخول والتنصيب والبوّابة والحجز والعرض لها فحوصها الخاصّة — هذه لشاشات
   * الموظّفين. و`/print/ceph-compare` وثيقةٌ لا شاشة: تُطلب بمعاملات دراستين،
   * وبلا معاملات تردّ ٤٠٤ بحقّ — وهي مفحوصةٌ في موضعها من هذه الرحلة.
   */
  const staffScreens=screens
    .filter(one=>!['/login','/setup','/portal','/book','/display'].includes(one))
    .filter(one=>!one.startsWith('/print/'))
    .sort();
  check('the walk really found the clinic screens — an empty list would pass vacuously',
    staffScreens.length>=15&&staffScreens.includes('/'),`${staffScreens.length}`);
  const broken=[];
  for(const route of staffScreens){
    const page=await request(route,a);
    if(page.status!==200) broken.push(`${route} → ${page.status}`);
  }
  check('**every clinic screen actually renders** — a build that succeeds is not a page that opens',
    broken.length===0,broken.join(' · '));

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
