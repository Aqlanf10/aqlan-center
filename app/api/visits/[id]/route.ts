import { NextResponse } from "next/server";
import { finishVisit, seatVisit } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "رقم الزيارة غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }

  const source = (body ?? {}) as Record<string, unknown>;
  const action = typeof source.action === "string" ? source.action : "";

  try {
    if (action === "seat") {
      const chair = Number(source.chair);
      if (!Number.isInteger(chair) || chair <= 0) {
        return NextResponse.json({ message: "رقم الكرسي غير صالح." }, { status: 400 });
      }
      const seated = await seatVisit(id, chair);
      // فشل الإجلاس يعني أن جهازًا آخر سبقنا إلى الكرسي، أو أن المريض لم يعد منتظرًا.
      // الرسالة تقول ذلك بدل «حدث خطأ»، لأن الإجراء الصحيح مختلف تمامًا: انظر اللوحة.
      if (!seated) {
        return NextResponse.json(
          { message: "الكرسي شُغل للتو أو تغيّرت حالة المريض. حدّثت اللوحة — راجعها." },
          { status: 409 },
        );
      }
      return NextResponse.json(seated);
    }

    if (action === "finish") {
      const finished = await finishVisit(id);
      if (!finished) {
        return NextResponse.json({ message: "الزيارة منتهية بالفعل." }, { status: 409 });
      }
      return NextResponse.json(finished);
    }

    return NextResponse.json({ message: "إجراء غير معروف." }, { status: 400 });
  } catch {
    return NextResponse.json({ message: "تعذّر تنفيذ الإجراء. أعد المحاولة." }, { status: 500 });
  }
}
