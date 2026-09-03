import { NextResponse } from "next/server";
import { cephStudyAnalysis } from "@/lib/db";
import { chronologicalOrder, compareAnalyses, comparisonSummary } from "@/lib/cephCompare";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * مقارنة دراستين.
 *
 * والترتيب يُفرض هنا لا يُترك للمستدعي: الأقدم «قبل» والأحدث «بعد» — وقلبُهما
 * يقلب كل إشارة وكل حكم، فيُقرأ تراجعٌ على أنه تحسّن. والشاشة تعرض تاريخ كلٍّ
 * منهما بعد ذلك صراحةً.
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
    return NextResponse.json({ message: "اختر دراستين للمقارنة." }, { status: 400 });
  }
  if (first === second) {
    return NextResponse.json({ message: "الدراستان واحدة — اختر أخرى." }, { status: 400 });
  }

  try {
    const [one, two] = await Promise.all([cephStudyAnalysis(first), cephStudyAnalysis(second)]);
    if (!one || !two) {
      return NextResponse.json({ message: "إحدى الدراستين غير موجودة." }, { status: 404 });
    }
    // مريضان مختلفان: مقارنةٌ بلا معنى، وخطأٌ لا يُكتشف إلّا بعد أن يُبنى عليه.
    if (one.study.patientId !== two.study.patientId) {
      return NextResponse.json({ message: "الدراستان لمريضين مختلفين." }, { status: 400 });
    }

    /*
     * الترتيب حاسمٌ لا يتبع من نادى.
     *
     * والتاريخ وحده لا يكفي: إصدارا دراسةٍ على أشعّةٍ واحدة يرثان تاريخ تصويرها
     * نفسه فيتساويان — فكان قلبُ المعاملين يقلب كل فرقٍ وكل حكم.
     */
    const [before, after] = chronologicalOrder(
      { ...one.study, analysis: one.analysis },
      { ...two.study, analysis: two.analysis },
    );

    const comparison = compareAnalyses(before.analysis, after.analysis);
    return NextResponse.json({
      before,
      after,
      comparison,
      summary: comparisonSummary(comparison),
    });
  } catch {
    return NextResponse.json({ message: "تعذّرت المقارنة." }, { status: 500 });
  }
}
