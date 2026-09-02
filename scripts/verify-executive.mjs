import './load-env.mjs';
import { Client } from 'pg';
import { pgConnection } from '../lib/pgConnection.ts';
import { trialBalance, AR_ACCOUNT, CASH_ACCOUNT } from '../lib/accounting.ts';
import { executiveKpis, chairOccupancy } from '../lib/executive.ts';
import { patientBalance } from '../lib/money.ts';
import { hashPassword } from '../lib/auth.ts';
import { clinicDateString } from '../lib/schedule.ts';

/**
 * هل غرفة القيادة تقرأ من الدفاتر فعلًا؟
 *
 * الادّعاء المكتوب في رأس `lib/executive.ts` هو: **لا رقم مالي هناك إلا ويمرّ من
 * ميزان المراجعة**. وادّعاءٌ في تعليق ليس برهانًا؛ فيُختبر هنا على قاعدةٍ حقيقية.
 *
 * وأوّل صيغةٍ لهذا الفحص بُنيت على فهمٍ خاطئ: ظننتُ الدفتر مخزَّنًا، فكتبتُ أن دفعةً
 * تُدسّ في الجدول بلا قيد **لن تحرّك اللوحة** — فتحرّكت. والسبب أن الدفتر هنا
 * **مشتقٌّ من المستندات لا مخزَّن**: القيود تُبنى من الفواتير والدفعات عند القراءة،
 * كما يُشتقّ رصيد المخزون من حركاته.
 *
 * والحقيقة أقوى ممّا ادّعيت: **لا يوجد دفترٌ ثانٍ يمكن أن تفترق عنه اللوحة**. فصار
 * الفحص يُثبت الاتفاق لا الجمود: يُغيَّر مستند، ويُشترط أن تتحرّك اللوحة وكشفُ
 * الحساب **بالمقدار نفسه** — وأن يبقى رقم اللوحة مساويًا لرصيد حساب الدفاتر تمامًا
 * في كل خطوة.
 */

const source = process.env.DATABASE_URL;
if (!source) throw Error('DATABASE_URL required');
const name = `executive_check_${Date.now()}`;
const url = new URL(source);
url.pathname = `/${name}`;
const admin = new Client(pgConnection(source));
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
process.env.DATABASE_URL = url.toString();

const db = await import('../lib/db.ts');
const workflow = await import('../lib/treatmentWorkflow.ts');

let failed = false;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed = true;
};

// اليوم الحقيقي بتوقيت العيادة: القيود تُؤرَّخ بـNOW()، وفترةٌ ثابتة في الماضي
// تجعل ميزان «الفترة» فارغًا فتبدو اللوحة صفرًا وهي سليمة.
const today = clinicDateString(new Date(), process.env.CLINIC_TIME_ZONE ?? 'Asia/Aden');
const operational = {
  arrived: 0, done: 0, stillOpen: 0, noShow: 0, newPatients: 0,
  orthoActive: 0, orthoOverdue: 0, inventoryAlerts: 0, labLate: 0,
};
const occupancy = chairOccupancy({ chairs: 2, activeDays: 1, occupiedMinutes: 0, dayMinutes: 600 });

const kpisNow = async () => {
  const [period, all] = await Promise.all([
    db.journalEntries(today, today),
    db.journalEntries('1900-01-01', today),
  ]);
  return executiveKpis({
    from: today, to: today, baseCurrency: 'YER',
    periodBalances: trialBalance(period),
    cumulativeBalances: trialBalance(all),
    operational, occupancy,
  });
};

try {
  await db.ensureSchema();
  await db.createFirstAdmin({
    username: 'admin', displayName: 'مدير الفحص',
    passwordHash: await hashPassword('executive-check-password-2026'),
  });
  await workflow.importClinicCatalog();
  const services = await db.listServices();
  const service = services.find((one) => one.catalogCode === 'rct');
  await workflow.setCatalogPrices([{ id: service.id, priceMinor: 30000 }]);

  const patient = await db.createPatient({
    fullName: 'مريض غرفة القيادة', phone: null, altPhone: null, gender: 'male',
    birthYear: null, address: null, medicalAlert: null, note: null,
  });

  console.log('\n  ── اللوحة تقرأ ما في الدفاتر ──');

  const visit = await db.addVisit({
    patientId: patient.id, patientName: patient.fullName, patientPhone: null, note: null,
  });
  await db.setVisitProcedures({
    visitId: visit.id,
    procedures: [{
      planItemId: null, serviceId: service.id, toothCode: 16, quantity: 1,
      unitPriceMinor: 30000, surfaces: null, doctorId: null, note: null,
    }],
    notes: {
      chiefComplaint: 'ألم', examination: null, diagnosis: 'فحص',
      treatmentDone: 'علاج عصب', nextPlan: null, doctorId: null,
    },
  });
  await db.signClinicalVisit({ visitId: visit.id, baseCurrency: 'YER', signedBy: 'فحص' });

  await db.openShift({ openedBy: 'فحص', opening: { YER: 0, SAR: 0, USD: 0 } });
  await db.recordPayment({
    patientId: patient.id, invoiceId: null, kind: 'payment', amountMinor: 10000,
    currency: 'YER', baseCurrency: 'YER', exchangeRate: 1, method: 'cash',
    note: null, createdBy: 'فحص',
  });

  const kpis = await kpisNow();
  const books = trialBalance(await db.journalEntries('1900-01-01', today));
  const bookValue = (code) => books.find((one) => one.code === code)?.balanceMinor ?? 0;

  check('الإيراد يوافق الفاتورة', kpis.income.revenueMinor === 30000, `${kpis.income.revenueMinor}`);
  check('والذمم تساوي رصيد حساب الدفاتر نفسه',
    kpis.receivableMinor === bookValue(AR_ACCOUNT), `${kpis.receivableMinor} = ${bookValue(AR_ACCOUNT)}`);
  check('والمفوتر ناقص المحصّل', kpis.receivableMinor === 20000, `${kpis.receivableMinor}`);
  const cash = kpis.collections.find((one) => one.currency === 'YER');
  check('وما دخل الصندوق يوافق الجانب المدين لحساب النقدية',
    cash?.collectedMinor === books.find((one) => one.code === CASH_ACCOUNT.YER)?.debitMinor,
    `${cash?.collectedMinor}`);

  console.log('\n  ── مستندٌ يتغيّر: اللوحة والحساب يتحرّكان معًا ──');

  const beforeKpis = await kpisNow();
  const beforeLedger = await db.patientLedger(patient.id);
  const beforeDue = patientBalance(
    beforeLedger.invoices, db.asPaymentLikes(beforeLedger.payments), 0).dueMinor;

  // تُدسّ في الجدول مباشرةً بلا قيدٍ يقابلها — وهو ما لا يقع من المسار الطبيعي.
  await db.getPool().query(
    `INSERT INTO payments (receipt_number, patient_id, invoice_id, shift_id, kind,
                           amount_minor, currency, exchange_rate, base_amount_minor,
                           base_currency, method, created_by)
     SELECT 'R-GHOST', $1, NULL, s.id, 'payment', 7000, 'YER', 1, 7000, 'YER', 'cash', 'دسّ'
       FROM cashier_shifts s WHERE s.status = 'open' LIMIT 1`,
    [patient.id],
  );

  const afterKpis = await kpisNow();
  const afterLedger = await db.patientLedger(patient.id);
  const afterDue = patientBalance(
    afterLedger.invoices, db.asPaymentLikes(afterLedger.payments), 0).dueMinor;

  check('كشفُ حساب المريض تحرّك بمقدار الدفعة',
    afterDue === beforeDue - 7000, `${beforeDue} → ${afterDue}`);
  check('واللوحة تحرّكت بالمقدار نفسه — لا تتقدّم عليه ولا تتخلّف',
    afterKpis.receivableMinor === beforeKpis.receivableMinor - 7000,
    `${beforeKpis.receivableMinor} → ${afterKpis.receivableMinor}`);
  check('وما دخل الصندوق زاد بها كذلك',
    (afterKpis.collections.find((one) => one.currency === 'YER')?.collectedMinor ?? 0)
      === (beforeKpis.collections.find((one) => one.currency === 'YER')?.collectedMinor ?? 0) + 7000);

  // والحكم الأخير: رقم اللوحة **هو** رصيد حساب الدفاتر، لا رقمٌ يقاربه.
  const finalBooks = trialBalance(await db.journalEntries('1900-01-01', today));
  const finalAr = finalBooks.find((one) => one.code === AR_ACCOUNT)?.balanceMinor ?? 0;
  check('ورقم اللوحة هو رصيد حساب الدفاتر نفسه بعد التغيير',
    afterKpis.receivableMinor === finalAr, `${afterKpis.receivableMinor} = ${finalAr}`);
  check('وكشفُ الحساب يوافقهما — ثلاثتها رقمٌ واحد لا ثلاثة',
    afterDue === finalAr, `${afterDue} = ${finalAr}`);

  await db.getPool().end();
} catch (error) {
  console.error(`فشل: ${error.message}`);
  failed = true;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
  await admin.end().catch(() => {});
}
console.log(failed
  ? '\nسقط الفحص.'
  : '\nغرفة القيادة والمحاسبة وكشف الحساب رقمٌ واحد — لا دفترَ ثانٍ يمكن أن تفترق عنه.');
process.exit(failed ? 1 : 0);
