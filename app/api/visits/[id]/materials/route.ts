import { NextResponse } from "next/server";
import { listVisitMaterials } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * المواد المصروفة على زيارة.
 *
 * قراءةٌ فقط: الصرف نفسه يمرّ من مسار المخزون كي يبقى حارسٌ واحد على ما يُسجَّل —
 * لا رصيدَ سالب ولا بندَ موقوف — ولا يُنشأ بابٌ ثانٍ إلى الجدول نفسه بفحصٍ أضعف.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const { id } = await context.params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json({ message: "رقم الزيارة غير صالح." }, { status: 400 });
  }
  try {
    return NextResponse.json({ materials: await listVisitMaterials(visitId) });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل المواد المصروفة." }, { status: 500 });
  }
}
