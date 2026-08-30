import type { PoolClient } from 'pg';
import { ensureSchema, getPool } from './db';
import { CLINIC_SERVICES } from './clinicCatalog';
import { isValidTooth } from './dental';
import type { ProcedureLine, VisitProcedureInput } from './clinical';
import type { Currency } from './money';

export class ClinicInputError extends Error {}
const invalid = (message: string): never => { throw new ClinicInputError(message); };

/** Repeatable import; never replaces a clinic's price, name or disabled choice. */
export async function importClinicCatalog() {
  await ensureSchema(); const client=await getPool().connect(); let added=0;
  try {
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(41002,1)');
    for (const item of CLINIC_SERVICES) {
      if ((await client.query('SELECT id FROM services WHERE catalog_code=$1',[item.code])).rowCount) continue;
      const matched=await client.query(`UPDATE services SET catalog_code=$1 WHERE id=(SELECT id FROM services WHERE name=$2 AND catalog_code IS NULL ORDER BY id LIMIT 1) RETURNING id`,[item.code,item.name]);
      if (!matched.rowCount) {await client.query(`INSERT INTO services(name,category,catalog_code,price_minor,price_configured) VALUES($1,$2,$3,0,FALSE)`,[item.name,item.category,item.code]);added++;}
    }
    await client.query('COMMIT');return {added,total:CLINIC_SERVICES.length};
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function setCatalogPrices(prices: {id:number;priceMinor:number}[]) {
  if (!prices.length || prices.length>200 || prices.some(p=>!Number.isSafeInteger(p.id)||p.id<1||!Number.isSafeInteger(p.priceMinor)||p.priceMinor<0||p.priceMinor>1e12)) invalid('راجع الأسعار المدخلة.');
  await ensureSchema();const client=await getPool().connect();
  try {await client.query('BEGIN');
    for(const price of [...prices].sort((a,b)=>a.id-b.id)) {
      const result=await client.query('UPDATE services SET price_minor=$2,price_configured=TRUE WHERE id=$1',[price.id,price.priceMinor]);
      if (!result.rowCount) invalid('خدمة غير موجودة.');
    }
    await client.query('COMMIT');
  } catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function validateProcedures(client:PoolClient,visitId:number,procedures:VisitProcedureInput[]) {
  if (procedures.length>80) invalid('الحد الأقصى 80 إجراءً في الزيارة.');
  const seen=new Set<number>();let total=0;
  for(const p of procedures) {
    if (!Number.isSafeInteger(p.serviceId)||p.serviceId<1||!Number.isSafeInteger(p.quantity)||p.quantity<1||p.quantity>99||!Number.isSafeInteger(p.unitPriceMinor)||p.unitPriceMinor<0||p.unitPriceMinor>1e12) invalid('الخدمة والكمية والسعر يجب أن تكون قيمًا صحيحة.');
    total+=p.quantity*p.unitPriceMinor;
    if(!Number.isSafeInteger(total)) invalid('إجمالي الإجراءات أكبر من الحد المسموح.');
    if(p.toothCode!==null&&!isValidTooth(p.toothCode)) invalid('اختر رقم سن صحيحًا.');
    const s=(await client.query('SELECT is_active,price_configured FROM services WHERE id=$1',[p.serviceId])).rows[0];
    if(!s?.is_active||!s.price_configured) invalid('الخدمة موقوفة أو لم يُضبط سعرها بعد.');
    if(p.doctorId!==null && !(await client.query("SELECT id FROM parties WHERE id=$1 AND kind='doctor' AND is_active",[p.doctorId])).rowCount) invalid('اختر طبيبًا مسجّلًا ونشطًا.');
    if(p.planItemId!=null) {
      if(!Number.isSafeInteger(p.planItemId)||seen.has(p.planItemId)) invalid('لا يمكن تكرار بند الخطة في الزيارة.');
      seen.add(p.planItemId);
      const item=(await client.query(`SELECT i.*,t.patient_id,t.status AS plan_status,t.consent_at,v.patient_id AS visit_patient
        FROM plan_items i JOIN treatment_plans t ON t.id=i.plan_id JOIN visits v ON v.id=$2 WHERE i.id=$1`,[p.planItemId,visitId])).rows[0];
      if(!item||item.patient_id!==item.visit_patient||item.status!=='planned'||item.plan_status!=='active'||!item.consent_at) invalid('بند الخطة غير متاح لهذا المريض أو نُفّذ سابقًا.');
      if(item.service_id!==p.serviceId||item.tooth_code!==p.toothCode||item.quantity!==p.quantity||Number(item.unit_price_minor)!==p.unitPriceMinor) invalid('الإجراء المرتبط بالخطة يجب أن يطابق السن والكمية والسعر المتفق عليه.');
    }
  }
}

/** Lock the agreement before its items, shared with consent/scheduling, then decide billing. */
export async function resolveProcedureBilling(client:PoolClient,patientId:number,base:Currency,procedures:ProcedureLine[]) {
  await client.query("SELECT id FROM treatment_plans WHERE patient_id=$1 AND status='active' ORDER BY id FOR UPDATE",[patientId]);
  const items=(await client.query(`SELECT i.*,t.base_currency,
    EXISTS(SELECT 1 FROM plan_installments n WHERE n.plan_id=i.plan_id) AS installments
    FROM plan_items i JOIN treatment_plans t ON t.id=i.plan_id
    WHERE t.patient_id=$1 AND t.status='active' AND t.consent_at IS NOT NULL AND i.status='planned' ORDER BY i.id FOR UPDATE OF i`,[patientId])).rows;
  const used=new Set<number>();const lines:ProcedureLine[]=[];
  for(const p of procedures) {
    const item=items.find(i=>!used.has(i.id)&&(p.planItemId ? i.id===p.planItemId : i.service_id===p.serviceId&&i.tooth_code===p.toothCode&&i.quantity===p.quantity));
    if(p.planItemId&&!item) invalid('نُفّذ بند الخطة في زيارة أخرى. حدّث الزيارة قبل التوقيع.');
    if(item) {
      if(item.base_currency!==base||Number(item.unit_price_minor)!==p.unitPriceMinor) invalid('سعر الإجراء أو عملته لا يطابق الاتفاق. أضف بند الخطة مباشرة للحفاظ على السعر.');
      used.add(item.id);
      // Persist the link even for drafts created before explicit plan selection existed.
      if(item.installments) continue;
    }
    lines.push(p);
  }
  return {lines,itemIds:[...used]};
}

/** A whole proposed course of treatment is either saved with all rows, or not saved. */
export async function createClinicalPlan(input:{patientId:number;title:string;baseCurrency:Currency;startDate:string;createdBy:string;items:{serviceId:number;toothCode:number|null;quantity:number}[]}) {
  if(!input.items.length||input.items.length>80) invalid('اختر من إجراء واحد إلى 80 إجراءً.');
  await ensureSchema();const client=await getPool().connect();
  try {await client.query('BEGIN');
    const plan=(await client.query(`INSERT INTO treatment_plans(patient_id,title,total_minor,base_currency,start_date,created_by,total_from_items) VALUES($1,$2,0,$3,$4,$5,TRUE) RETURNING id`,[input.patientId,input.title,input.baseCurrency,input.startDate,input.createdBy])).rows[0];
    let total=0;
    for(const [index,item] of input.items.entries()) {
      if(!Number.isSafeInteger(item.serviceId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>99||(item.toothCode!==null&&!isValidTooth(item.toothCode))) invalid('راجع الخدمة والسن والكمية.');
      const s=(await client.query('SELECT * FROM services WHERE id=$1 FOR SHARE',[item.serviceId])).rows[0];
      if(!s?.is_active||!s.price_configured) invalid('اختر خدمة نشطة لها سعر محدد من الإدارة.');
      total+=Number(s.price_minor)*item.quantity;if(!Number.isSafeInteger(total))invalid('الإجمالي غير صالح.');
      await client.query(`INSERT INTO plan_items(plan_id,service_id,service_name,category,tooth_code,quantity,unit_price_minor,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[plan.id,s.id,s.name,s.category,item.toothCode,item.quantity,s.price_minor,index]);
    }
    await client.query('UPDATE treatment_plans SET total_minor=$2 WHERE id=$1',[plan.id,total]);await client.query('COMMIT');return {id:plan.id,totalMinor:total};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
