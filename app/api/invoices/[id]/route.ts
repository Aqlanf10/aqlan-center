import { NextResponse } from "next/server";
import { getInvoice, setInvoiceStatus } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم الفاتورة غير صالح." }, { status: 400 });
  }
  try {
    const invoice = await getInvoice(id);
    if (!invoice) return NextResponse.json({ message: "الفاتورة غير موجودة." }, { status: 404 });
    return NextResponse.json(invoice);
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل الفاتورة." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم الفاتورة غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const status = (body as Record<string, unknown>)?.status;
  if (status !== "open" && status !== "paid" && status !== "cancelled") {
    return NextResponse.json({ message: "حالة غير معروفة." }, { status: 400 });
  }
  // الإلغاء يمسح مبلغًا من رصيد المريض، فهو للمدير وحده.
  if (status === "cancelled" && session.role !== "admin") {
    return NextResponse.json({ message: "إلغاء الفاتورة للمدير وحده." }, { status: 403 });
  }

  try {
    const updated = await setInvoiceStatus(id, status);
    if (!updated) {
      return NextResponse.json(
        { message: "الفاتورة غير موجودة أو ملغاة — والملغاة لا تُعاد." },
        { status: 409 },
      );
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ message: "تعذّر تنفيذ الإجراء." }, { status: 500 });
  }
}
