"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { financeLinks } from "@/components/financeLinks";
import { monthOf, type BudgetLevel, type BudgetLine } from "@/lib/budget";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/expenses";
import { formatMoney, isCurrency, type Currency } from "@/lib/money";
import { clinicDateString } from "@/lib/schedule";

/**
 * ميزانيّات بنود المصروف — **سقفٌ يُقارَن به، لا يمنع**.
 *
 * المالك يعرف كم صرف، ولا يعرف أكثيرٌ هو. ومئتا ألفٍ على المواد شيءٌ في شهرٍ عمل
 * فيه خمس مئة مريض، وشيءٌ آخر في شهرٍ عمل فيه مئة. وبلا سقفٍ مكتوبٍ سلفًا يُقاس
 * المصروف بالذاكرة — والذاكرة تتكيّف مع ما تراه، فيصير التجاوز التدريجيّ معتادًا.
 *
 * **والقول قبل نهاية الشهر لا بعده**: تنبيهٌ عند ٨٠٪ يترك للمالك أن يتصرّف،
 * وتقريرٌ آخر الشهر يخبره بما فات.
 */

const TONE: Record<BudgetLevel, { card: string; chip: string; label: string }> = {
  over: { card: "border-rose-300 bg-rose-50", chip: "bg-rose-100 text-rose-800", label: "تجاوز" },
  near: { card: "border-amber-300 bg-amber-50", chip: "bg-amber-100 text-amber-900", label: "قارب السقف" },
  ok: { card: "border-slate-200 bg-white", chip: "bg-emerald-100 text-emerald-800", label: "ضمن السقف" },
  none: { card: "border-slate-200 bg-white", chip: "bg-slate-100 text-slate-600", label: "بلا سقف" },
};

export default function BudgetsPage() {
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);
  const [month, setMonth] = useState(() => monthOf(today));
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [base, setBase] = useState<Currency>("YER");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ category: ExpenseCategory; amount: string }>(
    { category: "materials", amount: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/finance/budgets?month=${month}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // ولا تُترك الشاشة فارغةً على خطأ: فراغٌ يُقرأ «لا مصروف» وهو «لم يُسأل».
        setError(body?.message || "تعذّر قراءة الميزانيّات.");
        setLines([]);
        return;
      }
      setLines(body.lines ?? []);
      if (isCurrency(body.baseCurrency)) setBase(body.baseCurrency);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/finance/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: form.category, amount: form.amount, effectiveFrom: month }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.message || "تعذّر الحفظ."); return; }
      setForm((current) => ({ ...current, amount: "" }));
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setSaving(false);
    }
  };

  const overspent = lines.filter((line) => line.status.level === "over").length;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader
        title="ميزانيّات المصروف"
        subtitle="سقفُ كل بند، وما صُرف منه هذا الشهر"
        links={financeLinks("/finance/budgets")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-bold text-slate-500">الشهر</label>
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-navy-800" />
        {overspent > 0 ? (
          <span className="rounded-lg bg-rose-100 px-2 py-1 text-[11px] font-extrabold text-rose-800">
            {overspent} {overspent === 1 ? "بندٌ تجاوز" : "بنودٍ تجاوزت"} سقفها
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>
      ) : null}

      <ol className="mb-6 space-y-2">
        {lines.map((line) => (
          <li key={line.category} className={`rounded-2xl border-2 p-3 ${TONE[line.status.level].card}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-extrabold text-navy-900">
                {EXPENSE_CATEGORY_LABEL[line.category]}
              </h2>
              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${TONE[line.status.level].chip}`}>
                {TONE[line.status.level].label}
                {line.status.percent !== null ? ` · ${line.status.percent}٪` : ""}
              </span>
            </div>
            {/* الرقمان معًا: المصروف وحده لا يُقرأ، والسقف وحده لا يُتصرَّف به. */}
            <p className="mt-1 text-xs font-bold text-navy-800">
              صُرف {formatMoney(line.spentMinor, base)}
              {line.budgetMinor !== null ? <> من {formatMoney(line.budgetMinor, base)}</> : null}
            </p>
            {line.budgetMinor === null ? (
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                لا سقف لهذا البند — اكتب سقفه أدناه ليُقارَن به.
              </p>
            ) : line.status.remainingMinor !== null && line.status.remainingMinor < 0 ? (
              <p className="mt-1 text-[11px] font-extrabold text-rose-700">
                جُووز بـ{formatMoney(-line.status.remainingMinor, base)}
              </p>
            ) : (
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                بقي {formatMoney(line.status.remainingMinor ?? 0, base)}
              </p>
            )}
          </li>
        ))}
      </ol>

      {!loading && lines.length === 0 && !error ? (
        <p className="text-sm font-bold text-slate-500">لا بنود.</p>
      ) : null}

      <section className="rounded-2xl border-2 border-navy-800 bg-white p-4" aria-label="سقف جديد">
        <h2 className="text-sm font-extrabold">اكتب سقفًا</h2>
        {/* والسقف يسري من شهره فصاعدًا: لا يُعاد كتابته كل شهر. */}
        <p className="mt-1 mb-3 text-[11px] font-bold leading-5 text-slate-500">
          يسري من {month} فصاعدًا حتى تكتب سقفًا أحدث. والسقف يُقارَن به ولا يمنع الصرف —
          إيجارٌ لا يُدفع لأنّ بندَه امتلأ يوقف العيادة.
        </p>
        <div className="flex flex-wrap gap-2">
          <select value={form.category}
            onChange={(event) => setForm((c) => ({ ...c, category: event.target.value as ExpenseCategory }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-navy-800">
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{EXPENSE_CATEGORY_LABEL[category]}</option>
            ))}
          </select>
          <input inputMode="decimal" value={form.amount} placeholder="السقف"
            onChange={(event) => setForm((c) => ({ ...c, amount: event.target.value }))}
            className="min-w-32 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-navy-800" />
          <button type="button" onClick={() => void save()} disabled={saving || !form.amount.trim()}
            className="rounded-xl bg-navy-800 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50">
            {saving ? "يحفظ…" : "احفظ"}
          </button>
        </div>
      </section>
    </main>
  );
}
