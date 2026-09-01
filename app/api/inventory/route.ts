import { NextResponse } from "next/server";
import { createInventoryItem, listInventory, recordAudit } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * المخزون.
 *
 * القراءة لكل من يعمل: الطبيب يريد أن يعرف أن المادّة موجودة قبل أن يبدأ، والاستقبال
 * تطلب ما نقص. وإنشاء البنود وتعطيلها للمدير: بندٌ يُضاف بلا ضبط يقسم رصيدًا، ويُعطَّل
 * فتختفي حركاته من الشاشة.
 */

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ items: await listInventory(includeInactive && isAdmin(session.role)) });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل المخزون." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "إضافة بنود المخزون للمدير." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  try {
    const created = await createInventoryItem({
      name: typeof source.name === "string" ? source.name : "",
      category: typeof source.category === "string" ? source.category : "other",
      unit: typeof source.unit === "string" ? source.unit : "",
      minLevel: Number(source.minLevel ?? 0),
      note: typeof source.note === "string" ? source.note : null,
      actor: session.username,
    });
    if (!created.ok) return NextResponse.json({ message: created.message }, { status: 400 });
    void recordAudit({
      action: "settings.update", entity: "inventory_items", entityId: created.id,
      entityLabel: `بند مخزون — ${String(source.name ?? "").trim()}`,
      details: {}, actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر إضافة البند." }, { status: 500 });
  }
}
