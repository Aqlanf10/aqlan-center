import { NextResponse } from "next/server";
import { getPrescription, recordAudit, voidPrescription } from "@/lib/db";
import { checkVoid } from "@/lib/prescription";
import { canTreat } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * إبطال وصفة.
 *
 * ولا حذف: المريض خرج بنسخته، فمحوُ الأصل من الملف يجعل في يده ورقةً لا أثر
 * لها عندنا. والإبطال يُبقيها ويقول متى بطلت وبأمر من ولماذا.
 */
export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!canTreat(session.role)) {
    return NextResponse.json({ message: "إبطال الوصفة للطبيب والمدير." }, { status: 403 });
  }
  const { id } = await params;
  const rxId = Number(id);
  if (!Number.isInteger(rxId) || rxId <= 0) {
    return NextResponse.json({ message: "رقم الوصفة غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }

  try {
    const rx = await getPrescription(rxId);
    if (!rx) return NextResponse.json({ message: "الوصفة غير موجودة." }, { status: 404 });

    const check = checkVoid(rx, (body as Record<string, unknown>)?.reason);
    if (!check.ok) return NextResponse.json({ message: check.message }, { status: 400 });

    const done = await voidPrescription({ id: rxId, reason: check.reason, actor: session.username });
    if (!done.ok) return NextResponse.json({ message: done.message }, { status: 409 });

    await recordAudit({
      action: "prescription.void", entity: "prescription", entityId: rxId,
      details: { المريض: rx.patientId, السبب: check.reason },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "تعذّر إبطال الوصفة." }, { status: 500 });
  }
}
