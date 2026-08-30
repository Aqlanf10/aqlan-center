import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, recordPlanConsent } from "@/lib/db";
import { canHandleMoney } from "@/lib/roles";
import { clinicDateString } from "@/lib/schedule";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * موافقة المريض على الخطة — واللحظة التي تصير فيها المسوّدة اتفاقًا.
 *
 * ويجوز أن يُجدوَل التقسيط في الطلب نفسه، لأنه ما يحدث فعلًا على الكرسي: يوافق
 * المريض على البنود ويسأل «أقدر أقسّطها؟» في النَّفَس نفسه. وفصلُهما إلى شاشتين
 * يجعل نصف الخطط تُوافَق ولا تُجدوَل.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!canHandleMoney(session.role) && session.role!=="doctor") {
    return NextResponse.json({ message: "خطط العلاج للإدارة والاستقبال." }, { status: 403 });
  }

  const { id } = await context.params;
  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json({ message: "رقم الخطة غير صالح." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const count=Number(source.count??0);
  const everyDays=Number(source.everyDays??30);
  if(!Number.isSafeInteger(count)||count<0||count>60||!Number.isSafeInteger(everyDays)||everyDays<1||everyDays>365) return NextResponse.json({message:'راجع عدد الأقساط (0 إلى 60) والمدة بينها.'},{status:400});
  if(session.role==='doctor'&&count>0)return NextResponse.json({message:'جدولة الأقساط للإدارة والاستقبال.'},{status:403});
  const today=clinicDateString(new Date(),CLINIC_TIME_ZONE);
  const firstDueDate=typeof source.firstDueDate==='string'?source.firstDueDate:today;
  if(!DATE_PATTERN.test(firstDueDate)||!Number.isFinite(Date.parse(firstDueDate)))return NextResponse.json({message:'تاريخ القسط غير صالح.'},{status:400});
  try {
    const consent=await recordPlanConsent({planId,actor:session.username,note:typeof source.note==='string'?source.note.slice(0,300):null,
      ...(count>0?{schedule:{count,everyDays,firstDueDate}}:{})});
    if(!consent.ok)return NextResponse.json({message:consent.message},{status:409});
    return NextResponse.json({totalMinor:consent.totalMinor,installments:count},{status:201});
  } catch {return NextResponse.json({message:'تعذّر تسجيل الموافقة وجدول الأقساط؛ لم تُحفظ العملية.'},{status:500});}
}
