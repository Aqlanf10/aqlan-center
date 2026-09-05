import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, createExpenseBudget, expenseBudgetMonth, getSettings, listExpenseBudgets, recordAudit } from "@/lib/db";
import { isBudgetMonth, monthOf, NEAR_PERCENT } from "@/lib/budget";
import { EXPENSE_CATEGORY_LABEL, isExpenseCategory } from "@/lib/expenses";
import { isCurrency, parseAmount } from "@/lib/money";
import { isAdmin } from "@/lib/roles";
import { clinicDateString } from "@/lib/schedule";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * ميزانيّات بنود المصروف — **للمدير وحده**.
 *
 * فالسقوف تكشف بنية تكاليف المركز: كم يُنفق على الرواتب، وكم على المختبرات، وكم
 * على الإيجار. وهي مع تقارير الدخل ممّا لا يراه الاستقبال ولا الطبيب بنصّ
 * `lib/roles.ts` — «الاستقبال تقبض وتصرف بسند، ولا شأن لها بربح العيادة».
 */
const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const forbidden = () =>
  NextResponse.json({ message: "الميزانيّات للمدير وحده." }, { status: 403 });

/**
 * العملة الأساسية — **تُقرأ ولا تُفترَض**.
 *
 * فكلُّ رقمٍ هنا مبلغٌ: السقف يُخزَّن بها، والمصروف يُقارَن به بـ`base_amount_minor`
 * المحفوظ بها. فإن كانت في الإعدادات قيمةٌ غير صالحة، فافتراضُ «الريال» يخزّن سقفًا
 * بوحدةٍ ويقارنه بمصروفٍ بوحدةٍ أخرى — ورقمٌ خاطئ يُبنى عليه قرارُ إنفاق.
 *
 * ومسارا `/api/expenses` و`/api/payments` يردّان في هذه الحال، **وهذا يفعل مثلهما**:
 * جوابان مختلفان لسؤالٍ واحد في وحدةٍ واحدة هو ما يجعل عطبًا يمرّ من بابٍ أُغلق في
 * غيره.
 */
async function baseOrRefusal() {
  const settings = await getSettings();
  const base = settings["finance.base_currency"];
  if (!isCurrency(base)) {
    return {
      base: null,
      refusal: NextResponse.json(
        { message: "العملة الأساسية في الإعدادات غير صالحة." }, { status: 500 }),
      settings,
    } as const;
  }
  return { base, refusal: null, settings } as const;
}

function nearPercentOf(settings: Awaited<ReturnType<typeof getSettings>>): number {
  const raw = Number(settings["finance.budget_warn_percent"]);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : NEAR_PERCENT;
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) return forbidden();

  const asked = new URL(request.url).searchParams.get("month");
  // وشهرُ العيادة هو الافتراضي لا شهرُ غرينتش.
  const month = isBudgetMonth(asked) ? asked : monthOf(clinicDateString(new Date(), CLINIC_TIME_ZONE));
  try {
    // والعملة تخرج مع الأرقام: شاشةٌ تفترض الريال تعرض دولارًا على أنه ريال.
    const { base, refusal, settings } = await baseOrRefusal();
    if (refusal) return refusal;
    const [report, budgets] = await Promise.all([
      expenseBudgetMonth(month, nearPercentOf(settings)),
      listExpenseBudgets(),
    ]);
    return NextResponse.json({ ...report, budgets, baseCurrency: base, labels: EXPENSE_CATEGORY_LABEL });
  } catch {
    return NextResponse.json({ message: "تعذّر قراءة الميزانيّات." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) return forbidden();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  const category = typeof source.category === "string" ? source.category : "";
  const effectiveFrom = typeof source.effectiveFrom === "string" ? source.effectiveFrom : "";
  const rawAmount = typeof source.amount === "string" ? source.amount : "";

  if (!isExpenseCategory(category)) {
    return NextResponse.json({ message: "بند المصروف غير معروف." }, { status: 400 });
  }
  const { base, refusal } = await baseOrRefusal();
  if (refusal) return refusal;
  // والسقف بالعملة الأساسية: يُقارَن بـ base_amount_minor في المصروفات.
  const amountMinor = parseAmount(rawAmount, base);
  if (amountMinor === null) {
    return NextResponse.json({ message: "السقف مبلغٌ صحيحٌ غير سالب." }, { status: 400 });
  }

  const saved = await createExpenseBudget({
    category, amountMinor, effectiveFrom,
    note: typeof source.note === "string" && source.note.trim() ? source.note.trim() : null,
    actor: session.username,
  });
  if (!saved.ok) return NextResponse.json({ message: saved.message }, { status: 400 });

  // والسقوف تحكم قراءةَ المالك لمصروفه، فتغييرُها يُقرأ بعد سنة.
  await recordAudit({
    action: "budget.set", entity: "expense_budget", entityId: String(saved.id),
    entityLabel: `${EXPENSE_CATEGORY_LABEL[category]} — من ${effectiveFrom}`,
    details: { السقف: amountMinor, البند: category, "من شهر": effectiveFrom },
    actor: session.username, actorRole: session.role,
  });
  return NextResponse.json({ id: saved.id }, { status: 201 });
}
