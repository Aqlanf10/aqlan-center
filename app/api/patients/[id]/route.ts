import { NextResponse } from "next/server";
import { getPatientFile, updatePatient } from "@/lib/db";
import { toWhatsAppNumber } from "@/lib/reminders";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

function readId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return denied();
  const { id: rawId } = await context.params;
  const id = readId(rawId);
  if (id === null) return NextResponse.json({ message: "رقم المريض غير صالح." }, { status: 400 });

  try {
    const file = await getPatientFile(id);
    if (!file) return NextResponse.json({ message: "لا يوجد مريض بهذا الرقم." }, { status: 404 });
    return NextResponse.json(file);
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل ملف المريض." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return denied();
  const { id: rawId } = await context.params;
  const id = readId(rawId);
  if (id === null) return NextResponse.json({ message: "رقم المريض غير صالح." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const patch: { fullName?: string; phone?: string | null; note?: string | null } = {};

  if (typeof source.fullName === "string") {
    const fullName = source.fullName.trim().replace(/\s+/g, " ");
    if (fullName.length < 2 || fullName.length > 120) {
      return NextResponse.json({ message: "الاسم غير صالح." }, { status: 400 });
    }
    patch.fullName = fullName;
  }

  if (typeof source.phone === "string") {
    const raw = source.phone.trim();
    // حذف الرقم مسموح صراحةً؛ ورقمٌ مكتوب يُرفض إن لم يصلح للاتصال، لأن رقمًا خاطئًا
    // في السجل أسوأ من غيابه: الاستقبال تظن أنها تستطيع تذكيره ولا تستطيع.
    if (raw && !toWhatsAppNumber(raw) && !/^\d[\d\-\s]{5,}$/.test(raw)) {
      return NextResponse.json({ message: "رقم الجوال غير صحيح." }, { status: 400 });
    }
    patch.phone = raw || null;
  }

  if (typeof source.note === "string") {
    patch.note = source.note.trim().slice(0, 2000) || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ message: "لا يوجد ما يُحدَّث." }, { status: 400 });
  }

  try {
    const updated = await updatePatient(id, patch);
    if (!updated) return NextResponse.json({ message: "لا يوجد مريض بهذا الرقم." }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ التعديل. أعد المحاولة." }, { status: 500 });
  }
}
