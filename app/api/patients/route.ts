import { NextResponse } from "next/server";
import { createPatient, searchPatients } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

export async function GET(request: Request) {
  if (!(await requireSession())) return denied();
  const term = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json(await searchPatients(term));
  } catch {
    return NextResponse.json({ message: "تعذّر البحث. أعد المحاولة." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return denied();
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 }); }

  const source = (body ?? {}) as Record<string, unknown>;
  const fullName = typeof source.fullName === "string" ? source.fullName.trim() : "";
  if (!fullName) return NextResponse.json({ message: "اسم المريض مطلوب." }, { status: 400 });
  if (fullName.length > 120) return NextResponse.json({ message: "الاسم طويل أكثر من اللازم." }, { status: 400 });

  const phone = typeof source.phone === "string" ? source.phone.trim() : "";
  const note = typeof source.note === "string" ? source.note.trim() : "";
  try {
    return NextResponse.json(
      await createPatient({ fullName, phone: phone || null, note: note ? note.slice(0, 300) : null }),
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ المريض. أعد المحاولة." }, { status: 500 });
  }
}
