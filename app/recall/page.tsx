"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClinicName, useSetting, useClinicTimeZone } from "@/components/SettingsProvider";
import { friendlyDateLong, toWhatsAppNumber } from "@/lib/reminders";
import { clinicDateString } from "@/lib/schedule";
import type { OpenAppointment } from "@/lib/openAppointments";
import {
  LAPSE_LABEL,
  LAPSE_OPTIONS,
  recallText,
  sinceText,
  type LapseWeeks,
  type RecallRow,
} from "@/lib/recall";
import { PageHeader } from "@/components/PageHeader";

/**
 * من يجب الاتصال به اليوم.
 *
 * سبب وجود الصفحة بكلمات المالك: «بدي تتشوه سمعتنا أنه ما في أي اهتمام ولا تواصل».
 * وهذه ليست مشكلة برمجية — إنها مكالمة لم تُجرَ. الصفحة لا تفعل أكثر من أن تقول:
 * هؤلاء بالاسم، وهذا نصّ الرسالة، وهذا زر يفتح واتساب.
 *
 * وكل متابعة تُسجَّل، فلا يُتصل بأحد مرتين ولا يُنسى أحد.
 */

interface RecallFeed {
  missed: RecallRow[]; lapsed: RecallRow[]; weeks: number;
  /** مواعيدُ مضت ولم يُفصل فيها — تُنتظر قرارًا لا اتصالًا. */
  open: OpenAppointment[];
}

export default function RecallPage() {
  const clinicName = useClinicName();
  const clinicPhone = useSetting("clinic.phone");
  const [feed, setFeed] = useState<RecallFeed>({ missed: [], lapsed: [], weeks: 6, open: [] });
  const [weeks, setWeeks] = useState<LapseWeeks>(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const clinicZone = useClinicTimeZone();
  const today = useMemo(() => clinicDateString(new Date(), clinicZone), [clinicZone]);

  const load = useCallback(async (targetWeeks: number, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await fetch(`/api/recall?weeks=${targetWeeks}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setFeed(payload as RecallFeed);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(weeks, true); }, [weeks, load]);

  const markDone = useCallback(async (row: RecallRow) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: row.kind, id: row.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setError(payload?.message ?? "تعذّر التسجيل.");
      else setError(null);
      await load(weeks);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [load, weeks]);

  /**
   * يُغلق موعدًا معلّقًا بقرار المستعمِل — **ولا يُخمّن النظام**.
   *
   * فهو لا يعرف أحضر المريض ونُسي تسجيله أم تغيّب؛ يعرف أنّ أحدًا لم يقرّر.
   * و«لم يحضر» تُدخله قائمةَ المتغيّبين فوقها، فيُتّصل به. و«حضر» تُغلقه بلا
   * اتصال — ولا تُنشئ زيارةً بأثرٍ رجعيّ: يومُها مضى، وزيارةٌ تُفتح اليوم عن
   * عملٍ وقع الأسبوع الماضي تُفسد تقرير اليوم وعمولةَ يومه.
   */
  const closeOpen = useCallback(async (appointmentId: number, action: "arrive" | "no_show") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action === "arrive" ? "done" : "no_show" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setError(payload?.message ?? "تعذّر الإغلاق.");
      else setError(null);
      await load(weeks);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [load, weeks]);

  const total = feed.missed.length + feed.lapsed.length;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader
        title="المتابعة والاستدعاء"
        subtitle="من يجب الاتصال به — الأقدم أولًا"
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : (
        <>
          {/*
            * ── مواعيد لم تُغلَق ──
            *
            * وموضعُها **فوق المتغيّبين** لأنّها تسبقهم: موعدٌ معلّق لا يدخل قائمة
            * المتغيّبين حتى يُقال إنّه غياب. فما دام معلّقًا لا يُتّصل بصاحبه أبدًا.
            */}
          {feed.open.length > 0 ? (
            <section className="mb-6" aria-label="مواعيد لم تُغلَق">
              <h2 className="mb-1 text-sm font-bold">
                مواعيد مضت ولم تُغلَق ({feed.open.length})
              </h2>
              <p className="mb-2 text-[11px] font-bold leading-5 text-slate-600">
                مضى يومُها ولم يُسجَّل وصولُ صاحبها ولا غيابُه. <span className="text-amber-800">وما دامت
                معلّقة لا يدخل صاحبها قائمة المتغيّبين ولا يتّصل به أحد.</span> والنظام لا يعرف
                أيّهما وقع — فقرِّر أنت.
              </p>
              <ul className="space-y-2">
                {feed.open.map((row) => (
                  <li key={`open-${row.appointmentId}`} className="rounded-2xl border border-slate-300 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-extrabold text-slate-700">
                        {row.daysAgo === 1 ? "منذ يوم" : `منذ ${row.daysAgo} يومًا`}
                      </span>
                      <div className="min-w-[9rem] flex-1">
                        <a href={`/patients/${row.patientId}`}
                          className="block truncate text-base font-extrabold underline decoration-slate-300 underline-offset-4">
                          {row.patientName}
                        </a>
                        <p className="text-[11px] text-slate-500">
                          موعد {friendlyDateLong(row.scheduledDate)} · <span dir="ltr">{row.scheduledTime}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" disabled={busy}
                          onClick={() => void closeOpen(row.appointmentId, "arrive")}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-800 disabled:opacity-40">
                          حضر ولم يُسجَّل
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => void closeOpen(row.appointmentId, "no_show")}
                          className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-40">
                          لم يحضر
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mb-6" aria-label="متغيّبون">
            <h2 className="mb-2 text-sm font-bold">
              لم يحضروا مواعيدهم ({feed.missed.length})
            </h2>
            {feed.missed.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">
                لا أحد بانتظار متابعة غياب.
              </p>
            ) : (
              <ul className="space-y-2">
                {feed.missed.map((row) => (
                  <RecallCard key={`missed-${row.id}`} row={row} today={today} busy={busy} onDone={markDone}
                    clinicName={clinicName} clinicPhone={clinicPhone} />
                ))}
              </ul>
            )}
          </section>

          <section aria-label="منقطعون">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold">انقطعوا عن المتابعة ({feed.lapsed.length})</h2>
              <div className="flex gap-1.5">
                {LAPSE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    onClick={() => setWeeks(option)}
                    className={`rounded-xl border px-2.5 py-1 text-[11px] font-bold ${
                      weeks === option ? "border-navy-800 bg-navy-800 text-white" : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {LAPSE_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>
            {feed.lapsed.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">
                لا يوجد منقطعون بهذه المدة.
              </p>
            ) : (
              <ul className="space-y-2">
                {feed.lapsed.map((row) => (
                  <RecallCard key={`lapsed-${row.id}`} row={row} today={today} busy={busy} onDone={markDone}
                    clinicName={clinicName} clinicPhone={clinicPhone} />
                ))}
              </ul>
            )}
          </section>

          {total === 0 ? (
            <p className="mt-6 text-center text-[11px] text-slate-400">
              لا أحد ينتظر اتصالًا. هذا هو الوضع الذي نريده.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}

function RecallCard({ row, today, busy, onDone, clinicName, clinicPhone }: {
  row: RecallRow;
  today: string;
  busy: boolean;
  onDone: (row: RecallRow) => void;
  clinicName: string;
  clinicPhone: string;
}) {
  const number = toWhatsAppNumber(row.patientPhone);
  const since = sinceText(row.referenceDate, today);

  // رسالة الغياب تختلف عن رسالة الانقطاع: الأولى عن موعد بعينه، والثانية عن علاج توقّف.
  const text = row.kind === "missed"
    ? [
        `السلام عليكم ${row.patientName}،`,
        ``,
        `افتقدناكم في موعدكم ${friendlyDateLong(row.referenceDate)} في ${clinicName}.`,
        `نأمل أن يكون المانع خيرًا، ونودّ ترتيب موعد جديد يناسبكم.`,
        ``,
        `للتواصل: ${clinicPhone}`,
      ].join("\n")
    : recallText({
        patientName: row.patientName,
        sinceText: since,
        clinicName,
        clinicPhone,
      });

  return (
    <li className={`rounded-2xl border p-3 ${row.kind === "missed" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[10rem] flex-1">
          <a href={`/patients/${row.patientId}`} className="block truncate text-base font-extrabold underline decoration-slate-300 underline-offset-4">
            {row.patientName}
          </a>
          <p className="text-xs text-slate-500">
            {row.kind === "missed" ? `تغيّب عن موعد ${friendlyDateLong(row.referenceDate)}` : `آخر متابعة ${since}`}
          </p>
          {row.note ? <p className="mt-1 text-xs text-slate-600">{row.note}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {number ? (
            <a
              href={`https://wa.me/${number}?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noopener"
              onClick={() => onDone(row)}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
            >
              واتساب
            </a>
          ) : (
            <span className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-amber-600">
              بلا رقم
            </span>
          )}
          <button
            onClick={() => onDone(row)}
            disabled={busy}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40"
          >
            تمّت المتابعة
          </button>
        </div>
      </div>
    </li>
  );
}
