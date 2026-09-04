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
import { addDays } from '../lib/schedule.ts';
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
  check('a service id that is not in the catalogue is refused',
    (await request('/api/lab',a,{patientId:labPatient.id,labName:'مختبر الأسعار',serviceId:999999,sentDate:'2026-09-01',dueDate:'2026-09-11'},{origin:base})).status===400);

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
