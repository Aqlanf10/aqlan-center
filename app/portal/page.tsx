"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney, type Currency } from "@/lib/money";
import { friendlyDateLong } from "@/lib/reminders";

/**
 * بوابة المريض.
 *
 * وهي شاشةٌ تُفتح على هاتفٍ في الشارع لا على مكتب: خطٌّ كبير، وأزرارٌ تُطال بالإبهام،
 * ورقمٌ واحد أعلى الصفحة هو ما جاء من أجله — **كم عليّ**. وما بعده تفصيله.
 *
 * ولا تفعل إلا شيئًا واحدًا: **تأكيد الحضور**. لا تدفع ولا تُعدّل ولا تحجز — والحجز
 * طلبٌ تؤكّده الاستقبال في `/book`. فبوابةٌ تكتب في المواعيد مباشرةً تملأ يومًا
 * بأسماء لم يرها أحد، وهو عين ما بُني البرنامج ليمنعه.
 */

interface Me { fullName: string; patientNumber: string }

interface AppointmentView {
  id: number;
  scheduledDate: string;
  scheduledTime: string;
  appointmentType: string | null;
  note: string | null;
  confirmedAt: string | null;
  confirmable: boolean;
}

interface Statement {
  balance: { dueMinor: number; billedMinor: number; collectedMinor: number; openingMinor: number };
  baseCurrency: Currency;
  invoices: { id: number; invoiceNumber: string; createdAt: string; totalMinor: number; discountMinor: number; status: string }[];
  payments: { id: number; receiptNumber: string; createdAt: string; kind: string; baseAmountMinor: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  open: "غير مسدّدة", paid: "مسدّدة", cancelled: "ملغاة",
};

export default function PortalPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [phone, setPhone] = useState("");
  const [patientNumber, setPatientNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);

  const loadMine = useCallback(async () => {
    try {
      const [appointmentsResponse, statementResponse] = await Promise.all([
        fetch("/api/portal/appointments", { cache: "no-store" }),
        fetch("/api/portal/statement", { cache: "no-store" }),
      ]);
      if (appointmentsResponse.ok) {
        setAppointments((await appointmentsResponse.json()).appointments as AppointmentView[]);
      }
      if (statementResponse.ok) setStatement(await statementResponse.json());
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/portal/me", { cache: "no-store" });
        if (response.ok) {
          setMe(await response.json());
          await loadMine();
        }
      } catch { /* تبقى شاشة الدخول */ }
      finally { setChecking(false); }
    })();
  }, [loadMine]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, patientNumber }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? "تعذّر الدخول."); return; }
      setMe(payload as Me);
      setError(null);
      await loadMine();
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/portal/logout", { method: "POST" }).catch(() => {});
    setMe(null);
    setAppointments([]);
    setStatement(null);
  };

  const confirm = async (appointmentId: number) => {
    setBusy(true);
    try {
      const response = await fetch("/api/portal/appointments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      const payload = await response.json().catch(() => null);
      // رسالة الخادم تُعرض كما هي: «هذا الموعد مضى» تقول للمريض ماذا يفعل،
      // و«تعذّر» تقول له أن يعيد الضغط.
      setError(response.ok ? null : (payload?.message ?? "تعذّر تأكيد الموعد."));
      await loadMine();
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة.");
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return <main className="p-6 text-center text-sm text-slate-400">جارٍ التحميل…</main>;
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-sm p-5">
        <h1 className="mb-1 text-xl font-bold text-navy-900">بوابتي</h1>
        <p className="mb-5 text-xs font-medium text-slate-500">
          ادخل برقم جوالك المسجَّل في المركز ورقم ملفك.
        </p>

        {error ? (
          <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <form onSubmit={signIn} aria-label="دخول البوابة">
          <label className="mb-1 block text-[11px] font-bold text-slate-500">رقم الجوال</label>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            aria-label="رقم الجوال"
            inputMode="tel"
            dir="ltr"
            className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-brand-blue"
          />
          <label className="mb-1 block text-[11px] font-bold text-slate-500">رقم الملف</label>
          <input
            value={patientNumber}
            onChange={(event) => setPatientNumber(event.target.value)}
            aria-label="رقم الملف"
            dir="ltr"
            placeholder="P-00042"
            className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-brand-blue"
          />
          <button
            type="submit"
            disabled={busy || !phone.trim() || !patientNumber.trim()}
            className="w-full rounded-xl bg-navy-900 py-3 text-sm font-extrabold text-white disabled:opacity-40"
          >
            دخول
          </button>
        </form>

        <p className="mt-4 text-[11px] leading-5 text-slate-400">
          رقم ملفك مكتوب على سند القبض وعلى تقاريرك. وإن لم تجده فاتّصل بالمركز.
        </p>
      </main>
    );
  }

  const due = statement?.balance.dueMinor ?? 0;

  return (
    <main className="mx-auto max-w-md p-4 pb-16">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-navy-900">{me.fullName}</h1>
          <p className="text-[11px] font-semibold text-slate-400" dir="ltr">{me.patientNumber}</p>
        </div>
        <button onClick={signOut} className="shrink-0 text-xs font-bold text-slate-500">خروج</button>
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/* الرقم الذي جاء من أجله أوّلًا، وتفصيله بعده. */}
      {statement ? (
        <section
          aria-label="رصيد الحساب"
          className={`mb-4 rounded-2xl border p-4 text-center ${
            due > 0 ? "border-warning-300 bg-warning-50" : "border-success-300 bg-success-50"
          }`}
        >
          <p className="text-[11px] font-bold opacity-60">حسابك في المركز</p>
          <p className="mt-1 text-2xl font-bold leading-none">
            {due === 0
              ? "مسدَّد"
              : due > 0
              ? formatMoney(due, statement.baseCurrency)
              : `لك ${formatMoney(-due, statement.baseCurrency)}`}
          </p>
          {due > 0 ? <p className="mt-1 text-[11px] font-semibold opacity-70">المتبقّي عليك</p> : null}
        </section>
      ) : null}

      <section className="mb-4" aria-label="مواعيدي">
        <h2 className="mb-2 text-sm font-bold text-navy-900">مواعيدي</h2>
        {appointments.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
            لا مواعيد مسجّلة. اطلب موعدًا من صفحة الحجز أو اتّصل بالمركز.
          </p>
        ) : (
          <ul className="space-y-2">
            {appointments.map((one) => (
              <li key={one.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-sm font-bold text-navy-900">
                  {friendlyDateLong(one.scheduledDate)} — {one.scheduledTime}
                </p>
                {one.appointmentType ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{one.appointmentType}</p>
                ) : null}
                {one.confirmedAt ? (
                  <p className="mt-2 text-[11px] font-bold text-success-900">أكّدتَ حضورك ✓</p>
                ) : one.confirmable ? (
                  <button
                    onClick={() => { void confirm(one.id); }}
                    disabled={busy}
                    className="mt-2 w-full rounded-xl bg-navy-900 py-2.5 text-xs font-extrabold text-white disabled:opacity-40"
                  >
                    أؤكّد حضوري
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {statement ? (
        <section aria-label="تفصيل الحساب">
          <h2 className="mb-2 text-sm font-bold text-navy-900">تفصيل الحساب</h2>
          <ul className="space-y-1">
            {statement.invoices.map((invoice) => (
              <li key={`invoice-${invoice.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px]">
                <span className="min-w-0 truncate">
                  فاتورة <span dir="ltr">{invoice.invoiceNumber}</span>
                  <span className="mr-1.5 text-slate-400">{STATUS_LABEL[invoice.status] ?? invoice.status}</span>
                </span>
                <span className="shrink-0 font-bold">
                  {formatMoney(invoice.totalMinor - invoice.discountMinor, statement.baseCurrency)}
                </span>
              </li>
            ))}
            {statement.payments.map((payment) => (
              <li key={`payment-${payment.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-success-50 px-3 py-2 text-[11px]">
                <span className="min-w-0 truncate">
                  {payment.kind === "refund" ? "استرداد" : "دفعة"} <span dir="ltr">{payment.receiptNumber}</span>
                </span>
                <span className="shrink-0 font-bold">
                  {formatMoney(payment.baseAmountMinor, statement.baseCurrency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
