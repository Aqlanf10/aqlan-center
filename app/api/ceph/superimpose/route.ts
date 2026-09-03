import { NextResponse } from "next/server";
import { cephStudyAnalysis } from "@/lib/db";
import { chronologicalOrder } from "@/lib/cephCompare";
import { superimposeOnSN } from "@/lib/cephSuperimpose";
import { referenceLines } from "@/lib/ceph";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * تراكب دراستين — الأقدم تبقى مكانها والأحدث تُنقل إليها.
 *
 * والترتيب هو ترتيب المقارنة نفسه (`chronologicalOrder`)، فلا يقول الجدول شيئًا
 * ويقول الرسم غيره. ومصدرٌ واحد للترتيب لا اثنان.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role) && session.role !== "doctor") {
    return NextResponse.json({ message: "الدراسة السيفالومترية للطبيب والمدير." }, { status: 403 });
  }

  const url = new URL(request.url);
  const first = Number(url.searchParams.get("first"));
  const second = Number(url.searchParams.get("second"));
  if (!Number.isInteger(first) || first <= 0 || !Number.isInteger(second) || second <= 0) {
    return NextResponse.json({ message: "اختر دراستين للتراكب." }, { status: 400 });
  }
  if (first === second) {
    return NextResponse.json({ message: "الدراستان واحدة — اختر أخرى." }, { status: 400 });
  }

  try {
    const [one, two] = await Promise.all([cephStudyAnalysis(first), cephStudyAnalysis(second)]);
    if (!one || !two) {
      return NextResponse.json({ message: "إحدى الدراستين غير موجودة." }, { status: 404 });
    }
    if (one.study.patientId !== two.study.patientId) {
      return NextResponse.json({ message: "الدراستان لمريضين مختلفين." }, { status: 400 });
    }

    const [before, after] = chronologicalOrder(
      { ...one.study, reading: one },
      { ...two.study, reading: two },
    );

    const placed = superimposeOnSN(
      { points: before.reading.points, calibration: before.reading.calibration, aspect: before.reading.aspect },
      { points: after.reading.points, calibration: after.reading.calibration, aspect: after.reading.aspect },
    );
    if (!placed.ok) {
      // ٤٠٩ لا ٤٠٠: الطلب سليم والبيانات هي التي لا تكفي — والرسالة تقول ما يُفعل.
      return NextResponse.json({ message: placed.message }, { status: 409 });
    }

    return NextResponse.json({
      before: {
        id: before.id, phase: before.phase, revision: before.revision,
        takenOn: before.takenOn, documentId: before.documentId,
        lines: referenceLines(before.reading.points),
      },
      after: {
        id: after.id, phase: after.phase, revision: after.revision,
        takenOn: after.takenOn, documentId: after.documentId,
        // معالمُ الأحدث منقولةً إلى فضاء الأقدم — تُرسم على صورتها.
        lines: referenceLines(placed.value.points),
      },
      scale: placed.value.scale,
      rotationDegrees: placed.value.rotationDegrees,
      cranialBaseBefore: placed.value.cranialBaseBefore,
      cranialBaseAfter: placed.value.cranialBaseAfter,
    });
  } catch {
    return NextResponse.json({ message: "تعذّر التراكب." }, { status: 500 });
  }
}
