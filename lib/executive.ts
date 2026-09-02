import {
  AP_ACCOUNT, AR_ACCOUNT, CASH_ACCOUNT, incomeStatement,
  type AccountBalance, type IncomeStatement,
} from "./accounting";
import { CURRENCIES, CURRENCY_LABEL, type Currency } from "./money";

/**
 * غرفة القيادة — ما يسأل عنه صاحب المركز.
 *
 * **القاعدة الحاكمة: لا رقم مالي هنا إلا ويمرّ من `trialBalance`.**
 *
 * ولا دالّة في هذا الملف تحسب ريالًا من جدول دفعاتٍ أو فواتير — مدخلاتها **موازين
 * مراجعة** لا مستندات. وهي نفس الموازين التي تُبنى منها شاشة المحاسبة وقائمة الدخل
 * والميزانية، بنفس `journalEntries` ونفس `trialBalance`.
 *
 * **والدفتر في هذا البرنامج مشتقٌّ من المستندات لا مخزَّن**: القيود تُبنى من الفواتير
 * والدفعات والسندات عند القراءة — كما يُشتقّ رصيدُ المخزون من حركاته، وزوايا
 * السيفالو من معالمها. فلا يوجد دفترٌ ثانٍ **يمكن** أن تفترق عنه اللوحة: أي مستندٍ
 * يتغيّر يظهر في الاثنين في اللحظة نفسها وبالمقدار نفسه.
 *
 * وهذا أقوى من «لوحةٌ تُطابَق شهريًّا مع الدفاتر»: تلك تفترق ثم تُكتشف، وهذه **لا
 * تستطيع أن تفترق**. ولو جُمعت أرقامها من الجداول مباشرةً لَقالت رقمًا وقالت
 * المحاسبة آخر، فيُسأل أيّهما يُصدَّق ولا جواب — و`verify:executive` يُثبت الاتفاق
 * بتغيير مستندٍ ومقابلة الحركتين.
 */

export interface CollectionsRow {
  currency: Currency;
  label: string;
  /** ما دخل الصندوق في الفترة — الجانب المدين لحساب النقدية. */
  collectedMinor: number;
  /** ما خرج منه — الجانب الدائن. */
  paidOutMinor: number;
  netMinor: number;
}

export interface ExecutiveOperational {
  arrived: number;
  done: number;
  /** زياراتٌ ما تزال مفتوحة — العمل غير المُنهى، وهو ما يُنسى لا ما يُرى. */
  stillOpen: number;
  noShow: number;
  newPatients: number;
  orthoActive: number;
  /** حالات تقويمٍ تأخّرت عن شدّتها — من `listOrthoFollowUp` نفسها. */
  orthoOverdue: number;
  /** بنود مخزونٍ تحتاج تصرّفًا — من `inventoryCounts` نفسها. */
  inventoryAlerts: number;
  /** أعمال مختبرٍ متأخّرة — من `labCounts` نفسها. */
  labLate: number;
}

export interface ChairOccupancy {
  chairs: number;
  /** الأيام التي عمل فيها المركز فعلًا — لا أيام التقويم. */
  activeDays: number;
  occupiedMinutes: number;
  capacityMinutes: number;
  /** نسبة الإشغال 0–100. */
  percent: number;
}

export interface ExecutiveKpis {
  from: string;
  to: string;
  baseCurrency: Currency;
  income: IncomeStatement;
  collections: CollectionsRow[];
  /** ذمم المرضى **التراكمية** حتى نهاية الفترة — لا ذمم الفترة وحدها. */
  receivableMinor: number;
  payableMinor: number;
  operational: ExecutiveOperational;
  occupancy: ChairOccupancy;
}

/**
 * حركة الصندوق لكل عملة من الميزان.
 *
 * ولكلِّ عملةٍ حسابُ نقديةٍ مستقل: الجرد يُعدّ بالورق لا بالمكافئ، وجمعُ الريال
 * والدولار في رقمٍ واحد يجعل «في الصندوق مليون» جملةً لا تُطابق أي درج.
 */
export function collectionsFromBalances(balances: AccountBalance[]): CollectionsRow[] {
  return CURRENCIES.map((currency) => {
    const row = balances.find((one) => one.code === CASH_ACCOUNT[currency]);
    const collectedMinor = row?.debitMinor ?? 0;
    const paidOutMinor = row?.creditMinor ?? 0;
    return {
      currency,
      label: CURRENCY_LABEL[currency],
      collectedMinor,
      paidOutMinor,
      netMinor: collectedMinor - paidOutMinor,
    };
  }).filter((row) => row.collectedMinor !== 0 || row.paidOutMinor !== 0);
}

/**
 * إشغال الكراسي.
 *
 * والسعة تُحسب على **الأيام التي عمل فيها المركز** لا على أيام التقويم: مركزٌ يعمل
 * خمسة أيام في الأسبوع تكون نسبته في شهرٍ كامل ٧٠٪ من الحقيقة لو قُسم على ثلاثين
 * يومًا — فيبدو نصف فارغٍ وهو ممتلئ، ويُتّخذ قرارُ توظيفٍ على رقمٍ كاذب.
 */
export function chairOccupancy(input: {
  chairs: number;
  activeDays: number;
  occupiedMinutes: number;
  dayMinutes: number;
}): ChairOccupancy {
  const chairs = Math.max(0, input.chairs);
  const capacityMinutes = Math.max(0, chairs * input.activeDays * Math.max(0, input.dayMinutes));
  return {
    chairs,
    activeDays: input.activeDays,
    occupiedMinutes: Math.max(0, input.occupiedMinutes),
    capacityMinutes,
    // بلا سعةٍ لا نسبة: القسمة على صفرٍ تُخرج NaN أو ∞، وكلاهما يُعرض رقمًا.
    percent: capacityMinutes > 0
      ? Math.min(100, Math.round((input.occupiedMinutes / capacityMinutes) * 100))
      : 0,
  };
}

export interface ExecutiveInput {
  from: string;
  to: string;
  baseCurrency: Currency;
  /** ميزان قيود **الفترة وحدها** — منه الدخل والتحصيل. */
  periodBalances: AccountBalance[];
  /** ميزانٌ تراكمي حتى نهاية الفترة — منه الذمم، فهي أرصدةٌ لا حركات. */
  cumulativeBalances: AccountBalance[];
  operational: ExecutiveOperational;
  occupancy: ChairOccupancy;
}

/**
 * والذمم من الميزان **التراكمي** لا من ميزان الفترة.
 *
 * لأنها **رصيدٌ لا حركة**: «على المرضى ٣ ملايين» جوابٌ عن اليوم كلّه لا عن الشهر.
 * ولو حُسبت من قيود الشهر لقالت اللوحة إن الذمم صفرٌ في أوّل يومٍ من كل شهر —
 * وهو رقمٌ يُطمئن على ما ليس كذلك.
 */
export function executiveKpis(input: ExecutiveInput): ExecutiveKpis {
  const cumulative = (code: string) =>
    input.cumulativeBalances.find((one) => one.code === code)?.balanceMinor ?? 0;

  return {
    from: input.from,
    to: input.to,
    baseCurrency: input.baseCurrency,
    income: incomeStatement(input.periodBalances),
    collections: collectionsFromBalances(input.periodBalances),
    receivableMinor: cumulative(AR_ACCOUNT),
    payableMinor: cumulative(AP_ACCOUNT),
    operational: input.operational,
    occupancy: input.occupancy,
  };
}

export type PeriodPreset = "today" | "week" | "month" | "quarter" | "year";

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
  quarter: "هذا الربع",
  year: "هذه السنة",
};

/** مدى الفترة — من نصّ اليوم بتوقيت العيادة لا من ساعة الخادم. */
export function periodRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [year, month, day] = today.split("-").map(Number);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const date = new Date(Date.UTC(year, month - 1, day));
    // الأسبوع يبدأ السبت في اليمن — لا الاثنين ولا الأحد.
    const back = (date.getUTCDay() + 1) % 7;
    date.setUTCDate(date.getUTCDate() - back);
    return { from: date.toISOString().slice(0, 10), to: today };
  }
  if (preset === "month") return { from: `${year}-${pad(month)}-01`, to: today };
  if (preset === "quarter") {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return { from: `${year}-${pad(first)}-01`, to: today };
  }
  return { from: `${year}-01-01`, to: today };
}
