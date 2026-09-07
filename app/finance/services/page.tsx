"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAmount, formatMoney, isCurrency, type Currency } from "@/lib/money";
import { useSetting } from "@/components/SettingsProvider";
import { PageHeader } from "@/components/PageHeader";
import { CatalogSetup } from "@/components/CatalogSetup";
import { categoryLabel } from "@/lib/clinicCatalog";
import { useSession } from "@/components/SessionProvider";
import { financeLinks } from "@/components/financeLinks";

/**
 * قائمة الأسعار.
 *
 * وجودها يغيّر شكل الفوترة كلها: بلا قائمة تُكتب المبالغ من الذاكرة، فيختلف سعر
 * الحشوة بين موظفة وأخرى وبين يوم وآخر، ولا يستطيع أي تقرير أن يقول ماذا يدرّ كل نوع
 * علاج. ومع القائمة يبقى التعديل ممكنًا لكل حالة — السعر اقتراحٌ لا قيد.
 */

interface Service {
  id: number; name: string; category: string | null;
  priceConfigured: boolean; priceProvisional: boolean;
  catalogCode: string|null; priceMinor: number; isActive: boolean; sortOrder: number;
}

export default function ServicesPage() {
  const session=useSession();
  const canEdit = session?.role === 'admin';
  const baseSetting = useSetting("finance.base_currency");
  const base: Currency = isCurrency(baseSetting) ? baseSetting : "YER";

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  /*
   * ── جولة التسعير ──
   *
   * أعمال المركز أُدخلت بلا أسعار، والخدمة غير المسعّرة تُرفض عند الفوترة وتحجب
   * شاشةُ الجاهزية البدءَ بسببها. وتسعيرُها واحدةً واحدةً حفظٌ لكلٍّ وذهابٌ وإياب —
   * ومن يقف في المنتصف يترك نصف الدليل مسعّرًا ونصفه لا.
   */
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/services?all=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setServices(payload as Service[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (run: () => Promise<Response>) => {
    if (busy) return false;
    setBusy(true);
    try {
      const response = await run();
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? "تعذّر التنفيذ."); return false; }
      setError(null);
      await load();
      return true;
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await send(() => fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, price }),
    }));
    if (ok) { setName(""); setPrice(""); }
  };

  const unpricedCount = useMemo(
    () => services.filter((one) => one.isActive && !one.priceConfigured).length, [services]);
  /*
   * وعددُ التخمينيّ يُعرض ولو لم يبقَ غيرُ مسعَّر — بل **خصوصًا حينئذٍ**.
   *
   * فملءُ التخمين يصفّر عدّاد «بلا سعر» ويُخفي لوحة الجولة، ولو عُلّق التحذير
   * عليها لاختفى في اللحظة التي صار فيها كلُّ الدليل مسعّرًا بأرقامٍ لم يقرّها أحد.
   */
  const provisionalCount = useMemo(
    () => services.filter((one) => one.isActive && one.priceProvisional).length, [services]);

  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    // وتصفيةُ «غير المسعّرة» على الفعّالة وحدها: المعطّلة لا تُفوتر فلا تحجب البدء.
    const shown = onlyUnpriced
      ? services.filter((one) => one.isActive && !one.priceConfigured) : services;
    for (const service of shown) {
      const key = service.category ?? "بلا تصنيف";
      map.set(key, [...(map.get(key) ?? []), service]);
    }
    return [...map.entries()];
  }, [services, onlyUnpriced]);

  const drafted = useMemo(
    () => Object.entries(draft).filter(([, value]) => value.trim() !== ""), [draft]);

  /** يحفظ ما كُتب في الجولة دفعةً واحدة — كلُّه أو لا شيء منه. */
  const savePass = async () => {
    const ok = await send(() => fetch("/api/services/prices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prices: drafted.map(([id, price]) => ({ id: Number(id), price: price.trim() })),
      }),
    }));
    if (ok) { setDraft({}); await load(); }
  };

  /**
   * يملأ ما بقي بلا سعرٍ بتقديرٍ من الدليل — **للتجربة، ويُوسَم**.
   *
   * طلبه المالك ليبدأ التجربة قبل أن يُقرّ قائمته. ولأنّه يعمل — تُفوتَر به زيارة —
   * يُسأل قبله سؤالًا صريحًا: لا يُملأ ٨٦ سعرًا بنقرةٍ واحدة بلا إقرار.
   */
  const fillProvisional = async () => {
    if (!window.confirm(
      `ستُملأ ${unpricedCount} خدمةً بأسعارٍ تخمينية من النظام — للتجربة وحدها.\n\n`
      + "وهي تعمل: تُفوتَر بها زيارةٌ لمريضٍ حقيقيّ. تبقى موسومةً «تخميني» حتى تستبدلها بقائمتك.",
    )) return;
    if (await send(() => fetch("/api/services/prices", { method: "POST" }))) await load();
  };

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader
        title="قائمة الأسعار"
        subtitle="السعر اقتراحٌ لا قيد — يمكن تعديله في كل فاتورة"
        links={financeLinks("/finance/services")}
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {canEdit&&<CatalogSetup services={services} base={base} onChanged={()=>void load()}/>}
      {!canEdit && <p className="mb-4 text-sm text-slate-600">قائمة الأسعار للقراءة فقط. تعديل الأعمال والأسعار للمدير.</p>}
      {canEdit && <form onSubmit={add} className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold">خدمة جديدة</h2>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الخدمة"
            aria-label="اسم الخدمة"
            className="min-w-[10rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="التصنيف"
            aria-label="التصنيف" list="categories"
            className="w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue" />
          <datalist id="categories">
            {[...new Set(services.map((s) => s.category).filter(Boolean))].map((c) => <option key={c} value={c!} />)}
          </datalist>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="السعر"
            aria-label="السعر" inputMode="decimal" dir="ltr"
            className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue" />
          <button type="submit" disabled={busy || !name.trim() || !price.trim()}
            className="rounded-xl bg-brand-orange px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
            أضف
          </button>
        </div>
      </form>}

      {/* جولة التسعير: الرقم والزرّ فوق القائمة، فمن يفتح الشاشة يعرف كم بقي. */}
      {canEdit && unpricedCount > 0 ? (
        <section className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3" aria-label="جولة التسعير">
          <p className="text-sm font-extrabold text-navy-900">
            {unpricedCount} {unpricedCount === 1 ? "خدمةً بلا سعر" : "خدمةً بلا أسعار"}
          </p>
          <p className="mt-1 text-[11px] font-bold leading-5 text-slate-600">
            الخدمة بلا سعرٍ تُرفض عند الفوترة، وشاشة الجاهزية تحجب البدء ما دامت كلُّها بلا أسعار.
            اكتب الأسعار في الحقول ثم احفظها دفعةً واحدة — <span className="text-amber-800">وسعرٌ خاطئ يردّ الدفعة كلَّها</span>،
            فلا يبقى نصفُ الدليل مسعّرًا ونصفُه لا.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setOnlyUnpriced((on) => !on)}
              aria-pressed={onlyUnpriced}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold ${onlyUnpriced ? "bg-navy-800 text-white" : "border border-slate-300 bg-white text-navy-800"}`}>
              {onlyUnpriced ? "اعرض الكلّ" : "اعرض غير المسعّرة وحدها"}
            </button>
            <button type="button" onClick={() => void savePass()} disabled={busy || drafted.length === 0}
              className="rounded-xl bg-navy-800 px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-40">
              {busy ? "يحفظ…" : `احفظ ${drafted.length} سعرًا`}
            </button>
            {/* والتخمين آخرُ الخيارات لا أوّلها — فالزرّ بعد الحفظ وبلا لون. */}
            <button type="button" onClick={() => void fillProvisional()} disabled={busy}
              className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 disabled:opacity-40">
              املأ الباقي بأسعارٍ تخمينية للتجربة
            </button>
          </div>
        </section>
      ) : null}

      {/*
        * تحذيرُ التخمين مستقلٌّ عن لوحة الجولة.
        *
        * فحين يُملأ الكلُّ تخمينًا يصير عدّاد «بلا سعر» صفرًا وتختفي اللوحة — وذلك
        * أخطرُ وقتٍ لا أهونُه: كلُّ الدليل مسعّرٌ بأرقامٍ لم يقرّها أحد، والفوترة
        * تمرّ بلا اعتراض.
        */}
      {provisionalCount > 0 ? (
        <section className="mb-4 rounded-2xl border-2 border-amber-400 bg-amber-100/70 p-3" aria-label="أسعار تخمينية">
          <p className="text-sm font-extrabold text-amber-900">
            {provisionalCount} خدمةً بسعرٍ تخمينيّ لم تُقرّه
          </p>
          <p className="mt-1 text-[11px] font-bold leading-5 text-amber-900/80">
            هذه أرقامٌ ملأها النظام للتجربة، <span className="underline">وهي تعمل</span> — تُفوتَر بها زيارةُ مريضٍ حقيقيّ
            ولا شيء في فاتورته يقول إنّها تخمين. استبدلها بقائمتك قبل أن تُفوتر بها فعلًا:
            تعديلُ السعر بيدك يُسقط الوسم عنه.
          </p>
        </section>
      ) : null}

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : services.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          لا خدمات بعد. أضف أكثر ما تعمله العيادة أولًا.
        </p>
      ) : (
        grouped.map(([groupName, list]) => (
          <section key={groupName} className="mb-4">
            <h2 className="mb-2 text-sm font-bold">{categoryLabel(groupName)}</h2>
            <ul className="space-y-2">
              {list.map((service) => (
                <li key={service.id} className={`rounded-2xl border p-3 ${service.isActive ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[8rem] flex-1 truncate text-sm font-extrabold">{service.name}</span>
                    {/* حقلُ الجولة على غير المسعّرة وحدها — والمسعَّرة تُعدَّل بزرّها كما كانت. */}
                    {canEdit && !service.priceConfigured && service.isActive && editingId !== service.id ? (
                      <input
                        value={draft[service.id] ?? ""}
                        onChange={(event) => setDraft((current) => ({ ...current, [service.id]: event.target.value }))}
                        inputMode="decimal" dir="ltr" placeholder="السعر"
                        aria-label={`سعر ${service.name}`}
                        className="w-28 rounded-xl border-2 border-amber-300 px-3 py-1.5 text-sm" />
                    ) : null}
                    {canEdit && editingId === service.id ? (
                      <>
                        <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                          inputMode="decimal" dir="ltr" autoFocus
                          className="w-28 rounded-xl border border-slate-200 px-3 py-1.5 text-sm" />
                        <button
                          onClick={async () => {
                            const ok = await send(() => fetch(`/api/services/${service.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ price: editPrice }),
                            }));
                            if (ok) setEditingId(null);
                          }}
                          disabled={busy}
                          className="rounded-xl bg-navy-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                          حفظ
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">
                          إلغاء
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-bold">{service.priceConfigured ? formatMoney(service.priceMinor, base) : "لم يُحدد السعر"}</span>
                        {/* والوسم بجانب الرقم لا في حاشية: من يقرأ السعر يقرأ أنّه تخمين. */}
                        {service.priceProvisional ? (
                          <span className="rounded-lg bg-amber-200 px-2 py-0.5 text-[11px] font-extrabold text-amber-900"
                            title="سعرٌ تخمينيّ ملأه النظام للتجربة — لم يُقرَّ بعد">
                            تخميني
                          </span>
                        ) : null}
                        {canEdit && <>
                        <button
                          onClick={() => { setEditingId(service.id); setEditPrice(formatAmount(service.priceMinor, base).replace(/,/g, "")); }}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-navy-800">
                          تعديل السعر
                        </button>
                        <button
                          onClick={() => send(() => fetch(`/api/services/${service.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ isActive: !service.isActive }),
                          }))}
                          disabled={busy}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 disabled:opacity-40">
                          {service.isActive ? "إيقاف" : "تفعيل"}
                        </button>
                        </>}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {/* الخدمة تُوقَف ولا تُحذف: حذفها يكسر فواتير قديمة تشير إليها، ويجعل تقرير
          العام الماضي يفقد بنودًا كانت فيه. */}
      <p className="mt-4 text-center text-[11px] text-slate-400">
        الخدمة تُوقَف ولا تُحذف — الفواتير القديمة تشير إليها.
      </p>
    </main>
  );
}
