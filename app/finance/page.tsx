"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CURRENCIES,
  CURRENCY_LABEL,
  CURRENCY_SHORT,
  formatMoney,
  isCurrency,
  parseAmount,
  type Currency,
} from "@/lib/money";
import { useSetting } from "@/components/SettingsProvider";
import { friendlyDateLong } from "@/lib/reminders";
import { clinicDateString } from "@/lib/schedule";

/**
 * الصندوق: وردية واحدة مفتوحة، وجرد آخر اليوم.
 *
 * الوردية ليست بيروقراطية: بلا إغلاق يومي لا أحد يعرف أن الصندوق نقص، ويظهر النقص
 * بعد شهر رقمًا لا يُفسَّر. وبلا وردية مفتوحة لا تُقبل دفعة أصلًا — دفعةٌ خارج
 * الورديات مالٌ دخل ولا يظهر في أي إغلاق.
 *
 * والجرد **بالورق لا بالمكافئ**: من يعدّ الصندوق يعدّ دولارات ودولارات وريالات كلًّا
 * على حدة، فالمقارنة تجري لكل عملة وحدها.
 */

interface Shift {
  id: number;
  openedBy: string;
  openedAt: string;
  opening: Record<Currency, number>;
  closedBy: string | null;
  closedAt: string | null;
  counted: Record<Currency, number> | null;
  note: string | null;
  status: "open" | "closed";
}

interface Payment {
  id: number; receiptNumber: string; patientId: number; patientName: string;
  kind: "payment" | "refund"; amountMinor: number; currency: Currency;
  exchangeRate: number; baseAmountMinor: number; method: string; createdAt: string;
}

interface Feed {
  open: Shift | null;
  totals: { byCurrency: Record<Currency, number>; baseTotalMinor: number; paymentCount: number };
  payments: Payment[];
  recent: Shift[];
}

const emptyAmounts = (): Record<Currency, string> => ({ YER: "", SAR: "", USD: "" });

export default function FinancePage() {
  const baseSetting = useSetting("finance.base_currency");
  const base: Currency = isCurrency(baseSetting) ? baseSetting : "YER";
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);

  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(emptyAmounts);
  const [counted, setCounted] = useState(emptyAmounts);
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/shifts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setFeed(payload as Feed);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const expected = useMemo(() => {
    if (!feed?.open) return null;
    const result = {} as Record<Currency, number>;
    for (const currency of CURRENCIES) {
      result[currency] = feed.open.opening[currency] + feed.totals.byCurrency[currency];
    }
    return result;
  }, [feed]);

  const open = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opening }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? "تعذّر فتح الوردية."); return; }
      setOpening(emptyAmounts());
      setError(null);
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }, [busy, opening, load]);

  const close = useCallback(async () => {
    if (busy || !feed?.open) return;
    setBusy(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: feed.open.id, counted, note }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? "تعذّر الإغلاق."); return; }
      setCounted(emptyAmounts());
      setNote("");
      setClosing(false);
      setError(null);
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }, [busy, feed, counted, note, load]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold leading-tight">الصندوق</h1>
          <p className="text-xs text-slate-500">{friendlyDateLong(today)}</p>
        </div>
        <a href="/finance/services" className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-navy-800">
          قائمة الأسعار
        </a>
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {loading && !feed ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : !feed?.open ? (
        <section className="mb-5 rounded-2xl border-2 border-brand-orange bg-white p-4" aria-label="فتح الوردية">
          <h2 className="mb-1 text-sm font-bold">لا توجد وردية مفتوحة</h2>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            لا يمكن قبض أي مبلغ قبل فتح الوردية. اكتب ما في الصندوق الآن — واتركه فارغًا
            إن كان صفرًا.
          </p>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            {CURRENCIES.map((currency) => (
              <label key={currency} className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">{CURRENCY_LABEL[currency]}</span>
                <input
                  value={opening[currency]}
                  onChange={(event) => setOpening((current) => ({ ...current, [currency]: event.target.value }))}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </label>
            ))}
          </div>
          <button onClick={open} disabled={busy}
            className="w-full rounded-xl bg-brand-orange py-2.5 text-sm font-extrabold text-white disabled:opacity-50">
            افتح الوردية
          </button>
        </section>
      ) : (
        <>
          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4" aria-label="الوردية المفتوحة">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-bold">وردية مفتوحة</span>
              <span className="text-[11px] font-bold text-slate-400">
                فتحها {feed.open.openedBy} · {new Date(feed.open.openedAt).toLocaleTimeString("ar-YE-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-center text-lg font-extrabold">
              {formatMoney(feed.totals.baseTotalMinor, base)}
              <span className="mr-2 text-[11px] font-bold text-slate-400">صافي التحصيل</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {CURRENCIES.map((currency) => (
                <div key={currency} className="rounded-xl border border-slate-200 p-2 text-center">
                  <p className="text-sm font-extrabold">{formatMoney(expected?.[currency] ?? 0, currency)}</p>
                  <p className="text-[11px] text-slate-500">
                    {CURRENCY_LABEL[currency]} — المتوقَّع في الصندوق
                  </p>
                </div>
              ))}
            </div>

            {!closing ? (
              <button onClick={() => setClosing(true)}
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700">
                إغلاق الوردية وجرد الصندوق
              </button>
            ) : (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-bold text-slate-600">اعدد ما في الصندوق فعلًا:</p>
                <div className="mb-2 grid gap-2 sm:grid-cols-3">
                  {CURRENCIES.map((currency) => {
                    const countedMinor = parseAmount(counted[currency] || "0", currency);
                    const difference = countedMinor === null || !expected
                      ? null : countedMinor - expected[currency];
                    return (
                      <label key={currency} className="block">
                        <span className="mb-1 block text-[11px] font-bold text-slate-500">
                          {CURRENCY_SHORT[currency]} — المتوقَّع {formatMoney(expected?.[currency] ?? 0, currency)}
                        </span>
                        <input
                          value={counted[currency]}
                          onChange={(event) => setCounted((current) => ({ ...current, [currency]: event.target.value }))}
                          inputMode="decimal"
                          dir="ltr"
                          placeholder="0"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        />
                        {/* الفرق يظهر قبل الحفظ لا بعده: من يرى النقص وهو واقف عند
                            الصندوق يعيد العدّ؛ ومن يراه غدًا لا يستطيع شيئًا. */}
                        {difference !== null && difference !== 0 ? (
                          <span className={`mt-1 block text-[11px] font-bold ${difference < 0 ? "text-red-600" : "text-amber-600"}`}>
                            {difference < 0 ? "نقص" : "زيادة"} {formatMoney(Math.abs(difference), currency)}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="ملاحظة (اختياري) — سبب الفرق مثلًا"
                  className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button onClick={close} disabled={busy}
                    className="flex-1 rounded-xl bg-navy-800 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">
                    أغلق الوردية
                  </button>
                  <button onClick={() => setClosing(false)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-600">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="mb-5" aria-label="حركة الوردية">
            <h2 className="mb-2 text-sm font-bold">حركة الوردية ({feed.payments.length})</h2>
            {feed.payments.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">
                لم يُقبض شيء بعد.
              </p>
            ) : (
              <ul className="space-y-2">
                {feed.payments.map((payment) => (
                  <li key={payment.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 ${
                    payment.kind === "refund" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
                  }`}>
                    <div className="min-w-[9rem] flex-1">
                      <a href={`/patients/${payment.patientId}`} className="block truncate text-sm font-extrabold underline decoration-slate-300 underline-offset-4">
                        {payment.patientName}
                      </a>
                      <p className="text-[11px] text-slate-500">
                        {payment.receiptNumber} · {payment.kind === "refund" ? "استرداد" : "قبض"}
                        {payment.currency !== base ? ` · سعر ${payment.exchangeRate}` : ""}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className={`text-sm font-extrabold ${payment.kind === "refund" ? "text-red-700" : ""}`}>
                        {payment.kind === "refund" ? "−" : ""}{formatMoney(payment.amountMinor, payment.currency)}
                      </p>
                      {payment.currency !== base ? (
                        <p className="text-[11px] text-slate-400">= {formatMoney(payment.baseAmountMinor, base)}</p>
                      ) : null}
                    </div>
                    <a
                      href={`/print/receipt/${payment.id}`}
                      target="_blank"
                      rel="noopener"
                      className="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-navy-800"
                    >
                      طباعة السند
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {feed?.recent?.length ? (
        <section aria-label="ورديات سابقة">
          <h2 className="mb-2 text-sm font-bold">ورديات سابقة</h2>
          <ul className="space-y-2">
            {feed.recent.filter((shift) => shift.status === "closed").slice(0, 8).map((shift) => (
              <li key={shift.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold">
                    {friendlyDateLong(shift.openedAt.slice(0, 10))} · {shift.openedBy}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    أغلقها {shift.closedBy}
                  </span>
                </div>
                {shift.counted ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    الجرد: {CURRENCIES.filter((c) => shift.counted![c] > 0).map((c) => formatMoney(shift.counted![c], c)).join(" · ") || "صفر"}
                  </p>
                ) : null}
                {shift.note ? <p className="mt-1 text-[11px] text-slate-600">{shift.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
