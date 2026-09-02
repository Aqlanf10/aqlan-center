"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard as Stat } from "@/components/PageHeader";
import {
  PERIOD_LABEL, type ChairOccupancy, type CollectionsRow,
  type ExecutiveOperational, type PeriodPreset,
} from "@/lib/executive";
import { formatMoney, type Currency } from "@/lib/money";

/**
 * غرفة القيادة — ما يسأل عنه صاحب المركز.
 *
 * وكلُّ رقمٍ مالي فيها **رقم دفتر**: لا شيء هنا يُجمع من جدول دفعاتٍ أو فواتير، بل
 * من ميزان مراجعةٍ مشتقٍّ من القيود المزدوجة — وهو نفسه الذي تُقرأ منه شاشة المحاسبة.
 * فمطابقةُ اللوحة مع الدفاتر ليست مراجعةً شهرية؛ هي نتيجة بنيوية.
 *
 * وتُقرأ من أعلى إلى أسفل بترتيب السؤال: **كم ربحنا؟** ثم كم في الصندوق، ثم كم لنا
 * وكم علينا، ثم ماذا جرى في الكراسي.
 */

interface Kpis {
  from: string;
  to: string;
  baseCurrency: Currency;
  income: {
    revenueMinor: number; discountMinor: number; netRevenueMinor: number;
    expenses: { code: string; name: string; amountMinor: number }[];
    totalExpensesMinor: number; netProfitMinor: number;
  };
  collections: CollectionsRow[];
  receivableMinor: number;
  payableMinor: number;
  operational: ExecutiveOperational;
  occupancy: ChairOccupancy;
}

const PRESETS: PeriodPreset[] = ["today", "week", "month", "quarter", "year"];

export default function ExecutivePage() {
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (period: PeriodPreset) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/executive?period=${period}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setKpis(payload.kpis as Kpis);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(preset); }, [load, preset]);

  const money = useMemo(
    () => (minor: number) => (kpis ? formatMoney(minor, kpis.baseCurrency) : "—"),
    [kpis],
  );

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader title="غرفة القيادة" subtitle="كل رقمٍ هنا رقم دفتر — لا جمعٌ موازٍ" />

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="الفترة">
        {PRESETS.map((option) => (
          <button
            key={option}
            onClick={() => setPreset(option)}
            aria-pressed={preset === option}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              preset === option ? "bg-navy-900 text-white" : "border border-slate-200 bg-white text-navy-800"
            }`}
          >
            {PERIOD_LABEL[option]}
          </button>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {loading || !kpis ? (
        <p className="py-8 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : (
        <>
          <p className="mb-3 text-[11px] font-semibold text-slate-400" dir="ltr">
            {kpis.from} → {kpis.to}
          </p>

          <section className="mb-4 grid grid-cols-3 gap-2" aria-label="الدخل">
            <Stat label="الإيراد" value={money(kpis.income.netRevenueMinor)} hint="بعد الخصم" />
            <Stat label="المصروف" value={money(kpis.income.totalExpensesMinor)} />
            <Stat
              label="الربح"
              value={money(kpis.income.netProfitMinor)}
              tone={kpis.income.netProfitMinor >= 0 ? "good" : "bad"}
              hint="أساس الاستحقاق"
            />
          </section>

          <section className="mb-4 grid grid-cols-2 gap-2" aria-label="الذمم">
            <Stat
              label="لنا على المرضى"
              value={money(kpis.receivableMinor)}
              tone={kpis.receivableMinor > 0 ? "warn" : "calm"}
              hint="رصيدٌ تراكمي"
            />
            <Stat
              label="علينا للجهات"
              value={money(kpis.payableMinor)}
              tone={kpis.payableMinor > 0 ? "warn" : "calm"}
              hint="رصيدٌ تراكمي"
            />
          </section>

          {/* الصندوق بعملاته لا بمكافئها: الجرد يُعدّ بالورق. */}
          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4" aria-label="حركة الصندوق">
            <h2 className="mb-2 text-sm font-bold text-navy-900">حركة الصندوق في الفترة</h2>
            {kpis.collections.length === 0 ? (
              <p className="text-xs text-slate-400">لا حركة صندوقٍ في هذه الفترة.</p>
            ) : (
              <ul className="space-y-1">
                {kpis.collections.map((row) => (
                  <li key={row.currency} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                    <span className="font-bold">{row.label}</span>
                    <span className="text-slate-600">
                      دخل {formatMoney(row.collectedMinor, row.currency)} · خرج {formatMoney(row.paidOutMinor, row.currency)}
                    </span>
                    <span className="font-bold">{formatMoney(row.netMinor, row.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mb-4 grid grid-cols-3 gap-2" aria-label="التشغيل">
            <Stat label="وصلوا" value={kpis.operational.arrived} />
            <Stat label="أُنجزت" value={kpis.operational.done} />
            <Stat
              label="ما تزال مفتوحة"
              value={kpis.operational.stillOpen}
              tone={kpis.operational.stillOpen > 0 ? "warn" : "calm"}
            />
            <Stat label="مرضى جدد" value={kpis.operational.newPatients} />
            <Stat
              label="لم يحضروا"
              value={kpis.operational.noShow}
              tone={kpis.operational.noShow > 0 ? "warn" : "calm"}
            />
            <Stat
              label="إشغال الكراسي"
              value={`${kpis.occupancy.percent}%`}
              hint={`${kpis.occupancy.chairs} كرسي · ${kpis.occupancy.activeDays} يوم عمل`}
            />
          </section>

          {/* التنبيهات من الدوالّ نفسها التي تُغذّي عدّادات القشرة — لا رقمٌ ثانٍ. */}
          <section className="mb-4 grid grid-cols-3 gap-2" aria-label="ما يحتاج تصرّفًا">
            <Stat
              label="تقويمٌ تأخّر"
              value={kpis.operational.orthoOverdue}
              tone={kpis.operational.orthoOverdue > 0 ? "bad" : "calm"}
              hint={`${kpis.operational.orthoActive} حالة نشطة`}
            />
            <Stat
              label="مخزونٌ ينبّه"
              value={kpis.operational.inventoryAlerts}
              tone={kpis.operational.inventoryAlerts > 0 ? "warn" : "calm"}
            />
            <Stat
              label="مختبرٌ متأخّر"
              value={kpis.operational.labLate}
              tone={kpis.operational.labLate > 0 ? "bad" : "calm"}
            />
          </section>

          {kpis.income.expenses.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="المصروفات">
              <h2 className="mb-2 text-sm font-bold text-navy-900">أين ذهب المصروف</h2>
              <ul className="space-y-1">
                {kpis.income.expenses.map((expense) => (
                  <li key={expense.code} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                    <span className="min-w-0 truncate">{expense.name}</span>
                    <span className="shrink-0 font-bold">{money(expense.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
