"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard as Stat } from "@/components/PageHeader";
import { useClinicName } from "@/components/SettingsProvider";
import { friendlyDate } from "@/lib/reminders";
import { toWhatsAppNumber } from "@/lib/reminders";
import { clinicDateString } from "@/lib/schedule";
import {
  ORTHO_DUE_LABEL,
  ORTHO_FILTER_LABEL,
  PHASE_LABEL,
  adjustmentRecallText,
  filterFollowUp,
  followUpSummary,
  type OrthoDue,
  type OrthoFilter,
  type OrthoPhase,
} from "@/lib/ortho";

/**
 * متابعة التقويم — من انقطع عن شدّته.
 *
 * وهذا **تراكمُ التقويم**، ولا شاشة تراه اليوم: مريضٌ تأخّر شهرين لا هو في قائمة
 * الانتظار ولا له موعدٌ فائت يُنبَّه عليه — لأنه ببساطة لم يحجز. فيدرج الأمر:
 * علاجُ ثمانية عشر شهرًا يصير ثلاثين، والمريض يلوم المركز بحق، والكرسي الذي كان
 * له يُشغَل بغيره.
 *
 * وتفتح على **المتأخّرين** لا على «كل الحالات»: قائمةٌ بمئة حالةٍ مرتّبةً بالاسم
 * تُقرأ مرّةً ثم تُهجَر، ومن تأخّر شهرين يقع فيها بين حرفين فلا يُرى.
 */

interface FollowUp {
  id: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  status: "active" | "retention" | "completed" | "discontinued";
  phase: OrthoPhase;
  dueOn: string;
  due: OrthoDue;
  lateDays: number;
  lastAdjustment: string | null;
  daysSinceLast: number | null;
  upperWire: string | null;
  lowerWire: string | null;
}

const FILTERS: OrthoFilter[] = ["overdue", "week", "active", "retention"];

const DUE_STYLE: Record<OrthoDue, string> = {
  overdue: "border-danger-300 bg-danger-50 text-danger-900",
  due: "border-warning-300 bg-warning-50 text-warning-900",
  soon: "border-slate-200 bg-white text-navy-900",
  later: "border-slate-200 bg-white text-navy-900",
};

export default function OrthoFollowUpPage() {
  const clinicName = useClinicName();
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);
  const [cases, setCases] = useState<FollowUp[]>([]);
  const [filter, setFilter] = useState<OrthoFilter>("overdue");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await fetch("/api/ortho?followup=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setCases(payload.cases as FollowUp[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  // الشاشة تبقى مفتوحة والاستقبال تتصل منها: ما يُسجَّل على الكرسي يجب أن يختفي
  // من القائمة بلا أن تُحدَّث يدويًا، وإلا اتُّصل بمن شُدّ للتوّ.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(false); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const summary = useMemo(() => followUpSummary(cases), [cases]);
  const visible = useMemo(() => filterFollowUp(cases, filter), [cases, filter]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader title="متابعة التقويم" subtitle="من تأخّر عن شدّته — الأطول انقطاعًا أولًا" />

      <section className="mb-4 grid grid-cols-3 gap-2" aria-label="ملخص المتابعة">
        <Stat label="تأخّرت" value={summary.overdue} tone={summary.overdue > 0 ? "bad" : "calm"} />
        <Stat label="هذا الأسبوع" value={summary.dueThisWeek} tone={summary.dueThisWeek > 0 ? "warn" : "calm"} />
        <Stat label="تثبيتٌ يستحقّ" value={summary.retentionDue} tone={summary.retentionDue > 0 ? "warn" : "calm"} />
      </section>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="تصفية المتابعة">
        {FILTERS.map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              filter === option ? "bg-navy-900 text-white" : "border border-slate-200 bg-white text-navy-800"
            }`}
          >
            {ORTHO_FILTER_LABEL[option]}
          </button>
        ))}
      </nav>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
          {filter === "overdue"
            ? "لا حالة تأخّرت عن شدّتها — كلّها في مواعيدها."
            : filter === "retention"
            ? "لا مثبّت يستحقّ المراجعة الآن."
            : "لا حالات في هذه القائمة."}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="حالات المتابعة">
          {visible.map((one) => {
            const number = toWhatsAppNumber(one.patientPhone);
            const message = adjustmentRecallText({
              patientName: one.patientName,
              clinicName,
              dueOn: friendlyDate(one.dueOn),
              lateDays: one.lateDays,
            });
            return (
              <li key={one.id} className={`rounded-2xl border p-3 ${DUE_STYLE[one.due]}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={`/patients/${one.patientId}`} className="block truncate text-sm font-bold underline-offset-2 hover:underline">
                      {one.patientName}
                    </a>
                    <p className="mt-0.5 text-[11px] font-semibold opacity-70">
                      {PHASE_LABEL[one.phase]}
                      {one.status === "retention" ? " · تثبيت" : ""}
                      {one.upperWire ? ` · علوي ${one.upperWire}` : ""}
                      {one.lowerWire ? ` · سفلي ${one.lowerWire}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] font-bold">
                      {ORTHO_DUE_LABEL[one.due]} — موعده {friendlyDate(one.dueOn)}
                      {one.lateDays > 0 ? ` · متأخّر ${one.lateDays} يومًا` : ""}
                    </p>
                    <p className="mt-0.5 text-[10px] font-medium opacity-60">
                      {one.lastAdjustment
                        ? `آخر شدّة ${friendlyDate(one.lastAdjustment)}${
                            one.daysSinceLast !== null ? ` · منذ ${one.daysSinceLast} يومًا` : ""}`
                        : "لم تُسجَّل له شدّةٌ بعد — منذ تركيب الجهاز"}
                    </p>
                  </div>

                  {/* الاتصال من القائمة نفسها: قائمةٌ تُقرأ ثم يُبحث عن الرقم في
                      شاشةٍ أخرى قائمةٌ لا يُعمل بها. */}
                  {number ? (
                    <a
                      href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-xl bg-navy-900 px-3 py-2 text-[11px] font-bold text-white"
                    >
                      ذكّره بواتساب
                    </a>
                  ) : (
                    <span className="shrink-0 text-[10px] font-semibold opacity-50">لا رقم مسجَّل</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
