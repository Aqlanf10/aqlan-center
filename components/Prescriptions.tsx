"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "./SessionProvider";
import { canTreat } from "@/lib/roles";
import { friendlyDateLong } from "@/lib/reminders";
import {
  INSTRUCTIONS_LANG_TEXT, MAX_ITEMS,
  type InstructionsLang, type RxItem,
} from "@/lib/prescription";

/**
 * الوصفات في ملف المريض — كتابةً وإصدارًا وإبطالًا.
 *
 * والشاشة مبنيّةٌ على أنّ **الإصدار نهائي**: ما دام السطر مسوّدةً على الشاشة
 * يُعدَّل ويُحذف، فإذا صدر خرج من يد من كتبه. فزرّ الإصدار يقول ذلك صراحةً،
 * ولا يُصدَّر شيء بنقرةٍ واحدة بلا مراجعة.
 *
 * والمقترحات من وصفاتٍ سابقة لا من قائمةٍ ثابتة: قائمةٌ ثابتة تشيخ ولا تعرف ما
 * يصفه هذا الطبيب، والمشتقّة تتعلّم من عمله فيقلّ النقر مع الأيام.
 */

interface Prescription {
  id: number;
  visitId: number | null;
  diagnosis: string;
  notes: string;
  instructionsLang: InstructionsLang;
  items: RxItem[];
  issuedBy: string;
  issuedAt: string;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

const EMPTY: RxItem = {
  name: "", dose: "", form: "", frequency: "", duration: "",
  instructions: "", instructionsEn: "",
};

export function Prescriptions({ patientId, visitId = null }: {
  patientId: number;
  visitId?: number | null;
}) {
  const session = useSession();
  const allowed = canTreat(session?.role);

  const [list, setList] = useState<Prescription[]>([]);
  const [suggestions, setSuggestions] = useState<RxItem[]>([]);
  const [writing, setWriting] = useState(false);
  const [items, setItems] = useState<RxItem[]>([{ ...EMPTY }]);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [lang, setLang] = useState<InstructionsLang>("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const response = await fetch(`/api/patients/${patientId}/prescriptions`, { cache: "no-store" });
      const body = await response.json();
      if (response.ok) setList(body.prescriptions ?? []);
    } catch { /* الشبكة — تُعاد المحاولة بفتح الشاشة */ }
  }, [allowed, patientId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!writing || !allowed) return;
    void (async () => {
      try {
        const response = await fetch("/api/prescriptions/suggestions", { cache: "no-store" });
        const body = await response.json();
        if (response.ok) setSuggestions(body.items ?? []);
      } catch { /* المقترحات تحسينٌ لا شرط */ }
    })();
  }, [writing, allowed]);

  if (!allowed) return null;

  const setItem = (index: number, patch: Partial<RxItem>) =>
    setItems((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));

  /*
   * اختيارُ مقترحٍ يملأ السطر كلَّه لا الاسم وحده.
   *
   * فالجرعة والتكرار والتعليمات هي ما يستغرق الوقت، وهي نفسها في الغالب —
   * وتركُها فارغةً بعد اختيار الاسم يجعل المقترح بلا فائدة.
   */
  const applySuggestion = (index: number, name: string) => {
    const found = suggestions.find((one) => one.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    setItem(index, found ? { ...found } : { name });
  };

  const issue = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/patients/${patientId}/prescriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId, diagnosis, notes, instructionsLang: lang, items }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "تعذّر حفظ الوصفة."); return; }
      setWriting(false);
      setItems([{ ...EMPTY }]);
      setDiagnosis(""); setNotes(""); setLang("both");
      await load();
      // تُفتح الورقة فورًا: الوصفة تُكتب لتُطبع، والخطوة التالية هي الطباعة.
      window.open(`/print/prescription/${body.id}`, "_blank", "noreferrer");
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  const voidOne = async (id: number) => {
    const reason = window.prompt("سبب إبطال الوصفة — يبقى في السجل ويُقرأ بعد سنة:");
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/prescriptions/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "تعذّر الإبطال."); return; }
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="الوصفات الطبية">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-navy-900">الوصفات الطبية</h3>
        <button
          onClick={() => setWriting((open) => !open)}
          className="rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-bold text-white"
        >
          {writing ? "إغلاق" : "وصفة جديدة"}
        </button>
      </div>

      {error ? (
        <p className="mb-2 rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-900">
          {error}
        </p>
      ) : null}

      {writing ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <datalist id="rx-suggestions">
            {suggestions.map((one) => <option key={one.name} value={one.name} />)}
          </datalist>

          <label className="block text-xs font-bold text-slate-600">
            التشخيص
            <input
              value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>

          {items.map((item, index) => (
            <div key={index} className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-navy-900">دواء {index + 1}</span>
                {items.length > 1 ? (
                  <button
                    onClick={() => setItems((current) => current.filter((_, at) => at !== index))}
                    className="text-xs font-bold text-danger-700 underline"
                  >
                    حذف
                  </button>
                ) : null}
              </div>
              <input
                list="rx-suggestions" dir="ltr" placeholder="Drug name"
                value={item.name}
                onChange={(event) => applySuggestion(index, event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input dir="ltr" placeholder="Dose — 500mg" value={item.dose}
                  onChange={(event) => setItem(index, { dose: event.target.value })}
                  className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
                <input dir="ltr" placeholder="Form — Tablets" value={item.form}
                  onChange={(event) => setItem(index, { form: event.target.value })}
                  className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
                <input dir="ltr" placeholder="1 tablet every 8 hours" value={item.frequency}
                  onChange={(event) => setItem(index, { frequency: event.target.value })}
                  className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
                <input dir="ltr" placeholder="5 days" value={item.duration}
                  onChange={(event) => setItem(index, { duration: event.target.value })}
                  className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
              </div>
              <input placeholder="تعليمات المريض بالعربية" value={item.instructions}
                onChange={(event) => setItem(index, { instructions: event.target.value })}
                className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
              <input dir="ltr" placeholder="Patient instructions in English" value={item.instructionsEn}
                onChange={(event) => setItem(index, { instructionsEn: event.target.value })}
                className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
          ))}

          {items.length < MAX_ITEMS ? (
            <button
              onClick={() => setItems((current) => [...current, { ...EMPTY }])}
              className="rounded-xl border border-navy-800 bg-white px-3 py-1.5 text-xs font-bold text-navy-900"
            >
              أضف دواءً
            </button>
          ) : null}

          <label className="block text-xs font-bold text-slate-600">
            تعليمات المريض تُطبع
            <select
              value={lang} onChange={(event) => setLang(event.target.value as InstructionsLang)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
            >
              {(["both", "ar", "en"] as InstructionsLang[]).map((one) => (
                <option key={one} value={one}>{INSTRUCTIONS_LANG_TEXT[one].ar}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold text-slate-600">
            إرشادات إضافية
            <input value={notes} onChange={(event) => setNotes(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>

          {/* الإصدار نهائي — والزرّ يقول ذلك قبل الضغط لا بعده. */}
          <p className="text-[11px] font-bold text-amber-800">
            بعد الإصدار لا تُعدَّل الوصفة — تُبطَل بسببٍ وتُكتب غيرها.
          </p>
          <button
            onClick={() => void issue()} disabled={busy}
            className="w-full rounded-xl bg-navy-900 px-3 py-2 text-sm font-extrabold text-white disabled:opacity-40"
          >
            إصدار الوصفة وطباعتها
          </button>
        </div>
      ) : null}

      {list.length === 0 ? (
        <p className="text-xs text-slate-400">لا وصفات في هذا الملف.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((rx) => (
            <li key={rx.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-navy-900">
                  {friendlyDateLong(rx.issuedAt.slice(0, 10))} · {rx.issuedBy}
                  {rx.voidedAt ? <span className="text-danger-700"> · مُبطَلة</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <a
                    href={`/print/prescription/${rx.id}`} target="_blank" rel="noreferrer"
                    className="text-xs font-bold text-navy-900 underline"
                  >
                    الورقة
                  </a>
                  {rx.voidedAt ? null : (
                    <button
                      onClick={() => void voidOne(rx.id)} disabled={busy}
                      className="text-xs font-bold text-danger-700 underline disabled:opacity-40"
                    >
                      إبطال
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-600" dir="ltr">
                {rx.items.map((one) => one.name).join(" · ")}
              </p>
              {rx.voidReason ? (
                <p className="mt-1 text-[11px] font-bold text-danger-800">سبب الإبطال: {rx.voidReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
