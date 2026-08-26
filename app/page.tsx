"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chairRows,
  daySummary,
  firstFreeChair,
  waitingRows,
  type Visit,
  type WaitLevel,
} from "@/lib/flow";

/**
 * شاشة واحدة، عمدًا.
 *
 * النظام الأساسي يملك شاشة تشغيل يومي فيها ثمانية تبويبات، ولم يستخدمها المالك قط.
 * السبب المعلن: ميزات ناقصة وتضارب. فالرهان هنا معاكس تمامًا — شاشة واحدة تُتعلَّم في
 * دقيقة: اكتب اسمًا، اضغط «وصل»، ثم اضغط كرسيًا. لا قوائم ولا إعدادات ولا تدريب.
 */

const CHAIR_COUNT = Number(process.env.NEXT_PUBLIC_CHAIR_COUNT || 2);
const REFRESH_MS = 20_000;

const LEVEL_STYLES: Record<WaitLevel, string> = {
  calm: "border-slate-200 bg-white",
  warning: "border-amber-300 bg-amber-50",
  critical: "border-red-300 bg-red-50",
};
const LEVEL_BADGE: Record<WaitLevel, string> = {
  calm: "bg-slate-100 text-slate-600",
  warning: "bg-amber-200 text-amber-900",
  critical: "bg-red-500 text-white",
};

export default function FlowBoard() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await fetch("/api/visits", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setVisits(payload as Visit[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  // الأرقام تتقدّم كل عشر ثوانٍ بلا طلب شبكة: مدة الانتظار حساب محلي، وإعادة تحميلها
  // من الخادم كل ثانية كانت ستُثقل الاتصال بلا فائدة. القائمة نفسها تُحدَّث كل عشرين ثانية.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 10_000);
    const poll = setInterval(() => { void load(false); }, REFRESH_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load]);

  const waiting = useMemo(() => waitingRows(visits, now), [visits, now]);
  const chairs = useMemo(() => chairRows(CHAIR_COUNT, visits, now), [visits, now]);
  const summary = useMemo(() => daySummary(CHAIR_COUNT, visits, now), [visits, now]);
  const freeChair = useMemo(() => firstFreeChair(CHAIR_COUNT, visits), [visits]);

  // كل إجراء يمرّ من هنا: قفل واحد يمنع الضغط المزدوج على جهاز، والخادم يمنع
  // التعارض بين جهازين. الاثنان لازمان — الاستقبال على الشاشة والطبيب على هاتفه.
  const act = useCallback(async (run: () => Promise<Response>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await run();
      const payload = await response.json().catch(() => null);
      if (!response.ok) setError(payload?.message ?? "تعذّر تنفيذ الإجراء.");
      else setError(null);
      await load(false);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [load]);

  const addPatient = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await act(() => fetch("/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientName: trimmed, patientPhone: phone.trim() }),
    }));
    setName("");
    setPhone("");
  }, [act, name, phone]);

  const seat = useCallback((id: number, chair: number) => act(() => fetch(`/api/visits/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "seat", chair }),
  })), [act]);

  const finish = useCallback((id: number) => act(() => fetch(`/api/visits/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finish" }),
  })), [act]);

  return (
    <main className="mx-auto max-w-5xl p-4 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-extrabold">انسياب العيادة</h1>
        <p className="text-xs text-slate-500">مركز الدكتور عقلان الكامل لتقويم وزراعة وتجميل الأسنان</p>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-2" aria-label="ملخص اليوم">
        <Stat label="ينتظرون الآن" value={summary.waiting} tone={summary.waiting > 0 ? "warn" : "calm"} />
        <Stat
          label="أطول انتظار"
          value={`${summary.longestWaitMinutes} د`}
          tone={summary.longestWaitMinutes >= 30 ? "bad" : summary.longestWaitMinutes >= 15 ? "warn" : "calm"}
        />
        <Stat label="كراسٍ فارغة" value={summary.freeChairs} tone={summary.freeChairs > 0 && summary.waiting > 0 ? "bad" : "calm"} />
      </section>

      {summary.freeChairs > 0 && summary.waiting > 0 ? (
        <p className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          كرسي فارغ ومريض ينتظر. أدخِل التالي الآن.
        </p>
      ) : null}

      <form onSubmit={addPatient} className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold">وصل مريض</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="اسم المريض"
            aria-label="اسم المريض"
            className="min-w-[180px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="الهاتف (اختياري)"
            aria-label="هاتف المريض"
            inputMode="tel"
            className="w-40 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-xl bg-brand-orange px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            وصل
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="mb-5" aria-label="الكراسي">
        <h2 className="mb-2 text-sm font-bold">الكراسي</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {chairs.map((chair) => (
            <div key={chair.chair} className={`rounded-2xl border p-4 ${chair.occupant ? "border-brand-blue bg-white" : "border-dashed border-slate-300 bg-slate-50"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">كرسي {chair.chair}</span>
                {chair.occupant ? (
                  <span className="rounded-full bg-brand-blue px-2 py-0.5 text-[11px] font-bold text-white">{chair.busyMinutes} د</span>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-600">فارغ</span>
                )}
              </div>
              {chair.occupant ? (
                <>
                  <p className="mt-1 truncate text-base font-extrabold">{chair.occupant.patientName}</p>
                  <button
                    onClick={() => finish(chair.occupant!.id)}
                    disabled={busy}
                    className="mt-3 w-full rounded-xl border border-slate-200 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    انتهى
                  </button>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-400">لا أحد على هذا الكرسي</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section aria-label="قائمة الانتظار">
        <h2 className="mb-2 text-sm font-bold">قائمة الانتظار ({waiting.length})</h2>
        {loading ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
        ) : waiting.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            لا أحد ينتظر الآن.
          </p>
        ) : (
          <ul className="space-y-2">
            {waiting.map((row) => (
              <li key={row.visit.id} className={`rounded-2xl border p-3 ${LEVEL_STYLES[row.level]}`}>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${LEVEL_BADGE[row.level]}`}>
                    {row.waitedMinutes} د
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-extrabold">{row.visit.patientName}</p>
                    {row.visit.patientPhone ? (
                      <p className="text-xs text-slate-500" dir="ltr">{row.visit.patientPhone}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-1.5">
                    {chairs.map((chair) => (
                      <button
                        key={chair.chair}
                        onClick={() => seat(row.visit.id, chair.chair)}
                        disabled={busy || Boolean(chair.occupant)}
                        className="rounded-xl bg-navy-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-30"
                      >
                        كرسي {chair.chair}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-center text-[11px] text-slate-400">
        {freeChair ? `الكرسي ${freeChair} جاهز` : "الكرسيان مشغولان"} · أُنجز اليوم: {summary.done}
      </p>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "calm" | "warn" | "bad" }) {
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
