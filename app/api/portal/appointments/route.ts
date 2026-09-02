import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, portalAppointments } from "@/lib/db";
import { toPortalAppointment } from "@/lib/portal";
import { requirePortalSession } from "@/lib/portalSession";
import { clinicDateString } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** مواعيد المريض — مواعيده هو، ورقمُه من التوكن لا من الطلب. */
export async function GET() {
  const session = await requirePortalSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const today = clinicDateString(new Date(), CLINIC_TIME_ZONE);
  try {
    const appointments = await portalAppointments(session.patientId);
    return NextResponse.json({
      today,
      appointments: appointments.map((one) =>
        toPortalAppointment(
          {
            id: one.id,
            scheduledDate: one.scheduledDate,
            scheduledTime: one.scheduledTime,
            durationMinutes: one.durationMinutes,
            appointmentType: one.appointmentType ?? null,
            note: one.note,
            status: one.status,
          },
          one.patientConfirmedAt ?? null,
          today,
        )),
    });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل مواعيدك." }, { status: 500 });
  }
}
