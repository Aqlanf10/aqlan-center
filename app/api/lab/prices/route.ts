import { NextResponse } from "next/server";
import { createLabPrice, getSettings, listLabPrices, listParties, recordAudit } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import { isCurrency, parseAmount } from "@/lib/money";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * أسعار المختبرات — للمدير وحده.
 *
 * فهي ما اتّفق عليه المركز، وكشفُها للطبيب يُطلعه على هامش العيادة في كل عمل.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "أسعار المختبرات للمدير." }, { status: 403 });
  }
  const raw = new URL(request.url).searchParams.get("partyId");
  const partyId = raw === null ? undefined : Number(raw);
  if (partyId !== undefined && (!Number.isInteger(partyId) || partyId <= 0)) {
    return NextResponse.json({ message: "رقم المختبر غير صالح." }, { status: 400 });
  }
  try {
    return NextResponse.json({ prices: await listLabPrices(partyId) });
  } catch {
    return NextResponse.json({ message: "تعذّرت قراءة الأسعار." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "أسعار المختبرات للمدير." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const partyId = Number(source.partyId);
  const serviceId = Number(source.serviceId);
  if (!Number.isInteger(partyId) || partyId <= 0 || !Number.isInteger(serviceId) || serviceId <= 0) {
    return NextResponse.json({ message: "اختر المختبر والعمل." }, { status: 400 });
  }

  // مختبرٌ فعلًا لا جهةً أخرى: سعرٌ على طبيبٍ أو موردٍ لا يُقرأ في مكانه أبدًا.
  const labs = new Set((await listParties("lab")).map((party) => party.id));
  if (!labs.has(partyId)) {
    return NextResponse.json({ message: "اختر المختبر من قائمة المختبرات." }, { status: 400 });
  }

  const settings = await getSettings();
  const base = settings["finance.base_currency"];
  const currency = isCurrency(source.currency) ? source.currency
    : isCurrency(base) ? base : "YER";
  const costMinor = parseAmount(String(source.cost ?? ""), currency);
  if (costMinor === null || costMinor <= 0) {
    return NextResponse.json({ message: "اكتب سعرًا أكبر من صفر." }, { status: 400 });
  }

  const effectiveFrom = String(source.effectiveFrom ?? "");
  if (!DATE.test(effectiveFrom)) {
    return NextResponse.json({ message: "تاريخ بدء السريان بصيغة 2026-09-01." }, { status: 400 });
  }
  const rawTo = String(source.effectiveTo ?? "").trim();
  if (rawTo && !DATE.test(rawTo)) {
    return NextResponse.json({ message: "تاريخ نهاية السريان بصيغة 2026-12-31 أو اتركه فارغًا." }, { status: 400 });
  }
  const note = typeof source.note === "string" && source.note.trim()
    ? source.note.trim().slice(0, 300) : null;

  /*
   * الاستبدال: يُغلق السعر النافذ في اليوم السابق لبدء الجديد ثم يُدخله.
   *
   * وهو **أشيع سير عملٍ في الوحدة** — يرفع المختبر سعره فيُسجَّل اليوم — وكان
   * مستحيلًا: الحدود شاملة، فإغلاق القديم اليوم وبدء الجديد اليوم يتداخلان،
   * ولا سبيل في الشاشة لإغلاق القديم أمس.
   *
   * ويُطلب صراحةً ولا يُفترض: إغلاقُ سعرٍ قائم تغييرٌ في السجلّ المالي، وفعلُه
   * صامتًا مع كل إضافةٍ يُنهي مدّةً لم يقصد المدير إنهاءها.
   */
  const replacePrevious = source.replace === true;

  try {
    const created = await createLabPrice({
      partyId, serviceId, costMinor, currency,
      effectiveFrom, effectiveTo: rawTo || null, note, actor: session.username,
      replacePrevious,
    });
    // ٤٠٩ لا ٤٠٠: الطلب سليم والحالة القائمة هي التي تمنعه، والرسالة تقول ما يُفعل.
    if (!created.ok) return NextResponse.json({ message: created.message }, { status: 409 });
    await recordAudit({
      action: "lab.price", entity: "lab_price", entityId: created.id,
      details: {
        المختبر: partyId, العمل: serviceId, السعر: costMinor, العملة: currency, من: effectiveFrom,
        // ما أُغلق ليبدأ هذا: الأثر يقول لماذا انتهت مدّةٌ لم يُغلقها أحد بيده.
        ...(created.closedIds.length ? { أُغلق: created.closedIds } : {}),
      },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ id: created.id, closedIds: created.closedIds }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر حفظ السعر." }, { status: 500 });
  }
}
