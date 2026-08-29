import { NextResponse } from "next/server";
import { getCephTracing, recordAudit, saveCephTracing } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * التتبّع السيفالومتري على صورة أشعة.
 *
 * التتبّع عملٌ سريري: يقرّر أين تقع النقاط التشريحية، وعليه تُبنى خطة العلاج.
 * فهو للطبيب والمدير — لا للاستقبال.
 */

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const clinicalOnly = () =>
  NextResponse.json({ message: "التتبّع السيفالومتري للطبيب والمدير." }, { status: 403 });

const idFrom = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  // القراءة كالكتابة: مواضع المعالم والقياسات تشخيصٌ سريري، لا حالةُ موعد.
  // كان الحارس على الكتابة وحدها، فكانت الاستقبال تقرأ تحليل المريض كاملًا.
  if (!isAdmin(session.role) && session.role !== "doctor") return clinicalOnly();
  const documentId = await idFrom(context);
  if (!documentId) return NextResponse.json({ message: "رقم الصورة غير صالح." }, { status: 400 });

  // نسبة الصورة تأتي من المتصفّح لأنه وحده يعرف أبعادها الفعلية بعد التحميل —
  // وبلا هذه النسبة تُحسب الزوايا على صورةٍ يُفترض أنها مربّعة، فتخرج خطأً.
  const aspect = Number(new URL(request.url).searchParams.get("aspect"));
  try {
    const tracing = await getCephTracing(
      documentId, Number.isFinite(aspect) && aspect > 0 ? aspect : undefined,
    );
    return NextResponse.json({ tracing });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل التتبّع." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role) && session.role !== "doctor") return clinicalOnly();

  const documentId = await idFrom(context);
  if (!documentId) return NextResponse.json({ message: "رقم الصورة غير صالح." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  try {
    const saved = await saveCephTracing({
      documentId,
      points: source.points,
      calibration: source.calibration,
      note: typeof source.note === "string" ? source.note.slice(0, 300) : null,
      actor: session.username,
    });
    if (!saved.ok) return NextResponse.json({ message: saved.message }, { status: 409 });
    void recordAudit({
      action: "chart.record",
      entity: "ceph_tracings",
      entityId: saved.id,
      entityLabel: `تتبّع سيفالومتري — صورة ${documentId}`,
      details: { النقاط: Object.keys(source.points ?? {}).length },
      actor: session.username,
      actorRole: session.role,
    });
    return NextResponse.json({ id: saved.id });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ التتبّع." }, { status: 500 });
  }
}
