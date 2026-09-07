import { NextResponse } from "next/server";
import { listMaterialRates, recordAudit, setMaterialRate } from "@/lib/db";
import { CATEGORY_LABELS, categoryLabel } from "@/lib/clinicCatalog";
import { FULL_RATE_BP, parseRateBp, ratePercentText } from "@/lib/materialRate";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * نِسَب إهلاك المواد لكل تخصّص — **للمدير وحده**.
 *
 * فالنسبة تحكم ما يُخصم من عمولة كل طبيب، وهي مع تكاليف المختبر وسقوف المصروف
 * ممّا لا يراه الاستقبال ولا الطبيب بنصّ `lib/roles.ts`. **وطبيبٌ يقرأ نسبةَ
 * الإهلاك يقرأ كم تُقدّر العيادة ربحها من عمله** — وذلك قرارُ المالك أن يُخبره أو لا.
 */
const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const forbidden = () =>
  NextResponse.json({ message: "نِسَب الإهلاك للمدير وحده." }, { status: 403 });

export async function GET() {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) return forbidden();
  try {
    // والتخصّصات تخرج مع النِّسب: شاشةٌ تعرض المحدَّد وحده لا يُعرف منها ما بقي.
    return NextResponse.json({ rates: await listMaterialRates(), categories: CATEGORY_LABELS });
  } catch {
    return NextResponse.json({ message: "تعذّر قراءة نِسَب الإهلاك." }, { status: 500 });
  }
}

/**
 * يضبط نسبةَ تخصّصٍ أو يرفعها.
 *
 * **والرفع `null` لا صفر**: الصفر يقول «هذا العمل بلا موادّ»، والرفع يقول «لم
 * تُحدَّد نسبته بعد» — ويُعرض المحصَّل بلا نسبةٍ في تقرير العمولة رقمًا ظاهرًا.
 */
export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) return forbidden();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  const category = typeof source.category === "string" ? source.category : "";
  // والتخصّص من قائمة الدليل لا نصًّا حرًّا: نسبةٌ على تخصّصٍ لا وجود له لا تُخصم
  // من أحد ولا تظهر في شاشة، فتبقى في الجدول يظنّ المالك أنّها تعمل.
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)) {
    return NextResponse.json({ message: "التخصّص غير معروف." }, { status: 400 });
  }

  const clearing = source.rate === null || source.rate === "";
  const rateBp = clearing ? null : parseRateBp(source.rate);
  if (!clearing && rateBp === null) {
    return NextResponse.json(
      { message: `النسبة رقمٌ بين صفر و${FULL_RATE_BP / 100}٪ — مثل 7.5` }, { status: 400 });
  }

  try {
    await setMaterialRate(category, rateBp, session.username);
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ النسبة." }, { status: 500 });
  }

  // ونسبةٌ تُغيَّر تُقرأ بعد سنة في عمولةٍ صُرفت: تُكتب في السجلّ كتغيير السقوف.
  await recordAudit({
    action: "settings.update", entity: "material_rate", entityId: category,
    entityLabel: `إهلاك ${categoryLabel(category)} — ${rateBp === null ? "رُفعت" : `${ratePercentText(rateBp)}٪`}`,
    details: rateBp === null
      ? { التخصّص: category, الحالة: "بلا نسبة — لا يُخصم منه" }
      : { التخصّص: category, "النسبة٪": ratePercentText(rateBp), "نقاط الأساس": rateBp },
    actor: session.username, actorRole: session.role,
  });
  return NextResponse.json({ category, rateBp });
}
