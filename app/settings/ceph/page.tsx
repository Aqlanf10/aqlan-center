"use client";

import { useCallback, useEffect, useState } from "react";
import { NORM_LABEL, formatMeasurement } from "@/lib/ceph";
import { PageHeader } from "@/components/PageHeader";
import { settingsTabs } from "@/lib/settingsNav";

/**
 * المعايير السيفالومترية.
 *
 * كانت مكتوبةً في الكود: متوسّطٌ وانحرافٌ لكل قياس، بلا عمرٍ ولا جنسٍ ولا مجتمع.
 * فكان معيارُ ستاينر المأخوذ من مجتمعٍ آخر يحكم على كل مريضٍ في تعز، ولا سبيل إلى
 * تغييره إلا بنشرةٍ جديدة من البرنامج.
 *
 * والقيم هنا **افتراضٌ موثَّق لا حكمٌ نهائي**: لكلٍّ مرجعه مكتوبًا، وللمالك أن
 * يعدّله متى جمع بيانات مرضاه. ولا يُقبل رقمٌ بلا مرجع — رقمٌ لا يُعرف من أين جاء
 * لا يُراجَع، ويُبنى عليه علاجُ سنتين.
 */

interface ReferenceValue {
  measurement: string; mean: number; tolerance: number; source: string;
}
interface ReferenceSet {
  id: number; name: string; source: string; note: string | null;
  isDefault: boolean; archived: boolean; values: ReferenceValue[];
}

export default function CephNormsPage() {
  const [sets, setSets] = useState<ReferenceSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ mean: "", tolerance: "", source: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ceph/reference", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setSets(payload.sets ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = sets.find((set) => set.isDefault) ?? sets[0] ?? null;

  const save = async (measurement: string) => {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ceph/reference", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setId: active.id, measurement,
          mean: Number(form.mean), tolerance: Number(form.tolerance), source: form.source,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر الحفظ.");
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذّر الحفظ.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-4">
      <PageHeader
        title="المعايير السيفالومترية"
        subtitle="القيم التي يُحكم بها على قياسات المريض — مأخوذة من مجتمعاتٍ غير يمنية، فتُقرأ مع الوجه لا وحدها"
        links={settingsTabs("/settings/ceph")}
      />

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : !active ? (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">لا مجموعة مرجعية.</p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-navy-200 bg-navy-50 p-3">
            <p className="text-sm font-extrabold text-navy-900">{active.name}</p>
            <p className="mt-0.5 text-[11px] font-bold text-navy-700" dir="ltr">{active.source}</p>
            {active.note ? <p className="mt-1 text-[11px] leading-5 text-navy-800">{active.note}</p> : null}
          </div>

          <ul className="mt-3 space-y-2">
            {active.values.map((value) => {
              const label = NORM_LABEL[value.measurement];
              const open = editing === value.measurement;
              return (
                <li key={value.measurement} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-navy-900" dir="ltr">
                        {label?.name ?? value.measurement}
                      </p>
                      <p className="text-[11px] text-slate-500">{label ? label.meaning.ar : "—"}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-extrabold text-navy-900" dir="ltr">
                        {formatMeasurement(value.mean, label?.unit ?? "deg")} ± {value.tolerance}
                      </p>
                      <p className="text-[10px] text-slate-400" dir="ltr">{value.source}</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditing(open ? null : value.measurement);
                        setForm({ mean: String(value.mean), tolerance: String(value.tolerance), source: value.source });
                      }}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
                      {open ? "إلغاء" : "عدّل"}
                    </button>
                  </div>

                  {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="block text-[10px] font-bold text-slate-500">
                        المتوسط
                        <input value={form.mean} inputMode="decimal" dir="ltr"
                          onChange={(event) => setForm((current) => ({ ...current, mean: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-blue" />
                      </label>
                      <label className="block text-[10px] font-bold text-slate-500">
                        الانحراف
                        <input value={form.tolerance} inputMode="decimal" dir="ltr"
                          onChange={(event) => setForm((current) => ({ ...current, tolerance: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-blue" />
                      </label>
                      <label className="block text-[10px] font-bold text-slate-500">
                        المرجع
                        <input value={form.source}
                          onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-blue" />
                      </label>
                      <div className="sm:col-span-3">
                        <button onClick={() => void save(value.measurement)} disabled={busy}
                          className="rounded-xl bg-navy-900 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-40">
                          احفظ المعيار
                        </button>
                        <span className="ms-2 text-[10px] text-slate-400">
                          يُسجَّل التغيير باسمك في سجلّ التدقيق — تغييرُ معيارٍ يُعيد الحكم على كل تحليلٍ يُقرأ بعده.
                        </span>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
