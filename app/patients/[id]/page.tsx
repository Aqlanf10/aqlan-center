"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import type { Visit } from "@/lib/flow";
import type { Appointment } from "@/lib/schedule";
import { friendlyDate, friendlyDateLong, friendlyTime, toWhatsAppNumber } from "@/lib/reminders";

/**
 * ملف المريض.
 *
 * كل ما تحتاجه الاستقبال أن تعرفه عن مريض واقف أمامها، في شاشة واحدة: رقمه، آخر
 * زيارة، الموعد القادم، وملاحظة تُكتب مرة وتُقرأ في كل زيارة بعدها («يخاف الإبرة»،
 * «سكري»، «يتأخر دائمًا فاحجز له آخر الدوام»). هذه الملاحظة هي الفرق بين عيادة تعرف
 * مريضها وعيادة يبدأ فيها كل شيء من الصفر في كل زيارة.
 */

interface PatientFile {
  patient: {
    id: number; patientNumber: string; fullName: string;
    phone: string | null; note: string | null; createdAt: string;
  };
  visits: Visit[];
  appointments: Appointment[];
}

const STATUS_LABEL: Record<string, string> = {
  booked: "محجوز", arrived: "وصل", done: "تم", cancelled: "ملغى", no_show: "لم يحضر",
};

function dateOnly(iso: string): string {
  const parsed = new Date(iso);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

export default function PatientFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [file, setFile] = useState<PatientFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/patients/${id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      const loaded = payload as PatientFile;
      setFile(loaded);
      setNote(loaded.patient.note ?? "");
      setPhone(loaded.patient.phone ?? "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/patients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, phone }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.message ?? "تعذّر الحفظ.");
        return;
      }
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setSaving(false);
    }
  }, [id, note, phone, saving, load]);

  const lastVisit = file?.visits[0] ?? null;
  const upcoming = useMemo(() => {
    if (!file) return null;
    const today = dateOnly(new Date().toISOString());
    // الأقرب من القادمة لا الأحدث في القائمة: القائمة مرتّبة تنازليًا للتاريخ.
    return [...file.appointments]
      .filter((a) => a.scheduledDate >= today && (a.status === "booked" || a.status === "arrived"))
      .sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime))[0] ?? null;
  }, [file]);

  const whatsApp = file?.patient.phone ? toWhatsAppNumber(file.patient.phone) : null;

  if (loading) {
    return <main className="mx-auto max-w-3xl p-4"><p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p></main>;
  }
  if (!file) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">{error ?? "لا يوجد مريض بهذا الرقم."}</p>
        <a href="/patients" className="mt-4 block text-center text-sm font-bold text-brand-blue">العودة للبحث</a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-extrabold">{file.patient.fullName}</h1>
        <p className="text-xs text-slate-500">
          {file.patient.patientNumber} · مسجّل منذ {friendlyDateLong(dateOnly(file.patient.createdAt))}
        </p>
        <nav className="mt-2 flex flex-wrap gap-1.5">
          <a href="/patients" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800">بحث</a>
          <a href="/" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800">اللوحة</a>
          <a href="/appointments" className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800">المواعيد</a>
          {whatsApp ? (
            <a
              href={`https://wa.me/${whatsApp}`}
              target="_blank"
              rel="noopener"
              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
            >
              واتساب
            </a>
          ) : null}
        </nav>
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="mb-4 grid grid-cols-2 gap-2" aria-label="ملخص">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-sm font-extrabold">
            {lastVisit ? friendlyDate(dateOnly(lastVisit.arrivedAt)) : "لا توجد"}
          </p>
          <p className="text-[11px] font-bold text-slate-500">آخر زيارة</p>
        </div>
        <div className={`rounded-2xl border p-3 text-center ${upcoming ? "border-brand-blue bg-white" : "border-amber-300 bg-amber-50"}`}>
          <p className="text-sm font-extrabold">
            {upcoming ? `${friendlyDate(upcoming.scheduledDate)} · ${friendlyTime(upcoming.scheduledTime)}` : "لا يوجد موعد قادم"}
          </p>
          <p className="text-[11px] font-bold text-slate-500">الموعد القادم</p>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4" aria-label="بيانات وملاحظات">
        <label className="mb-1 block text-sm font-bold" htmlFor="phone">رقم الجوال</label>
        <input
          id="phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          dir="ltr"
          inputMode="tel"
          className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
        />
        <label className="mb-1 block text-sm font-bold" htmlFor="note">ملاحظة دائمة</label>
        <textarea
          id="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="تُقرأ في كل زيارة — مثل: حساسية بنج، يخاف الإبرة، يفضّل آخر الدوام"
          className="mb-3 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-navy-800 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ…" : saved ? "حُفظ ✓" : "حفظ"}
        </button>
      </section>

      <section className="mb-5" aria-label="المواعيد">
        <h2 className="mb-2 text-sm font-bold">المواعيد ({file.appointments.length})</h2>
        {file.appointments.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">لا توجد مواعيد.</p>
        ) : (
          <ul className="space-y-2">
            {file.appointments.map((appointment) => (
              <li key={appointment.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                <span className="text-sm font-bold">
                  {friendlyDateLong(appointment.scheduledDate)} · {friendlyTime(appointment.scheduledTime)}
                </span>
                <span className="text-xs text-slate-500">
                  {appointment.durationMinutes} د · {STATUS_LABEL[appointment.status] ?? appointment.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="الزيارات">
        <h2 className="mb-2 text-sm font-bold">الزيارات ({file.visits.length})</h2>
        {file.visits.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">
            لا توجد زيارات مسجّلة بهذا السجل.
          </p>
        ) : (
          <ul className="space-y-2">
            {file.visits.map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                <span className="text-sm font-bold">{friendlyDateLong(dateOnly(visit.arrivedAt))}</span>
                <span className="text-xs text-slate-500">
                  {visit.status === "done" ? "اكتملت" : "لم تكتمل"}
                  {visit.chair ? ` · كرسي ${visit.chair}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
