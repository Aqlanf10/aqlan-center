import { NextResponse } from "next/server";
import { latestIntake, recordAudit, submitIntake } from "@/lib/db";
import { validateIntake } from "@/lib/intake";
import { requirePortalSession } from "@/lib/portalSession";

export const dynamic = "force-dynamic";

/**
 * استمارة التاريخ الطبي.
 *
 * وتُقرأ آخرُ استمارةٍ لا كلُّها: البوابة تُري المريض ما قاله آخر مرّة ليُحدّثه،
 * وتاريخُه كلّه للطاقم لا له — هو يعرفه.
 */
const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

export async function GET() {
  const session = await requirePortalSession();
  if (!session) return denied();
  try {
    return NextResponse.json({ intake: await latestIntake(session.patientId) });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل استمارتك." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requirePortalSession();
  if (!session) return denied();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const answers = validateIntake(body);
  if (!answers.ok) return NextResponse.json({ message: answers.message }, { status: 400 });

  try {
    /*
     * تُكتب **لهذا المريض** — رقمه من التوكن الموقَّع لا من الطلب.
     *
     * ولا تُكتب في `patients.medical_alert`: ذاك حقلُ الطبيب. وقولُ المريض «لا
     * حساسية» لا يصير تنبيهًا سريريًّا لأنه كُتب — الطبيب يقرأ ثم يقرّر، وخلطُ
     * الاثنين يجعل نصّ مريضٍ بلا مراجعةٍ يظهر بشارة الخطر الحمراء على ملفّه.
     */
    const saved = await submitIntake(session.patientId, answers.value);
    void recordAudit({
      action: "chart.record", entity: "patient_intake", entityId: saved.id,
      entityLabel: `استمارة صحّية من البوابة — ${session.patientNumber}`,
      details: { الحالات: answers.value.conditions.length },
      actor: `مريض ${session.patientNumber}`, actorRole: "patient",
    });
    return NextResponse.json({ intake: saved }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ استمارتك." }, { status: 500 });
  }
}
