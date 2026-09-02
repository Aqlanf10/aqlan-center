import { NextResponse } from "next/server";
import { staffMessageVoice } from "@/lib/db";
import { readFileByKey } from "@/lib/files";
import { isSafeKey } from "@/lib/storage";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * تشغيل ملاحظةٍ صوتية.
 *
 * الرابط رقمٌ متسلسل — ومن يبدّله برقمٍ آخر يسمع رسالةً ليست له. فالحقّ يُفحص في
 * الاستعلام نفسه: مُرسِلها أو مُستقبِلها أو رسالةُ فريق، وما عداه ٤٠٤ لا ٤٠٣ —
 * فـ٤٠٣ تقول «هي موجودة ولستَ صاحبها»، وهذا وحده خبرٌ لا يُعطى.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const { id } = await context.params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return NextResponse.json({ message: "رسالة غير صالحة." }, { status: 400 });
  }

  try {
    const voice = await staffMessageVoice(messageId, session.userId);
    if (!voice || !isSafeKey(voice.key)) {
      return NextResponse.json({ message: "التسجيل غير موجود." }, { status: 404 });
    }
    const bytes = await readFileByKey(voice.key);
    if (!bytes) {
      return NextResponse.json({ message: "التسجيل غير موجود." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": voice.mime,
        "Content-Length": String(bytes.length),
        // خاصّة بالمستمع: خزانةٌ مشتركة تعني تسجيلًا يُخدَم لغير صاحبه.
        "Cache-Control": "private, max-age=0, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ message: "تعذّر تشغيل التسجيل." }, { status: 500 });
  }
}
