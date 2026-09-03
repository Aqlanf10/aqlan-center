/**
 * عمولات الأطباء — المنطق الخالص.
 *
 * السؤال الذي تجيب عنه هذه الوحدة: **كم يستحق الطبيب فعلًا؟** وهو سؤال له جوابان
 * مختلفان، والخلط بينهما هو ما يجعل صاحب العيادة يدفع من جيبه:
 *
 * - **المستحق على الفواتير**: نسبة الطبيب من قيمة ما عمله، مفوترًا كان أو محصّلًا.
 * - **المستحق على التحصيل**: نسبته من المال الذي **دخل الصندوق فعلًا**.
 *
 * الفرق بينهما هو المرضى الذين لم يدفعوا. ولأن العيادة تدفع للطبيب نقدًا من صندوق
 * حقيقي، فالمعتمَد هنا **التحصيل**: عمولةٌ على فاتورة لم تُحصَّل تعني أن يدفع صاحب
 * العيادة من ماله عن مريض لم يدفع، ثم يطارد المريض وحده.
 *
 * وتوزيع دفعات المريض على فواتيره **بالأقدم أولًا** (FIFO): المريض يدفع «على
 * حسابه» غالبًا لا على فاتورة بعينها، وهذا هو التوزيع الذي يفهمه الناس ويتوقعونه —
 * ويُنتج نفس النتيجة مهما اختلف ترتيب إدخال الدفعات.
 */

export interface CommissionInvoice {
  id: number;
  netMinor: number;
  createdAt: string;
  /** حصة كل طبيب من بنود هذه الفاتورة. */
  doctorShares: { doctorId: number; amountMinor: number }[];
}

export interface DoctorCommission {
  doctorId: number;
  /** نسبته من قيمة ما عمله كاملًا. */
  accruedMinor: number;
  /** نسبته من المحصّل فعلًا — قبل خصم التكاليف. */
  earnedMinor: number;
  /** تكلفة أعمال المختبر التي أمر بها في المدّة. */
  labCostMinor: number;
  /** المكتسب بعد الخصم — وهو المستحق للدفع. */
  netEarnedMinor: number;
  /**
   * ما فاض من التكلفة عن عمولته في المدّة.
   *
   * ولا يُرحَّل إلى مدّةٍ أخرى ولا يُجعل الصافي سالبًا: العمولة لا تصير دَينًا
   * على الطبيب بقرارٍ من الحساب. ويُعرض ليُرى ويُقرَّر فيه، لا ليُطرح صامتًا.
   */
  uncoveredLabCostMinor: number;
  paidMinor: number;
  dueMinor: number;
}

/**
 * يخصم تكلفة المختبر من المكتسب.
 *
 * والقاعدة قرارُ المالك، ومكتوبةٌ في ذاكرة المشروع: **العمولة المكتسبة من
 * التحصيل الفعلي مع خصم تكاليف المختبر**. وبلا الخصم تُدفع النسبة على مالٍ
 * خرج أكثرُه إلى المختبر: تاجٌ بستّين ألفًا تكلفة تركيبه عشرون، ونسبة الطبيب
 * أربعون بالمئة — فيُصرف له أربعةٌ وعشرون ألفًا من أربعين ألفًا هي كلُّ ما
 * بقي للمركز، بدل ستّة عشر.
 *
 * والخصم لا ينزل بالصافي تحت الصفر: ما فاض يُعرض `uncoveredLabCostMinor`
 * ويُقرَّر فيه إنسانًا. وطرحُه من مدّةٍ تالية يجعل عمولة شهرٍ تأكل شهرًا لم
 * يُعمل فيه ذلك العمل.
 */
export function deductLabCost(
  rows: { doctorId: number; accruedMinor: number; earnedMinor: number; paidMinor: number }[],
  labCostByDoctor: Map<number, number>,
  enabled: boolean,
): DoctorCommission[] {
  return rows.map((row) => {
    const labCostMinor = enabled ? Math.max(0, labCostByDoctor.get(row.doctorId) ?? 0) : 0;
    const netEarnedMinor = Math.max(0, row.earnedMinor - labCostMinor);
    return {
      doctorId: row.doctorId,
      accruedMinor: row.accruedMinor,
      earnedMinor: row.earnedMinor,
      labCostMinor,
      netEarnedMinor,
      uncoveredLabCostMinor: Math.max(0, labCostMinor - row.earnedMinor),
      paidMinor: row.paidMinor,
      dueMinor: netEarnedMinor - row.paidMinor,
    };
  });
}

/**
 * يوزّع ما دفعه المريض على فواتيره بالأقدم أولًا.
 *
 * يعيد لكل فاتورة ما غُطّي منها. المجموع لا يتجاوز المدفوع، والفائض عن كل الفواتير
 * يبقى رصيدًا للمريض ولا يُنسب إلى فاتورة — فلا يُحسب للطبيب عمولةٌ على مالٍ لم
 * يقابله عمل.
 */
export function allocateFifo(
  invoices: { id: number; netMinor: number; createdAt: string }[],
  collectedMinor: number,
): Map<number, number> {
  const allocation = new Map<number, number>();
  let pool = Math.max(0, collectedMinor);
  const ordered = [...invoices].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const invoice of ordered) {
    const covered = Math.min(pool, Math.max(0, invoice.netMinor));
    allocation.set(invoice.id, covered);
    pool -= covered;
  }
  return allocation;
}

/**
 * يحسب عمولة كل طبيب من فواتير مريض واحد.
 *
 * الحصة تُضرب في نسبة التغطية لا في «مسدّدة/غير مسدّدة»: فاتورةٌ غُطّي نصفها تُنتج
 * نصف العمولة. الكل-أو-لا-شيء كان سيؤجّل عمولة الطبيب شهورًا على مريض يدفع أقساطًا،
 * وهو ما يجعل الأطباء يشكّون في الحساب كله.
 */
export function commissionForPatient(
  invoices: CommissionInvoice[],
  collectedMinor: number,
  percentByDoctor: Map<number, number>,
  /**
   * تصفية الفواتير المحسوبة — للتقارير بمدى تاريخي.
   *
   * التوزيع يجري على **كل** فواتير المريض ثم تُحسب المُصفَّاة وحدها: لو حُذفت
   * الفواتير القديمة قبل التوزيع لبدت دفعةٌ قديمة كأنها تغطّي فاتورة الشهر الحالي،
   * فتُصرف عمولة مرتين على مالٍ واحد.
   */
  include?: (invoice: CommissionInvoice) => boolean,
): Map<number, { accruedMinor: number; earnedMinor: number }> {
  const allocation = allocateFifo(invoices, collectedMinor);
  const result = new Map<number, { accruedMinor: number; earnedMinor: number }>();

  for (const invoice of invoices) {
    if (invoice.netMinor <= 0) continue;
    if (include && !include(invoice)) continue;
    const covered = allocation.get(invoice.id) ?? 0;
    const ratio = Math.min(1, covered / invoice.netMinor);

    for (const share of invoice.doctorShares) {
      const percent = percentByDoctor.get(share.doctorId) ?? 0;
      if (percent <= 0) continue;
      const accrued = Math.round((share.amountMinor * percent) / 100);
      const earned = Math.round(accrued * ratio);
      const current = result.get(share.doctorId) ?? { accruedMinor: 0, earnedMinor: 0 };
      result.set(share.doctorId, {
        accruedMinor: current.accruedMinor + accrued,
        earnedMinor: current.earnedMinor + earned,
      });
    }
  }
  return result;
}

/** يجمع نتائج عدة مرضى ويطرح ما دُفع للطبيب. */
export function summarizeCommissions(
  perPatient: Map<number, { accruedMinor: number; earnedMinor: number }>[],
  paidByDoctor: Map<number, number>,
  /** تكلفة المختبر لكل طبيب في المدّة — والخصم اختيارٌ في الإعدادات. */
  labCostByDoctor: Map<number, number> = new Map(),
  deductsLabCost = false,
): DoctorCommission[] {
  const totals = new Map<number, { accruedMinor: number; earnedMinor: number }>();
  for (const entry of perPatient) {
    for (const [doctorId, value] of entry) {
      const current = totals.get(doctorId) ?? { accruedMinor: 0, earnedMinor: 0 };
      totals.set(doctorId, {
        accruedMinor: current.accruedMinor + value.accruedMinor,
        earnedMinor: current.earnedMinor + value.earnedMinor,
      });
    }
  }
  // الأطباء الذين صُرف لهم ولا عمولة محسوبة لهم يظهرون أيضًا: صرفٌ بلا استحقاق
  // مقابل هو ما يجب أن يُرى، لا أن يختفي من التقرير.
  for (const doctorId of paidByDoctor.keys()) {
    if (!totals.has(doctorId)) totals.set(doctorId, { accruedMinor: 0, earnedMinor: 0 });
  }

  /*
   * وطبيبٌ عليه تكلفةُ مختبرٍ ولا عمولة له في المدّة يظهر أيضًا.
   *
   * فأمرُ مختبرٍ بلا فاتورةٍ محصّلة بعدُ حقيقةٌ تخصّه، وإخفاؤه يجعل تكلفةً
   * قائمة لا تُرى في الشاشة التي بُنيت لتُريها.
   */
  if (deductsLabCost) {
    for (const doctorId of labCostByDoctor.keys()) {
      if (!totals.has(doctorId)) totals.set(doctorId, { accruedMinor: 0, earnedMinor: 0 });
    }
  }

  const rows = [...totals.entries()].map(([doctorId, value]) => ({
    doctorId,
    accruedMinor: value.accruedMinor,
    earnedMinor: value.earnedMinor,
    paidMinor: paidByDoctor.get(doctorId) ?? 0,
  }));

  return deductLabCost(rows, labCostByDoctor, deductsLabCost)
    .sort((a, b) => b.dueMinor - a.dueMinor);
}
