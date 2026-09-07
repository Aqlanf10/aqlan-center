"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { settingsTabs } from "@/lib/settingsNav";
import { ratePercentText } from "@/lib/materialRate";

/**
 * نِسَب إهلاك المواد لكل تخصّص.
 *
 * طلبها المالك بديلًا عن خصم تكلفة المواد الفعلية: «او بدلا منها اعمل نسبة اهلاك
 * نحدده لكل تخصص».
 *
 * **ولماذا نسبةٌ لا تكلفةٌ فعلية؟** لأنّ المواد لا تُنسب إلى عملٍ بعينه في مركزٍ
 * حقيقيّ: قفّازٌ ومخدّرٌ وشاشٌ لا يُعدّ، وصرفُ المخزون يُسجَّل حين يُسجَّل. فخصمُ
 * «الفعليّ» يخصم من طبيبٍ سجّل ولا يخصم من طبيبٍ لم يسجّل — عقابٌ على الدقّة.
 *
 * والنسبةُ تعترف بذلك: تقديرٌ متّفقٌ عليه سلفًا، معلومٌ للطبيب قبل أن يعمل.
 */

interface Rate { category: string; rateBp: number; updatedBy: string | null; updatedAt: string }

export default function MaterialRatesPage() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ratesResponse, settingsResponse] = await Promise.all([
        fetch("/api/finance/material-rates", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const payload = await ratesResponse.json();
      if (!ratesResponse.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setRates(payload.rates as Rate[]);
      setCategories(payload.categories as Record<string, string>);
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        setEnabled(settings?.["finance.commission_deducts_material_cost"] === "yes");
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (category: string, rate: string | null) => {
    setBusy(category);
    try {
      const response = await fetch("/api/finance/material-rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, rate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر الحفظ.");
      setDraft((current) => { const next = { ...current }; delete next[category]; return next; });
      await load();
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذّر الحفظ.");
    } finally {
      setBusy(null);
    }
  };

  const rateOf = (category: string) => rates.find((one) => one.category === category) ?? null;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader
        title="نِسَب إهلاك المواد"
        subtitle="تقديرُ ما تستهلكه المواد من قيمة العمل — يُخصم من عمولة الطبيب"
        links={settingsTabs("/settings/material-rates")}
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/*
        * وحالةُ المفتاح تُقال أوّلًا.
        *
        * فنِسَبٌ محفوظةٌ والمفتاح مغلق لا تُخصم من أحد، ومن ضبطها ظنّ أنّه فعل شيئًا.
        * وهو الخطأ الذي يُكتشف بعد شهرٍ من صرف عمولاتٍ بلا خصم.
        */}
      <section className={`mb-4 rounded-2xl border-2 p-3 ${enabled ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
        <p className="text-sm font-extrabold text-navy-900">
          {enabled ? "الخصم مُفعَّل — هذه النِّسَب تُطبَّق على العمولات" : "الخصم موقوف — هذه النِّسَب محفوظة ولا تُخصم من أحد"}
        </p>
        <p className="mt-1 text-[11px] font-bold leading-5 text-slate-700">
          يُفعَّل من مفتاح <span dir="ltr" className="font-mono">finance.commission_deducts_material_cost</span> في{" "}
          <a href="/settings" className="underline">الإعدادات العامة</a> — اكتب <span dir="ltr">yes</span>.
          وهو <span className="underline">مستقلّ</span> عن خصم تكلفة المختبر: يُفعَّل أحدهما أو كلاهما أو لا شيء.
        </p>
      </section>

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : (
        <ul className="space-y-2">
          {Object.entries(categories).map(([category, label]) => {
            const current = rateOf(category);
            const value = draft[category] ?? (current ? ratePercentText(current.rateBp) : "");
            return (
              <li key={category} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[9rem] flex-1 text-sm font-extrabold">{label}</span>
                  <input
                    value={value}
                    onChange={(event) => setDraft((one) => ({ ...one, [category]: event.target.value }))}
                    inputMode="decimal" dir="ltr" placeholder="—"
                    aria-label={`نسبة إهلاك ${label}`}
                    className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand-blue" />
                  <span className="text-xs font-bold text-slate-500">٪</span>
                  <button type="button" disabled={busy === category}
                    onClick={() => void save(category, (draft[category] ?? "").trim() || null)}
                    className="rounded-xl bg-navy-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                    {busy === category ? "…" : "احفظ"}
                  </button>
                  {/*
                    * والرفع ليس كتابةَ صفر.
                    *
                    * الصفر يقول «هذا العمل بلا موادّ»، والرفع يقول «لم تُحدَّد
                    * نسبته» — ويظهر محصَّلُه في تقرير العمولة رقمًا لم يُخصم منه.
                    */}
                  {current ? (
                    <button type="button" disabled={busy === category}
                      onClick={() => void save(category, null)}
                      className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">
                      ارفع النسبة
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] font-bold text-slate-500">
                  {current
                    ? `${ratePercentText(current.rateBp)}٪ من المحصَّل في هذا التخصّص تُعدّ موادّ`
                    : "بلا نسبة — لا يُخصم من هذا التخصّص شيء، ويظهر محصَّله في تقرير العمولة"}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        النسبة تُضرب في <span className="font-bold">المحصَّل</span> من عمل الطبيب في التخصّص لا في المفوتَر،
        ثم يُخصم من عمولته <span className="font-bold">نصيبُه منها بنسبته</span> — كحصّته من تكلفة المختبر تمامًا،
        فالمعادلة «نسبته × (المحصَّل − التكاليف)».
      </p>
    </main>
  );
}
