import { NextResponse } from "next/server";
import { fillProvisionalPrices, getSettings, listServices, priceServices, provisionalPriceCount, recordAudit, unpricedServiceCount } from "@/lib/db";
import { provisionalFills } from "@/lib/provisionalPrices";
import { isCurrency, parseAmount } from "@/lib/money";
import { readPriceBatch } from "@/lib/servicePricing";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * تسعير عدّة أعمالٍ دفعةً واحدة — **للمدير وحده**، كتعديل السعر المفرد.
 *
 * وأعمال المركز الستّة والثمانون أُدخلت بلا أسعار، وتسعيرُها واحدةً واحدةً ستّةٌ
 * وثمانون ذهابًا وإيابًا. ومن يقف في المنتصف يترك نصف الدليل مسعّرًا ونصفه لا.
 */
const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

export async function GET() {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "الأسعار للمدير وحده." }, { status: 403 });
  }
  try {
    return NextResponse.json({
      unpriced: await unpricedServiceCount(),
      provisional: await provisionalPriceCount(),
    });
  } catch {
    return NextResponse.json({ message: "تعذّر قراءة حالة التسعير." }, { status: 500 });
  }
}

/**
 * يملأ غير المسعَّر بأسعارٍ تخمينية للتجربة — **للمدير وحده**.
 *
 * طلبها المالك ليبدأ التجربة قبل أن يُقرّ قائمته. وهي تعمل: تُفوتَر بها زيارة —
 * **ولذلك تُوسَم**، وتبقى موسومةً في شاشة الأسعار وشاشة الجاهزية حتى تُستبدل.
 */
export async function POST() {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "التسعير للمدير وحده." }, { status: 403 });
  }
  /*
   * والقائمة التخمينية **بالريال اليمني**، فتُردّ إن كانت عملة المركز غيره.
   *
   * أرقامُها وحداتٌ صغرى، وريالُ اليمن بلا كسر (وحدته الصغرى واحد)، فـ٣٬٠٠٠ كشفٌ
   * بثلاثة آلاف ريال. ولو كانت العملة دولارًا لصارت ٣٬٠٠٠ سنتًا — ثلاثين دولارًا،
   * رقمٌ آخر تمامًا يمرّ صامتًا إلى فواتير المرضى.
   */
  const base = (await getSettings())["finance.base_currency"];
  if (base !== "YER") {
    return NextResponse.json(
      { message: "القائمة التخمينية بالريال اليمني، وعملة المركز غيره. سعّر الأعمال بنفسك." },
      { status: 409 });
  }

  try {
    const fills = provisionalFills(await listServices(true));
    if (fills.length === 0) {
      return NextResponse.json(
        { message: "لا خدمةَ بلا سعرٍ لها تقديرٌ في الدليل." }, { status: 409 });
    }
    const { filled } = await fillProvisionalPrices(fills);
    await recordAudit({
      action: "settings.update", entity: "services",
      entityLabel: `أسعار تخمينية لـ${filled} خدمة`,
      details: { المرشَّح: fills.length, المملوء: filled, النوع: "تخميني — للتجربة" },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({
      filled, unpriced: await unpricedServiceCount(), provisional: await provisionalPriceCount(),
    }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر ملء الأسعار التخمينية." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "تعديل الأسعار للمدير وحده." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const settings = await getSettings();
  const base = settings["finance.base_currency"];
  // والعملة تُقرأ ولا تُفترَض: سعرٌ يُخزَّن بوحدةٍ ويُفوتَر بأخرى رقمٌ خاطئ في كل فاتورة.
  if (!isCurrency(base)) {
    return NextResponse.json({ message: "العملة الأساسية في الإعدادات غير صالحة." }, { status: 500 });
  }

  // والأسماء تُقرأ مرّةً لتُذكر في رسالة الخطأ: «سطرٌ ما» في ٨٦ سطرًا لا يُبحث عنه.
  const services = await listServices(true);
  const nameOf = (id: number) => services.find((one) => one.id === id)?.name ?? null;

  const batch = readPriceBatch(
    Array.isArray(source.prices) ? source.prices : [],
    (input) => parseAmount(input, base),
    nameOf,
  );
  if (!batch.ok) return NextResponse.json({ message: batch.message }, { status: 400 });

  try {
    const { updated } = await priceServices(batch.prices);
    // ويُقال ما تغيّر فعلًا لا ما أُرسل: رقمٌ لا وجود له لا يُحدِّث صفًّا.
    await recordAudit({
      action: "settings.update", entity: "services", entityLabel: `تسعير ${updated} خدمة`,
      details: { المُرسَل: batch.prices.length, المحفوظ: updated },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ updated, sent: batch.prices.length, unpriced: await unpricedServiceCount() });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ الأسعار." }, { status: 500 });
  }
}
