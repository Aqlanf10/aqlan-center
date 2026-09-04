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
   *
   * وتاريخُه **تاريخُ إدخالٍ لا تاريخُ نشأة**: حقلُ التاريخ في شاشة الرصيد
   * الافتتاحي اختياري، ومن تركه فارغًا وضع المسارُ تاريخ اليوم. فالتاريخ
   * المسجَّل سقفٌ لعمر هذا الدين لا حدُّه — والحقيقة أقدم منه دائمًا.
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

/**
 * ديونه مرتّبةً بالأقدم أوّلًا — **والافتتاحي قبلها جميعًا مهما كان تاريخُه**.
 *
 * فالرصيد الافتتاحي عملٌ سابقٌ للنظام كلِّه، فهو أقدم من كل فاتورةٍ فيه
 * بالضرورة. وتاريخُه المسجَّل تاريخُ إدخال: حقلُ التاريخ في شاشته اختياري، ومن
 * تركه فارغًا وضع المسارُ تاريخ اليوم — فيُدخَل رصيدٌ افتتاحي اليوم على مريضٍ
 * له فواتيرُ من العام الماضي.
 *
 * وترتيبٌ بالتاريخ وحده كان يضع تلك الفواتير قبله، فتُوزَّع دفعةٌ بقيمة
 * الافتتاحيّ عليها أوّلًا، فيبقى الافتتاحيُّ وحده غيرَ مسدَّد ويقول التقرير إنّ
 * عمر الدين يومٌ واحد — بينما الفاتورة القديمة هي التي لم تُسدَّد فعلًا.
 *
 * ولأنّ العمر يُقرأ من تاريخ أوّل دينٍ لم يُغطَّ، **يُخفَّض تاريخُ الافتتاحيّ إلى
 * تاريخ أقدم فاتورةٍ إن سبقته**: نعلم يقينًا أنه أقدم منها ولا نعلم كم، فأقدمُ
 * فاتورةٍ أصدقُ حدٍّ نملكه. وتركُه على يوم الإدخال يجعل دَينًا قديمًا ابنَ يومه،
 * وتقديمُه بلا حدٍّ اختلاقُ تاريخٍ لا مصدر له.
 */
export function debtsInOrder(history: DebtHistory, asOf: string): DebtEntry[] {
  const invoices = history.invoices
    .filter((invoice) => invoice.date <= asOf && invoice.minor > 0)
    .sort((one, two) => (one.date === two.date ? 0 : one.date < two.date ? -1 : 1));

  const opening = history.opening;
  if (!opening || opening.date > asOf || opening.minor <= 0) return invoices;

  const oldestInvoice = invoices[0]?.date;
  const date = oldestInvoice && oldestInvoice < opening.date ? oldestInvoice : opening.date;
  return [{ date, minor: opening.minor }, ...invoices];
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
