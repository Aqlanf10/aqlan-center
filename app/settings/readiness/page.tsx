"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { settingsTabs } from "@/lib/settingsNav";
import type { ReadinessCheck, ReadinessLevel } from "@/lib/readiness";

/**
 * جاهزية النظام — **ما الذي يمنع بدء العمل عليه اليوم؟**
 *
 * قرّر المالك أن يكون هذا البرنامج الرسميّ النهائيّ للمركز. وبرنامجٌ يُسلَّم بقول
 * «جرّبه» يُبدأ به وفيه إعداداتٌ على افتراضاتها: سعرُ صرفٍ قديم يجعل كل دفعةٍ
 * بالدولار تُقيَّد خطأً، ولا نسخةَ احتياطية فعطلٌ واحد يُنهي تاريخ المركز.
 *
 * وهذه الشاشة لا تُصلح شيئًا — **تقول ما بقي، ولماذا يهمّ، وأين يُصلَح**، وتضع ما
 * يوقفك في أعلاها. ولا تقول «جاهز» ما دام بندٌ حاجز مفتوحًا.
 */

type Verdict = { ready: boolean; blocked: number; warnings: number; message: string };

const TONE: Record<ReadinessLevel, { chip: string; card: string; label: string }> = {
  blocked: { chip: "bg-rose-100 text-rose-800", card: "border-rose-300 bg-rose-50", label: "يمنع البدء" },
  warn: { chip: "bg-amber-100 text-amber-900", card: "border-amber-300 bg-amber-50", label: "يحتاج انتباهك" },
  ok: { chip: "bg-emerald-100 text-emerald-800", card: "border-slate-200 bg-white", label: "تمام" },
};

export default function ReadinessPage() {
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/readiness", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // ولا تُترك الشاشة فارغة على خطأ: صفحةٌ بيضاء تُقرأ «جاهز» وهي لم تسأل.
        setError(body?.message || "تعذّر قراءة حالة النظام.");
        setChecks(null);
        setVerdict(null);
        return;
      }
      setChecks(body.checks ?? []);
      setVerdict(body.verdict ?? null);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      setChecks(null);
      setVerdict(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader
        title="جاهزية النظام"
        subtitle="ما الذي يمنع بدء العمل عليه اليوم"
        links={settingsTabs("/settings/readiness")}
      />

      <div className="mb-4">
        <button type="button" onClick={() => void load()} disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy-800 disabled:opacity-50">
          {loading ? "يقرأ…" : "أعد الفحص"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-sm font-bold text-rose-800">
          {error}
        </p>
      ) : null}

      {verdict ? (
        <section
          aria-label="الخلاصة"
          className={`mb-4 rounded-2xl border-2 p-4 ${verdict.blocked > 0 ? "border-rose-300 bg-rose-50" : verdict.warnings > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}
        >
          <p className="text-sm font-extrabold text-navy-900">{verdict.message}</p>
          <p className="mt-1 text-[11px] font-bold text-slate-500">
            {verdict.blocked} حاجزًا · {verdict.warnings} تحذيرًا · {(checks?.length ?? 0)} بندًا مفحوصًا
          </p>
        </section>
      ) : null}

      <ol className="space-y-3">
        {(checks ?? []).map((check) => (
          <li key={check.key} className={`rounded-2xl border-2 p-4 ${TONE[check.level].card}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-extrabold text-navy-900">{check.title}</h2>
              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${TONE[check.level].chip}`}>
                {TONE[check.level].label}
              </span>
            </div>
            <p className="mt-1 text-xs font-bold text-navy-800">{check.detail}</p>
            {/* ولماذا يهمّ: بندٌ بلا سببٍ يُقرأ ضجيجًا ويُهمَل بعد أسبوع. */}
            <p className="mt-2 text-[11px] font-bold leading-5 text-slate-500">{check.why}</p>
            {check.href && check.level !== "ok" ? (
              <a href={check.href}
                className="mt-3 inline-block rounded-xl bg-navy-800 px-3 py-1.5 text-xs font-extrabold text-white">
                افتح موضع الإصلاح
              </a>
            ) : null}
          </li>
        ))}
      </ol>

      {!loading && !error && checks?.length === 0 ? (
        <p className="text-sm font-bold text-slate-500">لا بنود.</p>
      ) : null}
    </main>
  );
}
