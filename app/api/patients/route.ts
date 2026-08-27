import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, createPatient, listPatients, searchPatients } from "@/lib/db";
import { validatePatient } from "@/lib/patient";
import { clinicDateString } from "@/lib/schedule";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  if (!(await requireSession())) return denied();
  const params = new URL(request.url).searchParams;
  const term = params.get("q") ?? "";

  try {
    if (term.trim()) return NextResponse.json(await searchPatients(term, 20));

    // بلا كلمة بحث: صفحة من كل المرضى. الحدّ مغلق هنا لا مأخوذ من الطلب — رقم ضخم
    // في `offset` أو `limit` يجرّ الجدول كله إلى هاتف الاستقبال.
    const page = Math.max(0, Math.floor(Number(params.get("page") ?? 0)) || 0);
    const { rows, total } = await listPatients(page * PAGE_SIZE, PAGE_SIZE);
    return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE });
  } catch {
    return NextResponse.json({ message: "تعذّر البحث. أعد المحاولة." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return denied();
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }

  const today = clinicDateString(new Date(), CLINIC_TIME_ZONE);
  const validation = validatePatient((body ?? {}) as Record<string, unknown>, today);
  if (!validation.ok) {
    return NextResponse.json({ message: validation.message, field: validation.field }, { status: 400 });
  }

  try {
    return NextResponse.json(await createPatient(validation.value), { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ المريض. أعد المحاولة." }, { status: 500 });
  }
}
