import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./expenses";

/**
 * ميزانيّةُ كل بند مصروف — **سقفٌ يُقارَن به المصروف، لا يمنعه**.
 *
 * فالمالك يعرف اليوم كم صرف، ولا يعرف **أكثيرٌ هو**. ومئتا ألفٍ على المواد شيءٌ
 * في شهرٍ عمل فيه خمس مئة مريض، وشيءٌ آخر في شهرٍ عمل فيه مئة. وبلا سقفٍ مكتوبٍ
 * سلفًا يُقاس المصروف بالذاكرة — والذاكرة تتكيّف مع ما تراه كل شهر، فيصير
 * التجاوزُ التدريجيّ هو المعتاد ولا يُلاحَظ أنه تجاوز.
 *
 * **ولا تمنع الصرف.** إيجارٌ لا يُدفع لأنّ بندَه امتلأ يوقف العيادة، والمالك أدرى
 * بشهره. فهي تقول ولا تحجب — والقولُ قبل نهاية الشهر لا بعده.
 *
 * **والسقف يسري من شهره فصاعدًا** حتى يُكتب سقفٌ أحدث — كأسعار المختبر تمامًا.
 * فمن كتب ميزانيّته مرّةً لا يُطالَب بإعادة كتابتها كلّ شهر، وشهرٌ بلا سقفٍ
 * مكتوبٍ له يأخذ سقف ما قبله لا صفرًا.
 */

/** شهرٌ بصيغة `YYYY-MM`. */
export type BudgetMonth = string;

export interface BudgetRow {
  id: number;
  category: ExpenseCategory;
  /** بالوحدة الصغرى للعملة الأساسية — كما تُخزَّن المصروفات. */
  amountMinor: number;
  /** أوّل شهرٍ يسري فيه — ويسري بعده حتى يُكتب أحدث. */
  effectiveFrom: BudgetMonth;
  note: string | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isBudgetMonth(value: unknown): value is BudgetMonth {
  return typeof value === "string" && MONTH.test(value);
}

/** شهرُ تاريخٍ بصيغة `YYYY-MM-DD` — والتاريخ بتوقيت العيادة قبل أن يصل هنا. */
export function monthOf(clinicDate: string): BudgetMonth {
  return clinicDate.slice(0, 7);
}

/**
 * سقفُ بندٍ في شهر — أحدثُ سقفٍ بدأ في ذلك الشهر أو قبله.
 *
 * والتساوي يُحسم بالأحدث إدراجًا (`id` الأكبر): سقفان لشهرٍ واحد يعنيان أنّ
 * المالك عدَّل رأيه، والأخير هو رأيه. وترتيبٌ يأخذ الأوّل يجعل التعديل بلا أثر.
 */
export function budgetFor(
  rows: readonly BudgetRow[],
  category: ExpenseCategory,
  month: BudgetMonth,
): BudgetRow | null {
  let best: BudgetRow | null = null;
  for (const row of rows) {
    if (row.category !== category) continue;
    if (row.effectiveFrom > month) continue;
    if (!best
      || row.effectiveFrom > best.effectiveFrom
      || (row.effectiveFrom === best.effectiveFrom && row.id > best.id)) {
      best = row;
    }
  }
  return best;
}

export type BudgetLevel = "none" | "ok" | "near" | "over";

export interface BudgetStatus {
  level: BudgetLevel;
  /** النسبة المئوية المصروفة من السقف — أو `null` إن لا سقف. */
  percent: number | null;
  /** ما بقي من السقف؛ سالبٌ إن جُووز. */
  remainingMinor: number | null;
}

/** النسبة التي يبدأ عندها التنبيه قبل التجاوز. */
export const NEAR_PERCENT = 80;

/**
 * أين هذا البند من سقفه؟
 *
 * **وبلا سقفٍ لا حكم**: `none` لا `ok`. فبندٌ بلا ميزانيّة يُعرض أخضرَ يُقرأ
 * «في حدوده» وهو بلا حدود أصلًا — وهو أسوأ من ألّا يُعرض.
 *
 * **وسقفُ صفرٍ ليس غياب سقف**: هو قرارٌ بألّا يُصرف على هذا البند شيء، فأيّ
 * مصروفٍ عليه تجاوز. والقسمة عليه لا تصحّ، فالنسبة `null` والحكم من المصروف.
 */
export function budgetStatus(
  spentMinor: number,
  budgetMinor: number | null,
  nearPercent: number = NEAR_PERCENT,
): BudgetStatus {
  if (budgetMinor === null) return { level: "none", percent: null, remainingMinor: null };
  const remainingMinor = budgetMinor - spentMinor;
  if (budgetMinor <= 0) {
    return { level: spentMinor > 0 ? "over" : "ok", percent: null, remainingMinor };
  }
  const percent = Math.round((spentMinor / budgetMinor) * 100);
  const level: BudgetLevel = spentMinor > budgetMinor ? "over"
    : percent >= nearPercent ? "near" : "ok";
  return { level, percent, remainingMinor };
}

export interface BudgetLine {
  category: ExpenseCategory;
  spentMinor: number;
  budgetMinor: number | null;
  status: BudgetStatus;
}

/**
 * كل البنود لشهرٍ واحد، ومعها سقوفُها وحالتُها.
 *
 * وتُعرض البنود كلُّها — حتى ما لم يُصرف عليه ولا سقفَ له — لأنّ **البند الغائب
 * من القائمة يُقرأ صفرًا**، وهو قد يكون بندًا نُسي أن يُسجَّل عليه شيء.
 */
export function budgetLines(
  rows: readonly BudgetRow[],
  spentByCategory: Readonly<Partial<Record<ExpenseCategory, number>>>,
  month: BudgetMonth,
  nearPercent: number = NEAR_PERCENT,
): BudgetLine[] {
  return EXPENSE_CATEGORIES.map((category) => {
    const spentMinor = Math.max(0, spentByCategory[category] ?? 0);
    const budget = budgetFor(rows, category, month);
    const budgetMinor = budget ? budget.amountMinor : null;
    return { category, spentMinor, budgetMinor, status: budgetStatus(spentMinor, budgetMinor, nearPercent) };
  });
}
