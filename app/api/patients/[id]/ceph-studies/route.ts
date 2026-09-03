import { NextResponse } from "next/server";
import { createCephStudy, listPatientStudies, recordAudit } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * الدراسات السيفالومترية في ملف المريض.
 *
 * وحارسُها حارسُ التتبّع نفسه: مواضع المعالم والقياسات تشخيصٌ سريري لا حالةُ
 * موعد. والاستقبال ترى أن للمريض أشعّة — لا ما قيس عليها.
 */

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const clinicalOnly = () =>
  NextResponse.json({ message: "الدراسة السيفالومترية للطبيب والمدير." }, { status: 403 });

const patientIdFrom = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role) && session.role !== "doctor") return clinicalOnly();
  const patientId = await patientIdFrom(context);
  if (!patientId) return NextResponse.json({ message: "رقم الملف غير صالح." }, { status: 400 });

  try {
    return NextResponse.json({ studies: await listPatientStudies(patientId) });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل الدراسات." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role) && session.role !== "doctor") return clinicalOnly();
  const patientId = await patientIdFrom(context);
  if (!patientId) return NextResponse.json({ message: "رقم الملف غير صالح." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const documentId = Number(source.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return NextResponse.json({ message: "اختر صورة الأشعة." }, { status: 400 });
  }
  const rawCase = Number(source.orthoCaseId);
  const orthoCaseId = Number.isInteger(rawCase) && rawCase > 0 ? rawCase : null;
  const rawTaken = typeof source.takenOn === "string" ? source.takenOn : "";

  try {
    const made = await createCephStudy({
      documentId,
      phase: source.phase,
      orthoCaseId,
      title: typeof source.title === "string" ? source.title.slice(0, 120) : null,
      takenOn: DATE_PATTERN.test(rawTaken) ? rawTaken : null,
      note: typeof source.note === "string" ? source.note.slice(0, 500) : null,
      actor: session.username,
    });
    if (!made.ok) return NextResponse.json({ message: made.message }, { status: 400 });
    void recordAudit({
      action: "ceph.study.create",
      entity: "ceph_studies",
      entityId: made.id,
      entityLabel: `دراسة على الأشعّة ${documentId}`,
      details: { المريض: patientId, المرحلة: String(source.phase) },
      actor: session.username,
      actorRole: session.role,
    });
    return NextResponse.json({ id: made.id }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر إنشاء الدراسة." }, { status: 500 });
  }
}
