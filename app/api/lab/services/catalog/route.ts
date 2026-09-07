import { NextResponse } from "next/server";
import { createLabService, listLabServices, recordAudit } from "@/lib/db";
import { importPlan, LAB_WORK_CATALOG } from "@/lib/labWorkCatalog";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const forbidden = () =>
  NextResponse.json({ message: "كتالوج المختبر للمدير." }, { status: 403 });

/** كم ينقص من الكتالوج — ليقول الزرُّ ماذا سيفعل قبل أن يُضغط. */
export async function GET() {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) return forbidden();
  try {
    const existing = await listLabServices(true);
    const plan = importPlan(existing.map((one) => one.name));
    return NextResponse.json({
      total: LAB_WORK_CATALOG.length,
      missing: plan.missing.length,
      present: plan.presentCount,
    });
  } catch {
    return NextResponse.json({ message: "تعذّرت قراءة الكتالوج." }, { status: 500 });
  }
}

/**
 * يُدخل ما ينقص من كتالوج أعمال المعامل — **بلا أسعار**.
 *
 * فما تعمله المعامل معروفٌ في المهنة، وما تتقاضاه اتفاقُ هذا المركز مع كلِّ
 * معمل. فيُدخل العمل بلا سعرٍ ويُسعّره المالك لكل معملٍ على حدة بتاريخ سريان.
 *
 * **وما هو مسجَّلٌ لا يُمسّ**: قد يكون المالك عدّل مهلته أو صنّفه، وإعادةُ
 * الاستيراد فوقه تمحو تعديله. فيصلح تشغيلُه مرّتين ولا يُنشئ نسخةً ثانية.
 */
export async function POST() {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role)) return forbidden();

  try {
    const existing = await listLabServices(true);
    const plan = importPlan(existing.map((one) => one.name));
    if (plan.missing.length === 0) {
      return NextResponse.json(
        { message: "كتالوج أعمال المعامل مُدخَلٌ كاملًا." }, { status: 409 });
    }

    /*
     * ويُقال ما أُدخل فعلًا لا ما حاولنا إدخاله.
     *
     * فقد يصطدم اسمٌ بعملٍ معطَّلٍ يحمله (الفهرس الفريد على الفعّال وحده، لكنّ
     * تصادمًا آخر ممكن)، وقولُ «أُدخل ٤٣» عن ٤١ يجعل المالك يبحث عن عملين
     * يظنّهما موجودين.
     */
    let added = 0;
    const refused: string[] = [];
    for (const entry of plan.missing) {
      const created = await createLabService(entry, session.username);
      if (created.ok) added += 1;
      else refused.push(entry.name);
    }

    await recordAudit({
      action: "lab.service", entity: "lab_service",
      entityLabel: `استيراد كتالوج المعامل — ${added} عملًا`,
      details: {
        المرشَّح: plan.missing.length, المُدخَل: added,
        "المسجَّل سابقًا": plan.presentCount,
        ...(refused.length ? { "لم يُدخَل": refused } : {}),
      },
      actor: session.username, actorRole: session.role,
    });
    return NextResponse.json({ added, refused, present: plan.presentCount }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر استيراد الكتالوج." }, { status: 500 });
  }
}
