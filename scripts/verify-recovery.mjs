import "./load-env.mjs";
import assert from "node:assert/strict";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pgConnection } from "../lib/pgConnection.ts";

const original = process.env.DATABASE_URL;
if (!original) throw new Error("DATABASE_URL required");
const prefix = `recovery_${Date.now()}`;
const names = [prefix, `${prefix}_sql`, `${prefix}_full`];
const url = name => { const u=new URL(original);u.pathname=`/${name}`;return u.toString(); };
const admin=new Client(pgConnection(original));await admin.connect();
const base=resolve(tmpdir());const stage=await mkdtemp(join(base,"aqlan-recovery-"));
const init=fileURLToPath(new URL('./init-schema.mjs',import.meta.url));
let origin, restored, full;
let db;
let checks=0;const check=(name,condition)=>{assert.ok(condition,name);checks++;console.log(`✓ ${name}`);};
try {
  for(const name of names){
    await admin.query(`CREATE DATABASE ${name}`);
    execFileSync(process.execPath,['--import','tsx',init],{env:{...process.env,DATABASE_URL:url(name)},stdio:'pipe'});
  }
  process.env.DATABASE_URL=url(prefix);process.env.DOCUMENTS_DIR=join(stage,'source-documents');
  db=await import('../lib/db.ts');
  const {putFile}=await import('../lib/files.ts');
  const person=name=>db.createPatient({fullName:name,phone:null,altPhone:null,gender:'male',birthYear:null,address:null,medicalAlert:null,note:null});
  const p=await person('Recovery patient');
  await db.openShift({openedBy:'test',opening:{YER:0,SAR:0,USD:0}});
  const invoice=await db.createInvoice({patientId:p.id,baseCurrency:'YER',discountMinor:0,note:null,createdBy:'test',items:[{serviceId:null,doctorId:null,description:'Treatment',quantity:1,unitPriceMinor:1000}]});
  await db.recordPayment({patientId:p.id,invoiceId:invoice.id,kind:'payment',amountMinor:50,currency:'YER',baseCurrency:'YER',exchangeRate:1,method:'cash',note:null,createdBy:'test'});
  await db.recordExpense({category:'other',partyId:null,payeeText:'Test',amountMinor:20,currency:'YER',baseCurrency:'YER',exchangeRate:1,payableId:null,note:null,createdBy:'test'});
  origin=new Client(pgConnection(url(prefix)));await origin.connect();
  let table='',injected=false;let sql='';
  const wrapped={query:async(text,values)=>{
    if(text.startsWith('DECLARE backup_rows'))table=text;
    const result=await origin.query(text,values);
    if(text==='FETCH 500 FROM backup_rows' && table.endsWith('public."patients"') && result.rows.length && !injected){
      injected=true;const later=await person('Created during export');
      await db.addVisit({patientName:later.fullName,patientPhone:null,note:null,patientId:later.id});
    }
    return result;
  }};
  for await(const line of db.backupSqlLines(wrapped))sql+=line;
  restored=new Client(pgConnection(url(names[1])));await restored.connect();
  await restored.query(sql);
  check('backup remains restorable during writes',injected);
  check('snapshot excludes both later patient and later visit',(await restored.query('SELECT count(*)::int n FROM patients')).rows[0].n===1 && (await restored.query('SELECT count(*)::int n FROM visits')).rows[0].n===0);
  const numbers=[['patient_number_seq','patients','patient_number','P-'],['invoice_number_seq','invoices','invoice_number','INV-'],['receipt_number_seq','payments','receipt_number','R-'],['voucher_number_seq','expenses','voucher_number','V-']];
  for(const [sequence,tableName,column,numberPrefix] of numbers){
    const {rows}=await restored.query(`SELECT nextval('${sequence}') AS next, (SELECT MAX(regexp_replace(${column},'\\D','','g')::bigint) FROM ${tableName}) AS maximum`);
    check(`${numberPrefix} numbering continues without restart`,Number(rows[0].next)>Number(rows[0].maximum));
  }
  const bytes=Buffer.from('recovery-document-content');const stored=await putFile(bytes,'pdf');
  const document=await db.recordDocument({patientId:p.id,visitId:null,kind:'report',title:'مستند عربي مخفي للاختبار',mimeType:'application/pdf',sizeBytes:bytes.length,sha256:stored.sha256,storageKey:stored.key,note:null,takenOn:null,uploadedBy:'test'});
  await db.removeDocument({id:document.id,actor:'test',note:'Hidden but retained'});
  const {fullBackupBlocks}=await import('../lib/fullBackup.ts');
  const chunks=[];for await(const chunk of fullBackupBlocks())chunks.push(chunk);
  const archive=join(stage,'full.tar');await writeFile(archive,Buffer.concat(chunks));
  const extracted=join(stage,'extracted');await mkdir(extracted);
  execFileSync('tar',['-xf',archive,'-C',extracted]);
  const manifest=JSON.parse(await readFile(join(extracted,'manifest.json'),'utf8'));
  check('full archive contains hidden document metadata',manifest.documents.length===1 && !!manifest.documents[0].removed_at);
  const restore=fileURLToPath(new URL('./restore-full.mjs',import.meta.url));
  const destination=join(stage,'restored-documents');
  execFileSync(process.execPath,['--import','tsx',restore,extracted],{env:{...process.env,DATABASE_URL:url(names[2]),DOCUMENTS_DIR:destination},stdio:'pipe'});
  check('restored document has original key and identical bytes',(await readFile(join(destination,stored.key))).equals(bytes));
  full=new Client(pgConnection(url(names[2])));await full.connect();
  const sourceTables=(await origin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  for(const {tablename} of sourceTables){
    const query=`SELECT row_to_json(t)::text row FROM "${tablename}" t ORDER BY row_to_json(t)::text`;
    assert.deepEqual((await full.query(query)).rows,(await origin.query(query)).rows,`restored rows: ${tablename}`);
  }
  check('every restored database row matches source',true);await full.end();full=null;
  let refused=false;try{execFileSync(process.execPath,['--import','tsx',restore,extracted],{env:{...process.env,DATABASE_URL:url(names[2]),DOCUMENTS_DIR:destination},stdio:'pipe'});}catch{refused=true;}
  check('restore refuses populated target',refused);
  await writeFile(join(extracted,'documents',stored.key),'corrupt');
  refused=false;try{execFileSync(process.execPath,['--import','tsx',restore,extracted],{env:{...process.env,DATABASE_URL:url(names[2]),DOCUMENTS_DIR:destination},stdio:'pipe'});}catch{refused=true;}
  check('restore rejects corrupt document',refused);
  console.log(`${checks} recovery checks passed.`);
} finally {
  await full?.end();await origin?.end();await restored?.end();if(db)await db.getPool().end();
  // Do not forcibly terminate connections while pool.end() sockets are closing.
  for(const name of names)await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
  if(!resolve(stage).startsWith(base+sep))throw new Error('Unsafe temporary directory');
  await rm(stage,{recursive:true,force:true});
}
