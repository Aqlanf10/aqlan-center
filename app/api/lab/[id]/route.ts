import { NextResponse } from "next/server";
import { recordAudit, setLabOrderDoctor, setLabOrderDueDate, setLabOrderStatus } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import type { LabOrderStatus } from "@/lib/lab";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: LabOrderStatus[] = ["sent", "received", "delivered", "cancelled"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم العمل غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  try {
    /*
     * نسبةُ العمل إلى طبيبه — المخرج من «تكلفةٌ بلا طبيب».
     *
     * وهي للمدير: النسبة تحكم ما يُخصم من عمولة طبيب، فتغييرُها من أيّ جلسةٍ
     * يجعل من ينقر يخصم من زميله.
     */
    if (source.doctorId !== undefined) {
      if (!isAdmin(session.role)) {
        return NextResponse.json({ message: "نسبة العمل إلى طبيبه للمدير." }, { status: 403 });
      }
      const raw = source.doctorId;
      const doctorPartyId = raw === null || String(raw).trim() === "" ? null : Number(raw);
      if (doctorPartyId !== null && (!Number.isInteger(doctorPartyId) || doctorPartyId <= 0)) {
        return NextResponse.json({ message: "رقم الطبيب غير صالح." }, { status: 400 });
      }
      const done = await setLabOrderDoctor(id, doctorPartyId);
      if (!done.ok) return NextResponse.json({ message: done.message }, { status: 400 });
      await recordAudit({
        action: "lab.order.doctor", entity: "lab_order", entityId: id,
        details: { نسبة_إلى_طبيب: doctorPartyId },
        actor: session.username, actorRole: session.role,
      });
      return NextResponse.json({ ok: true });
    }

    if (typeof source.dueDate === "string") {
      if (!DATE_PATTERN.test(source.dueDate)) {
        return NextResponse.json({ message: "تاريخ غير صالح." }, { status: 400 });
      }
      const updated = await setLabOrderDueDate(id, source.dueDate);
      if (!updated) {
        return NextResponse.json(
          { message: "لا يمكن تأجيل عمل وصل أو أُلغي." },
          { status: 409 },
        );
      }
      return NextResponse.json(updated);
    }

    const status = typeof source.status === "string" ? source.status : "";
    if (!STATUSES.includes(status as LabOrderStatus)) {
      return NextResponse.json({ message: "حالة غير معروفة." }, { status: 400 });
    }
    const updated = await setLabOrderStatus(id, status as LabOrderStatus);
    if (!updated) {
      // الرفض هنا يعني أن جهازًا آخر سبقنا، أو أن الانتقال غير منطقي (مركَّب ثم مُرسَل).
      return NextResponse.json(
        { message: "حالة العمل تغيّرت من جهاز آخر. حدّثت القائمة — راجعها." },
        { status: 409 },
      );
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ message: "تعذّر تنفيذ الإجراء. أعد المحاولة." }, { status: 500 });
  }
}
