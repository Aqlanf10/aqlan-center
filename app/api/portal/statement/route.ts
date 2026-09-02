import { NextResponse } from "next/server";
import { asPaymentLikes, getSettings, patientLedger } from "@/lib/db";
import { isCurrency, patientBalance } from "@/lib/money";
import { requirePortalSession } from "@/lib/portalSession";

export const dynamic = "force-dynamic";

/**
 * كشف حساب المريض في بوابته.
 *
 * ويستدعي `patientLedger()` **نفسها** التي تخدم شاشة المركز وسند الطباعة — لا
 * استعلامًا موازيًا. فبناءُ ثانٍ يعني رقمًا في البوابة ورقمًا في الصندوق، ثم يُقال
 * للمريض إنه مخطئ وهو يقرأ ما أعطيناه إياه.
 *
 * والمريض يقرأ **حسابه هو**: رقم الملف من التوكن الموقَّع لا من الطلب — ورقمٌ يأتي
 * في الطلب يُبدَّل فيُقرأ حساب غيره.
 */
export async function GET() {
  const session = await requirePortalSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }

  try {
    const [{ invoices, payments, opening }, settings] = await Promise.all([
      patientLedger(session.patientId),
      getSettings(),
    ]);
    const base = settings["finance.base_currency"];
    if (!isCurrency(base)) {
      return NextResponse.json({ message: "تعذّر عرض الحساب الآن." }, { status: 500 });
    }
    const balance = patientBalance(
      invoices.map((invoice) => ({
        totalMinor: invoice.totalMinor,
        discountMinor: invoice.discountMinor,
        status: invoice.status,
      })),
      asPaymentLikes(payments),
      opening?.amountMinor ?? 0,
    );

    /*
     * ويُعرض ما يخصّ المريض من الفاتورة لا كلّ ما فيها: التاريخ والرقم والمبلغ
     * والحالة. ومن يفتح بوابته لا يحتاج «من أنشأ الفاتورة» ولا ملاحظاتها الداخلية،
     * وكشفُ ما لا يُحتاج تسريبٌ صغيرٌ يتراكم.
     */
    return NextResponse.json({
      balance,
      baseCurrency: base,
      opening: opening ? { amountMinor: opening.amountMinor, note: opening.note ?? null } : null,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        createdAt: invoice.createdAt,
        totalMinor: invoice.totalMinor,
        discountMinor: invoice.discountMinor,
        status: invoice.status,
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        receiptNumber: payment.receiptNumber,
        createdAt: payment.createdAt,
        kind: payment.kind,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        baseAmountMinor: payment.baseAmountMinor,
      })),
    });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل حسابك." }, { status: 500 });
  }
}
