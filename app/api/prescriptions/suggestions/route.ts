import { NextResponse } from "next/server";
import { prescribedBefore } from "@/lib/db";
import { canTreat } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** أدويةٌ سبق أن وُصفت — تُقترح فيقلّ النقر، ولا تُفرض. */
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!canTreat(session.role)) {
    return NextResponse.json({ message: "الوصفات للطبيب والمدير." }, { status: 403 });
  }
  try {
    return NextResponse.json({ items: await prescribedBefore() });
  } catch {
    return NextResponse.json({ message: "تعذّرت قراءة المقترحات." }, { status: 500 });
  }
}
