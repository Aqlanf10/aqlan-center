"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * البحث عن مريض.
 *
 * السؤال الذي تُسأله الاستقبال عشر مرات في اليوم: «متى كانت آخر زيارة له؟»، «هل عنده
 * موعد؟». بلا هذه الصفحة يُجاب من الذاكرة أو لا يُجاب — وهو ما يجعل المريض يشعر أن
 * العيادة لا تعرفه.
 */

interface Patient { id: number; patientNumber: string; fullName: string; phone: string | null }

export default function PatientsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setResults([]); setSearched(false); return; }
    setSearching(true);
    try {
      const response = await fetch(`/api/patients?q=${encodeURIComponent(term.trim())}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر البحث.");
      setResults(payload as Patient[]);
      setError(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "تعذّر البحث.");
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }, []);

  // بحث بعد توقف الكتابة لا مع كل حرف: طلبٌ لكل حرف يُثقل الاتصال ويعيد نتائج قديمة
  // بعد الجديدة، فتظهر للاستقبال نتيجةُ «مح» بعد أن كتبت «محمد».
  useEffect(() => {
    const timer = setTimeout(() => { void search(query); }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-extrabold leading-tight">المرضى</h1>
        <p className="text-xs text-slate-500">ابحث بالاسم أو رقم الجوال</p>
      </header>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="اسم المريض أو رقمه"
        aria-label="بحث عن مريض"
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-brand-blue"
        autoFocus
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {query.trim().length < 2 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          اكتب حرفين فأكثر للبحث.
        </p>
      ) : searching && results.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ البحث…</p>
      ) : results.length === 0 && searched ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          لا يوجد مريض بهذا الاسم. يُنشأ السجل تلقائيًا عند حجز موعد أو جلسة قادمة.
        </p>
      ) : (
        <ul className="space-y-2">
          {results.map((patient) => (
            <li key={patient.id}>
              <a
                href={`/patients/${patient.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-extrabold">{patient.fullName}</span>
                  {patient.phone ? (
                    <span className="block text-xs text-slate-500" dir="ltr">{patient.phone}</span>
                  ) : (
                    <span className="block text-xs text-amber-600">بلا رقم — لا يمكن تذكيره</span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-bold text-slate-400">{patient.patientNumber}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
