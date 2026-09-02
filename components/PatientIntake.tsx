"use client";

import { useCallback, useEffect, useState } from "react";
import { INTAKE_CONDITIONS, intakeSummary, type IntakeAnswers } from "@/lib/intake";
import { friendlyDateLong } from "@/lib/reminders";

/**
 * ما قاله المريض عن صحّته — كما قاله.
 *
 * ويُعرض **مفصولًا عن التنبيه الطبي** الأحمر: ذاك حقلُ الطبيب وهذا قولُ المريض،
 * وخلطُهما يجعل نصًّا بلا مراجعةٍ يحمل بشارة الخطر — فيُتجاهل الأحمر حين يصدق.
 * والطبيب يقرأ ما قال المريض، فإن رآه خطرًا نقله بيده إلى التنبيه.
 *
 * ويُعرض **التاريخ كلّه** لا آخره وحده: الفرق بين استمارتين هو متى تغيّرت صحّته.
 */

interface IntakeRow extends IntakeAnswers { id: number; submittedAt: string }

export function PatientIntake({ patientId }: { patientId: number }) {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/patients/${patientId}/intake`, { cache: "no-store" });
      if (response.ok) setRows((await response.json()).intake as IntakeRow[]);
    } catch {
      // القسم يبقى فارغًا: ملفُّ المريض لا يسقط لأن استمارةً لم تصل.
    } finally {
      setLoaded(true);
    }
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  if (!loaded || rows.length === 0) return null;

  const [latest, ...older] = rows;
  return (
    <section className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="الاستمارة الصحّية">
      <h3 className="mb-1 text-sm font-bold text-navy-900">ما قاله المريض عن صحّته</h3>
      <p className="mb-2 text-[10px] font-semibold text-slate-500">
        من بوابته — {friendlyDateLong(latest.submittedAt.slice(0, 10))}.
        وهو قولُ المريض لا تشخيصُ الطبيب.
      </p>

      <p className="text-sm font-bold text-navy-900">{intakeSummary(latest)}</p>
      {latest.emergencyName || latest.emergencyPhone ? (
        <p className="mt-1 text-[11px] text-slate-600">
          طوارئ: {latest.emergencyName ?? "—"}
          {latest.emergencyPhone ? <span dir="ltr"> · {latest.emergencyPhone}</span> : null}
        </p>
      ) : null}
      {latest.note ? <p className="mt-1 text-[11px] text-slate-600">{latest.note}</p> : null}

      {older.length > 0 ? (
        <>
          <button
            onClick={() => setShowAll((open) => !open)}
            aria-expanded={showAll}
            className="mt-2 text-[11px] font-bold text-navy-800 underline-offset-2 hover:underline"
          >
            {showAll ? "إخفاء ما قبلها" : `ما قبلها (${older.length})`}
          </button>
          {showAll ? (
            <ul className="mt-2 space-y-1" aria-label="استمارات سابقة">
              {older.map((row) => (
                <li key={row.id} className="rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px]">
                  <span className="font-bold">{friendlyDateLong(row.submittedAt.slice(0, 10))}</span>
                  <span className="mr-1.5 text-slate-600">{intakeSummary(row)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {/* الحالات مؤشَّرة كما اختارها لا كنصٍّ حرّ — فتبقى قابلة للعدّ والقراءة السريعة. */}
      {latest.conditions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {latest.conditions.map((key) => (
            <span key={key} className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-navy-900">
              {INTAKE_CONDITIONS.find((one) => one.key === key)?.label ?? key}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
