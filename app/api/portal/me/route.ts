import { NextResponse } from "next/server";
import { requirePortalSession } from "@/lib/portalSession";

export const dynamic = "force-dynamic";

/**
 * من أنا في البوابة.
 *
 * ولا يُعاد إلا ما في التوكن نفسه: الاسم ورقم الملف. وقراءةٌ للقاعدة هنا تفتح
 * مسارًا يُستدعى في كل تحميل بلا أن يحتاج أحد ما فيه.
 */
export async function GET() {
  const session = await requirePortalSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  return NextResponse.json({
    fullName: session.fullName,
    patientNumber: session.patientNumber,
  });
}
