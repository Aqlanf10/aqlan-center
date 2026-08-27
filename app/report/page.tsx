"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CLINIC_NAME } from "@/lib/clinic";
import { friendlyDateLong } from "@/lib/reminders";
import { addDays, clinicDateString, type DayLoad } from "@/lib/schedule";
import { appointmentsCountText, reportText, type DayReport } from "@/lib/report";
import type { LabSummary } from "@/lib/lab";

/**
 * تقرير اليوم.
 *
 * أول رقم صادق عن يوم في هذا المركز: اليوم يُقاس بالانطباع — «كان زحمة» أو «كان
 * هادئًا» — والانطباع لا يُبنى عليه قرار، لا في عدد الكراسي ولا في ساعات الدوام ولا
 * في الاعتذار لمريض انتظر ساعتين.
 *
 * والأرقام قليلة عمدًا: تقرير من عشرين رقمًا لا يُقرأ آخر النهار.
 */

interface ReportFeed {
  date: string;
  nextDate: string;
  report: DayReport;
  tomorrow: DayLoad;
  lab: LabSummary;
  chairs: number;
}

export default function ReportPage() {
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);
  const [date, setDate] = useState(today);
  const [feed, setFeed] = useState<ReportFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/report?date=${target}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setFeed(payload as ReportFeed);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date); }, [date, load]);

  const shareLink = useMemo(() => {
    if (!feed) return null;
    const text = reportText({
      clinicName: CLINIC_NAME,
      dateText: friendlyDateLong(feed.date),
      report: feed.report,
      tomorrowPercent: feed.tomorrow.percent,
      lateLabOrders: feed.lab.late,
    });
    // بلا رقم: واتساب يفتح قائمة جهات الاتصال ليختار المرسِل من يُرسل له.
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [feed]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-extrabold leading-tight">تقرير اليوم</h1>
        <p className="text-xs text-slate-500">{CLINIC_NAME}</p>
        <nav className="mt-2 flex flex-wrap gap-1.5">
          <a href="/" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800">اللوحة</a>
          <a href="/appointments" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800">المواعيد</a>
          <a href="/recall" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800">المتابعة</a>
        </nav>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setDate((current) => addDays(current, -1))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold">اليوم السابق</button>
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="min-w-[9rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
        <button onClick={() => setDate((current) => addDays(current, 1))}
          disabled={date >= today}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:opacity-40">اليوم التالي</button>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {loading || !feed ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : (
        <>
          <p className="mb-3 text-sm font-bold text-slate-600">{friendlyDateLong(feed.date)}</p>

          <section className="mb-4 grid grid-cols-3 gap-2" aria-label="الحضور">
            <Stat label="الحضور" value={feed.report.arrived} />
            <Stat label="اكتملت زيارتهم" value={feed.report.done} />
            <Stat label="لم يحضروا" value={feed.report.noShow} tone={feed.report.noShow > 0 ? "warn" : "calm"} />
          </section>

          <section className="mb-4 grid grid-cols-3 gap-2" aria-label="الانتظار">
            <Stat label="متوسط الانتظار" value={`${feed.report.averageWaitMinutes} د`}
              tone={feed.report.averageWaitMinutes >= 30 ? "bad" : feed.report.averageWaitMinutes >= 15 ? "warn" : "calm"} />
            <Stat label="أطول انتظار" value={`${feed.report.longestWaitMinutes} د`}
              tone={feed.report.longestWaitMinutes >= 45 ? "bad" : feed.report.longestWaitMinutes >= 20 ? "warn" : "calm"} />
            <Stat label="متوسط وقت الكرسي" value={`${feed.report.averageChairMinutes} د`} />
          </section>

          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4" aria-label="الغد والمختبر">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-bold">حِمل الغد ({friendlyDateLong(feed.nextDate)})</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                feed.tomorrow.percent >= 90 ? "bg-red-500 text-white"
                  : feed.tomorrow.percent >= 70 ? "bg-amber-200 text-amber-900"
                  : "bg-slate-100 text-slate-600"
              }`}>
                {feed.tomorrow.percent}٪ · {appointmentsCountText(feed.tomorrow.booked)}
              </span>
            </div>
            {/* الرقم الوحيد الذي ينظر إلى الأمام: معرفة أن الغد ممتلئ الليلة تعني
                إعادة ترتيبه الليلة؛ ومعرفتها صباحًا تعني يومًا آخر منهارًا. */}
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${feed.tomorrow.percent >= 90 ? "bg-red-500" : feed.tomorrow.percent >= 70 ? "bg-amber-400" : "bg-brand-blue"}`}
                style={{ width: `${Math.min(100, feed.tomorrow.percent)}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <a href="/lab" className={`rounded-xl px-3 py-2 font-bold ${feed.lab.late > 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                تراكيب متأخرة: {feed.lab.late}
              </a>
              <a href="/lab" className="rounded-xl bg-slate-100 px-3 py-2 font-bold text-slate-600">
                وصلت ولم تُركّب: {feed.lab.waitingFitting}
              </a>
              {feed.report.unresolved > 0 ? (
                <a href="/appointments" className="rounded-xl bg-amber-50 px-3 py-2 font-bold text-amber-800">
                  مواعيد لم تُغلق: {feed.report.unresolved}
                </a>
              ) : null}
            </div>
          </section>

          {shareLink ? (
            <a
              href={shareLink}
              target="_blank"
              rel="noopener"
              className="block w-full rounded-2xl bg-emerald-600 py-3 text-center text-sm font-extrabold text-white"
            >
              أرسل الملخص بواتساب
            </a>
          ) : null}

          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
            «لم يحضروا» تُحسب من المواعيد المعلّمة كذلك — علّم المتغيّب في صفحة المواعيد
            ليصحّ الرقم وتظهر متابعته في صفحة المتابعة.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone = "calm" }: {
  label: string; value: number | string; tone?: "calm" | "warn" | "bad";
}) {
  const tones = {
    calm: "border-slate-200 bg-white text-navy-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    bad: "border-red-300 bg-red-50 text-red-700",
  } as const;
  return (
    <div className={`rounded-2xl border p-3 text-center ${tones[tone]}`}>
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-[11px] font-bold opacity-70">{label}</p>
    </div>
  );
}
