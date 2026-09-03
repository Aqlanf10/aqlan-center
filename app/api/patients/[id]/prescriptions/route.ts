import { NextResponse } from "next/server";
import { createPrescription, listPatientPrescriptions, recordAudit } from "@/lib/db";
import { readDraft } from "@/lib/prescription";
import { canTreat } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** وصفات مريض — للطبيب والمدير، فهي تشخيصٌ لا بيانُ حساب. */
export async function GET(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!canTreat(session.role)) {
    return NextResponse.json({ message: "الوصفات للطبيب والمدير." }, { status: 403 });
  }
  const { id } = await params;
  const patientId = Number(id);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return NextResponse.json({ message: "رقم المريض غير صالح." }, { status: 400 });
  }
  try {
    return NextResponse.json({ prescriptions: await listPatientPrescriptions(patientId) });
  } catch {
    return NextResponse.json({ message: "تعذّرت قراءة الوصفات." }, { status: 500 });
  }
}

/**
 * إصدار وصفة.
 *
 * والإصدار فعلٌ نهائي: تخرج نسخةُ المريض من الطابعة ولا تعود. فما بعده تصحيحٌ
 * بإبطالٍ مُعلَّل ووصفةٍ جديدة، لا تعديلٌ على المحفوظ.
 */
export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!canTreat(session.role)) {
    return NextResponse.json({ message: "الوصفة يكتبها الطبيب." }, { status: 403 });
  }
  const { id } = await params;
  const patientId = Number(id);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return NextResponse.json({ message: "رقم المريض غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }

  /*
   * المريض من المسار لا من الجسد.
   *
   * فمن يرسل `patientId` مخالفًا للمسار يكتب وصفةً في ملفٍ غير الذي فتحه —
   * والمسار هو ما فحصته الشاشة وما يظهر في العنوان.
   */
  const draft = readDraft({ ...(body ?? {}), patientId });
  if (!draft.ok) return NextResponse.json({ message: draft.message }, { status: 400 });

  try {
    const created = await createPrescription(draft.value, session.username);
    if (!created.ok) return NextResponse.json({ message: created.message }, { status: 400 });
    await recordAudit({
      action: "prescription.issue", entity: "prescription", entityId: created.id,
      details: { المريض: patientId, عدد_الأدوية: draft.value.items.length },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ الوصفة." }, { status: 500 });
  }
}
