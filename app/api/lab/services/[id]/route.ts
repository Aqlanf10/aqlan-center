import { NextResponse } from "next/server";
import { deactivateLabService, recordAudit, updateLabService } from "@/lib/db";
import { readService } from "@/lib/labCatalog";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function guard() {
  const session = await requireSession();
  if (!session) {
    return { error: NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 }) };
  }
  if (!isAdmin(session.role)) {
    return { error: NextResponse.json({ message: "كتالوج المختبر للمدير." }, { status: 403 }) };
  }
  return { session };
}

export async function PATCH(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const guarded = await guard();
  if ("error" in guarded) return guarded.error;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم العمل غير صالح." }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const draft = readService(body);
  if (!draft.ok) return NextResponse.json({ message: draft.message }, { status: 400 });
  try {
    const done = await updateLabService(id, draft.value);
    if (!done.ok) return NextResponse.json({ message: done.message }, { status: 409 });
    await recordAudit({
      action: "lab.service", entity: "lab_service", entityId: id,
      details: { تعديل: draft.value.name },
      actor: guarded.session.username, actorRole: guarded.session.role,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "تعذّر تعديل العمل." }, { status: 500 });
  }
}

/** الإيقاف لا الحذف: الأوامر القديمة تشير إليه، وحذفُه يترك تقاريرها بلا اسم. */
export async function DELETE(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const guarded = await guard();
  if ("error" in guarded) return guarded.error;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم العمل غير صالح." }, { status: 400 });
  }
  try {
    if (!(await deactivateLabService(id))) {
      return NextResponse.json({ message: "العمل غير موجود." }, { status: 404 });
    }
    await recordAudit({
      action: "lab.service", entity: "lab_service", entityId: id,
      details: { إيقاف: true },
      actor: guarded.session.username, actorRole: guarded.session.role,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "تعذّر إيقاف العمل." }, { status: 500 });
  }
}
