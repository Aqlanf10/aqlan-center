import { NextResponse } from "next/server";
import { getSettings, listServices, priceServices, recordAudit, unpricedServiceCount } from "@/lib/db";
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
    return NextResponse.json({ unpriced: await unpricedServiceCount() });
  } catch {
    return NextResponse.json({ message: "تعذّر قراءة حالة التسعير." }, { status: 500 });
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
