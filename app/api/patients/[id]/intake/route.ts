import { NextResponse } from "next/server";
import { intakeHistory } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * ما قاله المريض عن صحّته — للطاقم.
 *
 * ويُعاد **تاريخُه كلّه** لا آخره وحده: الفرق بين استمارتين هو متى تغيّرت صحّته،
 * وهو ما يُسأل عنه حين يقع ما يُسأل عنه.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const { id } = await context.params;
  const patientId = Number(id);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return NextResponse.json({ message: "رقم المريض غير صالح." }, { status: 400 });
  }
  try {
    return NextResponse.json({ intake: await intakeHistory(patientId) });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل الاستمارة الصحّية." }, { status: 500 });
  }
}
