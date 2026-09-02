import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, confirmAppointmentByPatient, recordAudit } from "@/lib/db";
import { requirePortalSession } from "@/lib/portalSession";
import { clinicDateString } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/**
 * تأكيد المريض حضوره.
 *
 * وهو **كل ما تكتبه البوابة**: لا تدفع ولا تُعدّل ولا تحجز. والحجز يبقى طلبًا
 * تؤكّده الاستقبال (`/book`) — فبوابةٌ تكتب في المواعيد مباشرةً تملأ يومًا بأسماء
 * لم يرها أحد.
 *
 * ويُسجَّل في سجلّ التدقيق كغيره: من غيّر شيئًا في السجلّ يُعرف، والمريض ليس استثناءً.
 */
export async function POST(request: Request) {
  const session = await requirePortalSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const appointmentId = Number((body as { appointmentId?: unknown })?.appointmentId);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return NextResponse.json({ message: "رقم الموعد غير صالح." }, { status: 400 });
  }

  try {
    const saved = await confirmAppointmentByPatient({
      appointmentId,
      patientId: session.patientId,
      today: clinicDateString(new Date(), CLINIC_TIME_ZONE),
    });
    if (!saved.ok) {
      // «لم نجد هذا الموعد في ملفّك» تُردّ 404 لا 403: الفرق بينهما يقول لمن يجرّب
      // أرقامًا إن كان الموعد موجودًا لغيره.
      return NextResponse.json({ message: saved.message }, { status: saved.reason === "not_found" ? 404 : 409 });
    }
    void recordAudit({
      action: "chart.record", entity: "appointments", entityId: appointmentId,
      entityLabel: `تأكيد حضور من البوابة — ${session.patientNumber}`,
      details: {}, actor: `مريض ${session.patientNumber}`, actorRole: "patient",
    });
    return NextResponse.json({ confirmedAt: saved.confirmedAt });
  } catch {
    return NextResponse.json({ message: "تعذّر تأكيد الموعد." }, { status: 500 });
  }
}
