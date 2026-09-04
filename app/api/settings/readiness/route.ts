import { NextResponse } from "next/server";
import { readinessFacts } from "@/lib/db";
import { readinessChecks, readinessVerdict } from "@/lib/readiness";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * ما الذي يمنع بدء العمل على النظام اليوم؟
 *
 * **للمدير وحده**: البنود تقول كم مستخدمًا في النظام، ومتى آخر نسخة احتياطية،
 * وأرمزُ التنصيب حيٌّ — وهي خارطةُ ما ينقص لمن أراد الدخول، لا تُعطى لكل من
 * يملك جلسة. و`/api/health` يبقى مفتوحًا لأنه يقول «ينقص متغيّر» ولا يقول
 * كم حسابًا هنا ولا متى آخر نسخة.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "شاشة الجاهزية للمدير وحده." }, { status: 403 });
  }
  try {
    const checks = readinessChecks(await readinessFacts());
    return NextResponse.json({ checks, verdict: readinessVerdict(checks) });
  } catch {
    return NextResponse.json({ message: "تعذّر قراءة حالة النظام." }, { status: 500 });
  }
}
