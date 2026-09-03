/**
 * عمر الدين — **من أقدم دينٍ لم يُسدَّد بعد، لا من أقدم فاتورة.**
 *
 * والفرق ليس تفصيلًا: شاشة المديونية بُنيت على أنّ «مئة ألف عمرها أسبوع تُحصَّل
 * بمكالمة، ومئة ألف عمرها سنة غالبًا لن تعود». فإن كان العمر خطأً، كان القرار
 * المبنيّ عليه خطأً.
 *
 * وكان يُحسب من `MIN(created_at)` على فواتير المريض كلّها — **بلا نظرٍ إلى ما
 * دفع**. فمريضٌ عالجناه قبل سنةٍ وسدّد كلَّ ما عليه، ثم جاء الأسبوع الماضي
 * لفاتورةٍ جديدة، يظهر «منذ ٤٠٠ يومًا» ويُصنَّف في «ديونٌ ميتة» — ويُطارَد
 * بمكالماتٍ يستحقّها غيره، أو يُشطب دينُه وهو حاضرٌ يدفع.
 *
 * **والأقدم أوّلًا** هو ما يفهمه الناس ويتوقّعونه: المريض يدفع «على حسابه» لا
 * على فاتورةٍ بعينها، فما دفعه يغطّي أقدم ما عليه. وهو التوزيع نفسه المعتمد في
 * حساب العمولات، فلا يفترق جوابان في النظام الواحد على سؤالٍ واحد.
 */

/** دَينٌ بتاريخه — فاتورةً كان أو رصيدًا افتتاحيًّا. */
export interface DebtEntry {
  /** `YYYY-MM-DD` بتوقيت العيادة. */
  date: string;
  minor: number;
}

export interface DebtHistory {
  /**
   * الرصيد الافتتاحي — **أقدم من كل فاتورة في هذا النظام**.
   *
   * فهو ما كان على المريض يوم دخل النظام، وعملُه تمّ قبله. وعدُّه أحدثَ من
   * فواتيرنا يجعل دينًا عمرُه سنتان يبدو ابن شهر.
   */
  opening: DebtEntry | null;
  invoices: DebtEntry[];
  /** الدفعات بإشارتها — والاسترداد يزيد الدين لا ينقصه. */
  payments: { date: string; minor: number; isRefund: boolean }[];
}

/** ما دفعه المريض صافيًا حتى تاريخه. */
export function paidUpTo(history: DebtHistory, asOf: string): number {
  let total = 0;
  for (const payment of history.payments) {
    if (payment.date > asOf) continue;
    total += payment.isRefund ? -payment.minor : payment.minor;
  }
  return total;
}

/** ديونه مرتّبةً بالأقدم أوّلًا — والافتتاحي قبلها جميعًا عند تساوي التاريخ. */
export function debtsInOrder(history: DebtHistory, asOf: string): DebtEntry[] {
  const debts: DebtEntry[] = [];
  if (history.opening && history.opening.date <= asOf && history.opening.minor > 0) {
    debts.push(history.opening);
  }
  for (const invoice of history.invoices) {
    if (invoice.date <= asOf && invoice.minor > 0) debts.push(invoice);
  }
  /*
   * والافتتاحي أوّلًا عند تساوي اليوم.
   *
   * فقد يُسجَّل الرصيد الافتتاحي بتاريخ أوّل فاتورةٍ في النظام، وترتيبٌ يضعه
   * بعدها يجعل عمر الدين يوم الفاتورة لا يوم الرصيد — وهو أقدم بالتعريف.
   */
  return debts.sort((one, two) => {
    if (one.date !== two.date) return one.date < two.date ? -1 : 1;
    if (one === history.opening) return -1;
    if (two === history.opening) return 1;
    return 0;
  });
}

const DAY = 86_400_000;

/** الفرق بالأيام بين تاريخين — من مكوّناتهما، لا من طوابع زمنية بتوقيت آخر. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / DAY));
}

export interface DebtAge {
  /** تاريخ أقدم دينٍ لم يُغطَّ — أو `null` إن لم يبقَ دين. */
  since: string | null;
  ageDays: number;
}

/**
 * عمر أقدم دينٍ لم يُغطِّه ما دُفع.
 *
 * تُجمع الديون بالأقدم أوّلًا حتى يتجاوز مجموعُها ما دُفع؛ فالدين الذي عنده
 * وقع التجاوز هو أقدم ما لم يُسدَّد، وتاريخُه هو عمر الدين.
 */
export function debtAge(history: DebtHistory, asOf: string): DebtAge {
  const paid = Math.max(0, paidUpTo(history, asOf));
  let running = 0;
  for (const debt of debtsInOrder(history, asOf)) {
    running += debt.minor;
    if (running > paid) {
      return { since: debt.date, ageDays: daysBetween(debt.date, asOf) };
    }
  }
  // دُفع كلُّ شيء — أو أكثر. ولا عمر لدَينٍ لا وجود له.
  return { since: null, ageDays: 0 };
}

/**
 * المبلغ الباقي غير المُغطّى — ويوافق العمر أعلاه.
 *
 * فرقمان لحقيقةٍ واحدة يفترقان: شاشةٌ تقول «عليه كذا» وأخرى تقول «لا شيء
 * عليه» لأنّ كلًّا حسب على طريقته.
 */
export function outstanding(history: DebtHistory, asOf: string): number {
  const debts = debtsInOrder(history, asOf).reduce((sum, debt) => sum + debt.minor, 0);
  return debts - paidUpTo(history, asOf);
}
