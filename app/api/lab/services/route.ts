import { NextResponse } from "next/server";
import { createLabService, listLabServices, recordAudit } from "@/lib/db";
import { readService } from "@/lib/labCatalog";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** الكتالوج يقرؤه كلُّ من يفتح شاشة المختبر — فهو قائمة اختيارٍ لا سرّ. */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const all = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ services: await listLabServices(all && isAdmin(session.role)) });
  } catch {
    return NextResponse.json({ message: "تعذّرت قراءة أعمال المختبر." }, { status: 500 });
  }
}

/** وإضافته للمدير: هو من يتّفق مع المختبرات ويحدّد ما يُطلب منها. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "كتالوج المختبر للمدير." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const draft = readService(body);
  if (!draft.ok) return NextResponse.json({ message: draft.message }, { status: 400 });
  try {
    const created = await createLabService(draft.value, session.username);
    if (!created.ok) return NextResponse.json({ message: created.message }, { status: 409 });
    await recordAudit({
      action: "lab.service", entity: "lab_service", entityId: created.id,
      details: { العمل: draft.value.name },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ العمل." }, { status: 500 });
  }
}
