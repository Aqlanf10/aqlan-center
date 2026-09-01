import { NextResponse } from "next/server";
import { listMovements, recordAudit, recordMovement } from "@/lib/db";
import { isMovementKind, MOVEMENT_LABEL } from "@/lib/inventory";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * حركات بندٍ واحد.
 *
 * والتسجيل لكل من يعمل — الصرف يقع على الكرسي لا في مكتب المدير. والحارس على
 * **ما يُسجَّل** لا على من يسجّل: لا صرفَ فوق الرصيد، ولا تسويةَ بلا سبب.
 */

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const idFrom = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  const itemId = await idFrom(context);
  if (!itemId) return NextResponse.json({ message: "رقم البند غير صالح." }, { status: 400 });
  try {
    return NextResponse.json({ movements: await listMovements(itemId) });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل الحركات." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  const itemId = await idFrom(context);
  if (!itemId) return NextResponse.json({ message: "رقم البند غير صالح." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  if (!isMovementKind(source.kind)) {
    return NextResponse.json({ message: "نوع الحركة غير معروف." }, { status: 400 });
  }

  try {
    const saved = await recordMovement({
      itemId, kind: source.kind, qty: Number(source.qty),
      expiryDate: typeof source.expiryDate === "string" && source.expiryDate ? source.expiryDate : null,
      reason: typeof source.reason === "string" ? source.reason : null,
      visitId: Number.isInteger(Number(source.visitId)) && Number(source.visitId) > 0 ? Number(source.visitId) : null,
      patientId: Number.isInteger(Number(source.patientId)) && Number(source.patientId) > 0 ? Number(source.patientId) : null,
      actor: session.username,
    });
    if (!saved.ok) return NextResponse.json({ message: saved.message }, { status: 409 });
    void recordAudit({
      action: "chart.record", entity: "inventory_movements", entityId: saved.id,
      entityLabel: `${MOVEMENT_LABEL[source.kind]} — بند ${itemId}`,
      details: { الكمية: Number(source.qty), الرصيد: saved.balance },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ id: saved.id, balance: saved.balance }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر تسجيل الحركة." }, { status: 500 });
  }
}
