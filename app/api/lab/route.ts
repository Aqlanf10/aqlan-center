import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, createLabOrder, listLabNames, listLabOrders } from "@/lib/db";
import { labSummary } from "@/lib/lab";
import { clinicDateString } from "@/lib/schedule";
import { toWhatsAppNumber } from "@/lib/reminders";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

export async function GET(request: Request) {
  if (!(await requireSession())) return denied();
  // اللوحة تسأل عن الأرقام وحدها كل عشرين ثانية: تحميل ثلاثمئة صف في كل نبضة على
  // هاتف الاستقبال هو الفرق بين لوحة تعمل ولوحة تُقفَل بعد يوم.
  const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
  try {
    if (summaryOnly) {
      const orders = await listLabOrders();
      return NextResponse.json(labSummary(orders, clinicDateString(new Date(), CLINIC_TIME_ZONE)));
    }
    const [orders, labs] = await Promise.all([listLabOrders(), listLabNames()]);
    return NextResponse.json({ orders, labs });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل أعمال المختبر." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return denied();
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const patientId = Number(source.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return NextResponse.json({ message: "اختر المريض أولًا." }, { status: 400 });
  }
  const labName = typeof source.labName === "string" ? source.labName.trim() : "";
  if (!labName || labName.length > 80) {
    return NextResponse.json({ message: "اكتب اسم المختبر." }, { status: 400 });
  }
  const workType = typeof source.workType === "string" ? source.workType.trim() : "";
  if (!workType || workType.length > 80) {
    return NextResponse.json({ message: "اختر نوع العمل." }, { status: 400 });
  }
  const sentDate = typeof source.sentDate === "string" ? source.sentDate : "";
  const dueDate = typeof source.dueDate === "string" ? source.dueDate : "";
  if (!DATE_PATTERN.test(sentDate) || !DATE_PATTERN.test(dueDate)) {
    return NextResponse.json({ message: "تاريخ غير صالح." }, { status: 400 });
  }
  // موعد تسليم قبل الإرسال يجعل العمل «متأخرًا» لحظة إنشائه، فيسمّم قائمة المتأخر كلها.
  if (dueDate < sentDate) {
    return NextResponse.json({ message: "موعد التسليم قبل تاريخ الإرسال." }, { status: 400 });
  }

  let labPhone: string | null = null;
  if (typeof source.labPhone === "string" && source.labPhone.trim()) {
    labPhone = toWhatsAppNumber(source.labPhone) ?? source.labPhone.trim().slice(0, 30);
  }

  const details = typeof source.details === "string" && source.details.trim()
    ? source.details.trim().slice(0, 300) : null;
  const note = typeof source.note === "string" && source.note.trim()
    ? source.note.trim().slice(0, 300) : null;

  try {
    const created = await createLabOrder({
      patientId, labName, labPhone, workType, details, sentDate, dueDate, note,
    });
    if (!created) return NextResponse.json({ message: "تعذّر حفظ العمل." }, { status: 500 });
    return NextResponse.json(created, { status: 201 });
  } catch {
    // المريض المحذوف أو غير الموجود يسقط على قيد المفتاح الأجنبي.
    return NextResponse.json({ message: "تعذّر حفظ العمل. تأكد من المريض وأعد المحاولة." }, { status: 500 });
  }
}
