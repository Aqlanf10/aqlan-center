import { NextResponse } from "next/server";
import { closeLabPrice, recordAudit } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * إغلاق سعرٍ بتاريخ نهاية — لا حذفه.
 *
 * فالأوامر التي أُرسلت في مدّته حُسبت به، وحذفُه يجعل مراجعتها بلا سعرٍ يُفسّرها.
 */
export async function PATCH(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "أسعار المختبرات للمدير." }, { status: 403 });
  }
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم السعر غير صالح." }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const effectiveTo = String((body as Record<string, unknown>)?.effectiveTo ?? "");
  if (!DATE.test(effectiveTo)) {
    return NextResponse.json({ message: "تاريخ الإغلاق بصيغة 2026-12-31." }, { status: 400 });
  }
  try {
    const done = await closeLabPrice(id, effectiveTo);
    if (!done.ok) return NextResponse.json({ message: done.message }, { status: 409 });
    await recordAudit({
      action: "lab.price", entity: "lab_price", entityId: id,
      details: { إغلاق: effectiveTo },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "تعذّر إغلاق السعر." }, { status: 500 });
  }
}
