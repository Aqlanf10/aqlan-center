"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { settingsTabs } from "@/lib/settingsNav";
import { clinicDateString } from "@/lib/schedule";
import { formatMoney, isCurrency, type Currency } from "@/lib/money";
import {
  LAB_CATEGORIES, LAB_CATEGORY_LABEL, priceOn,
  type LabCategory, type LabPrice, type LabService,
} from "@/lib/labCatalog";

/**
 * أعمال المختبر وأسعارها.
 *
 * وأنواع العمل كانت تسعةً مكتوبةً في الكود، وما لا يشبهها يُكتب نصًّا حرًّا —
 * فيصير «زيركون» و«زركون» وZirconia ثلاثةَ أعمال في التقارير، ولا يُعرف كم صُرف
 * على الزيركون هذا العام.
 *
 * **والسعر لكلّ مختبرٍ على حدة، وبتاريخ سريان.** فالمركز يتّفق مع مختبرٍ على
 * تاجٍ بكذا ثم يرفع المختبر سعره؛ وأمرٌ أُرسل قبل الرفع سعرُه سعرُ يومه. ومراجعةُ
 * فاتورة الشهر الماضي بسعر اليوم تُنتج خلافًا مع المختبر لا حكم فيه.
 */

interface Party { id: number; name: string }

export default function LabSettingsPage() {
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);

  const [services, setServices] = useState<LabService[]>([]);
  const [labs, setLabs] = useState<Party[]>([]);
  const [prices, setPrices] = useState<LabPrice[]>([]);
  const [base, setBase] = useState<Currency>("YER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<LabCategory>("prostho");
  const [days, setDays] = useState("7");
  const [shade, setShade] = useState(true);

  const [labId, setLabId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [cost, setCost] = useState("");
  const [from, setFrom] = useState(today);

  const load = useCallback(async () => {
    try {
      const [servicesRes, labsRes, pricesRes, settingsRes] = await Promise.all([
        fetch("/api/lab/services?all=1", { cache: "no-store" }),
        fetch("/api/parties?kind=lab", { cache: "no-store" }),
        fetch("/api/lab/prices", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      if (servicesRes.ok) setServices((await servicesRes.json()).services ?? []);
      if (labsRes.ok) setLabs(await labsRes.json());
      if (pricesRes.ok) setPrices((await pricesRes.json()).prices ?? []);
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        const currency = settings?.settings?.["finance.base_currency"];
        if (isCurrency(currency)) setBase(currency);
      }
    } catch { setError("تعذّر التحميل."); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = async (url: string, method: string, body: unknown) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? "تعذّر الحفظ."); return false; }
      await load();
      return true;
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      return false;
    } finally { setBusy(false); }
  };

  const addService = async () => {
    if (await send("/api/lab/services", "POST", {
      name, category, defaultDays: Number(days), requiresShade: shade,
    })) { setName(""); setDays("7"); setShade(true); }
  };

  const addPrice = async () => {
    if (await send("/api/lab/prices", "POST", {
      partyId: Number(labId), serviceId: Number(serviceId), cost, effectiveFrom: from,
    })) setCost("");
  };

  const serviceName = (id: number) => services.find((one) => one.id === id)?.name ?? "—";
  const labName = (id: number) => labs.find((one) => one.id === id)?.name ?? "—";

  return (
    <main className="mx-auto max-w-3xl p-4">
      <PageHeader title="أعمال المختبر وأسعارها" links={settingsTabs("/settings/lab")} />

      {error ? (
        <p className="mb-3 rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-900">
          {error}
        </p>
      ) : null}

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-extrabold text-navy-900">كتالوج الأعمال</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          العمل المسجَّل هنا يُختار من قائمةٍ في شاشة المختبر — فيُكتب اسمُه مرّةً
          واحدة ويصحّ تجميع تقاريره.
        </p>

        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <input
            value={name} onChange={(event) => setName(event.target.value)}
            placeholder="اسم العمل — مثل: تاج زيركون"
            className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <select
            value={category} onChange={(event) => setCategory(event.target.value as LabCategory)}
            className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
          >
            {LAB_CATEGORIES.map((one) => (
              <option key={one} value={one}>{LAB_CATEGORY_LABEL[one]}</option>
            ))}
          </select>
          <input
            value={days} onChange={(event) => setDays(event.target.value)}
            inputMode="numeric" placeholder="المهلة بالأيام"
            className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={shade} onChange={(event) => setShade(event.target.checked)} />
            يحتاج لون سنّ
          </label>
        </div>
        <button
          onClick={() => void addService()} disabled={busy || name.trim().length < 2}
          className="rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          أضف العمل
        </button>

        <ul className="mt-3 space-y-1.5">
          {services.map((service) => (
            <li key={service.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-1.5">
              <span className="text-xs font-bold text-navy-900">
                {service.name}
                <span className="mr-2 text-[11px] font-normal text-slate-500">
                  {LAB_CATEGORY_LABEL[service.category]} · {service.defaultDays} يومًا
                  {service.requiresShade ? " · يحتاج لونًا" : ""}
                  {service.isActive ? "" : " · متوقّف"}
                </span>
              </span>
              {service.isActive ? (
                <button
                  onClick={() => void send(`/api/lab/services/${service.id}`, "DELETE", {})}
                  disabled={busy}
                  className="text-[11px] font-bold text-danger-700 underline disabled:opacity-40"
                >
                  إيقاف
                </button>
              ) : null}
            </li>
          ))}
          {services.length === 0 ? <li className="text-xs text-slate-400">لا أعمال بعد.</li> : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-extrabold text-navy-900">أسعار المختبرات</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          لكلّ مختبرٍ سعرُه لكلّ عمل، **من تاريخ**. ورفعُ السعر اليوم لا يغيّر
          أمرًا أُرسل الشهر الماضي — يُضاف سعرٌ جديد من تاريخه، ويُغلق القديم.
        </p>

        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <select
            value={labId} onChange={(event) => setLabId(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
          >
            <option value="">— اختر المختبر —</option>
            {labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
          </select>
          <select
            value={serviceId} onChange={(event) => setServiceId(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
          >
            <option value="">— اختر العمل —</option>
            {services.filter((one) => one.isActive).map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
          <input
            value={cost} onChange={(event) => setCost(event.target.value)}
            inputMode="decimal" placeholder={`السعر المتّفق عليه (${base})`}
            className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <input
            type="date" value={from} onChange={(event) => setFrom(event.target.value)}
            aria-label="من تاريخ"
            className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => void addPrice()} disabled={busy || !labId || !serviceId || !cost}
          className="rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          أضف السعر
        </button>

        <ul className="mt-3 space-y-1.5">
          {prices.map((price) => {
            // الساري اليوم يُميَّز: قائمةٌ تخلط الساري بالمنتهي تُقرأ خطأً.
            const live = priceOn(prices, price.partyId, price.serviceId, today)?.id === price.id;
            return (
              <li key={price.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-1.5">
                <span className="text-xs font-bold text-navy-900">
                  {labName(price.partyId)} · {serviceName(price.serviceId)}
                  <span className="mr-2 text-[11px] font-normal text-slate-500">
                    {formatMoney(price.costMinor, price.currency as Currency)} · من {price.effectiveFrom}
                    {price.effectiveTo ? ` إلى ${price.effectiveTo}` : ""}
                  </span>
                </span>
                {live ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    ساري اليوم
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-400">غير ساري</span>
                )}
                {price.effectiveTo === null ? (
                  <button
                    onClick={() => void send(`/api/lab/prices/${price.id}`, "PATCH", { effectiveTo: today })}
                    disabled={busy}
                    className="text-[11px] font-bold text-slate-600 underline disabled:opacity-40"
                  >
                    أغلقه اليوم
                  </button>
                ) : null}
              </li>
            );
          })}
          {prices.length === 0 ? <li className="text-xs text-slate-400">لا أسعار بعد.</li> : null}
        </ul>
      </section>
    </main>
  );
}
