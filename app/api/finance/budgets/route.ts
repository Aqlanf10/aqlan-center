import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, createExpenseBudget, expenseBudgetMonth, getSettingsSafe, listExpenseBudgets, recordAudit } from "@/lib/db";
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

async function nearPercent(): Promise<number> {
  const settings = await getSettingsSafe();
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
    const settings = await getSettingsSafe();
    // والعملة تخرج مع الأرقام: شاشةٌ تفترض الريال تعرض دولارًا على أنه ريال.
    const baseCurrency = isCurrency(settings["finance.base_currency"])
      ? settings["finance.base_currency"] : "YER";
    const [report, budgets] = await Promise.all([
      expenseBudgetMonth(month, await nearPercent()),
      listExpenseBudgets(),
    ]);
    return NextResponse.json({ ...report, budgets, baseCurrency, labels: EXPENSE_CATEGORY_LABEL });
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
  const settings = await getSettingsSafe();
  const base = isCurrency(settings["finance.base_currency"]) ? settings["finance.base_currency"] : "YER";
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
