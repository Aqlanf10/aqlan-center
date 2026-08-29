import { NextResponse } from "next/server";
import { listReferenceSets, recordAudit, setReferenceValue } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * المجموعات المرجعية السيفالومترية.
 *
 * القراءة للسريريين — الطبيب يحتاج أن يرى بأيّ معيارٍ حُكم على مريضه، ومن أيّ
 * مرجع. والتعديل للمدير وحده: تغيير متوسّطٍ واحد يقلب حكم كل تحليلٍ بعده.
 */

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

export async function GET() {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role) && session.role !== "doctor") {
    return NextResponse.json({ message: "المعايير السيفالومترية للطبيب والمدير." }, { status: 403 });
  }
  try {
    return NextResponse.json({ sets: await listReferenceSets() });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل المعايير." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "تعديل المعايير للمدير وحده." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  const setId = Number(source.setId);
  const measurement = typeof source.measurement === "string" ? source.measurement.trim() : "";
  if (!Number.isInteger(setId) || setId <= 0 || !measurement) {
    return NextResponse.json({ message: "المجموعة والقياس مطلوبان." }, { status: 400 });
  }

  try {
    const saved = await setReferenceValue({
      setId, measurement,
      mean: Number(source.mean),
      tolerance: Number(source.tolerance),
      source: typeof source.source === "string" ? source.source : "",
      actor: session.username,
    });
    if (!saved.ok) return NextResponse.json({ message: saved.message }, { status: 400 });
    // تغيير معيارٍ يُعاد به حكمُ كل تحليلٍ يُقرأ بعده — فيُسجَّل بمن غيّره وبكم.
    void recordAudit({
      action: "settings.update",
      entity: "ceph_reference_values",
      entityId: setId,
      entityLabel: `معيار ${measurement}`,
      details: { المتوسط: Number(source.mean), الانحراف: Number(source.tolerance) },
      actor: session.username,
      actorRole: session.role,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ المعيار." }, { status: 500 });
  }
}
