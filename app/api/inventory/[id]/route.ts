import { NextResponse } from "next/server";
import { recordAudit, updateInventoryItem } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * تعديل بند مخزون — للمدير وحده.
 *
 * تسجيل الحركة يقع على الكرسي فهو لكل من يعمل؛ أما حدّ الطلب وإيقاف البند فقراران
 * يغيّران ما تراه الشاشة كلّها، لا ما يخصّ مريضًا واحدًا.
 */

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "تعديل بنود المخزون للمدير." }, { status: 403 });
  }

  const { id } = await context.params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ message: "رقم البند غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  try {
    const saved = await updateInventoryItem({
      id: itemId,
      name: typeof source.name === "string" ? source.name : undefined,
      category: typeof source.category === "string" ? source.category : undefined,
      unit: typeof source.unit === "string" ? source.unit : undefined,
      minLevel: source.minLevel === undefined ? undefined : Number(source.minLevel),
      note: source.note === undefined ? undefined : (typeof source.note === "string" ? source.note : null),
      isActive: typeof source.isActive === "boolean" ? source.isActive : undefined,
    });
    if (!saved.ok) return NextResponse.json({ message: saved.message }, { status: 400 });
    void recordAudit({
      action: "settings.update", entity: "inventory_items", entityId: itemId,
      entityLabel: `تعديل بند مخزون ${itemId}`,
      details: typeof source.isActive === "boolean"
        ? { الحالة: source.isActive ? "مفعّل" : "موقوف" } : {},
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "تعذّر تعديل البند." }, { status: 500 });
  }
}
