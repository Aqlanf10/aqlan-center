import { NextResponse } from "next/server";
import {
  addVisitAddendum, getClinicalVisit, getSettings, recordAudit,
  setVisitProcedures, signClinicalVisit,
} from "@/lib/db";
import { ClinicInputError } from "@/lib/treatmentWorkflow";
import { isCurrency } from "@/lib/money";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const clinicalOnly = () =>
  NextResponse.json({ message: "التوثيق السريري للطبيب والمدير." }, { status: 403 });

const idFrom = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  const visitId = await idFrom(context);
  if (!visitId) return NextResponse.json({ message: "رقم الزيارة غير صالح." }, { status: 400 });

  try {
    const visit = await getClinicalVisit(visitId);
    if (!visit) return NextResponse.json({ message: "الزيارة غير موجودة." }, { status: 404 });
    return NextResponse.json(visit);
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل الزيارة." }, { status: 500 });
  }
}

/**
 * حفظ التوثيق والإجراءات، أو توقيع الزيارة، أو إضافة ملحق.
 *
 * والتوقيع هو **الحلقة**: يولّد الفاتورة ويحدّث المخطط في معاملة واحدة. ولذلك يُطلب
 * بفعلٍ صريح (`action: "sign"`) لا كأثر جانبي لحفظ — فعملٌ يترتّب عليه مالٌ لا يقع
 * بالخطأ.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  if (session.role !== "doctor" && session.role !== "admin") return clinicalOnly();

  const visitId = await idFrom(context);
  if (!visitId) return NextResponse.json({ message: "رقم الزيارة غير صالح." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  const action = String(source.action ?? "save");
  const text = (value: unknown, max = 2000) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

  try {
    if (action === "addendum") {
      const note = text(source.text, 1000);
      if (!note) return NextResponse.json({ message: "اكتب نصّ الملحق." }, { status: 400 });
      const added = await addVisitAddendum({ visitId, text: note, author: session.username });
      if (!added) {
        return NextResponse.json(
          { message: "الملحق يُضاف على زيارة موقَّعة فقط." }, { status: 409 },
        );
      }
      await recordAudit({
        action: "visit.addendum", entity: "visit", entityId: visitId,
        details: { النص: note }, actor: session.username, actorRole: session.role,
      });
      return NextResponse.json(await getClinicalVisit(visitId));
    }

    if (action === "sign") {
      const settings = await getSettings();
      const base = settings["finance.base_currency"];
      if (!isCurrency(base)) {
        return NextResponse.json({ message: "العملة الأساسية في الإعدادات غير صالحة." }, { status: 500 });
      }
      const result = await signClinicalVisit({ visitId, baseCurrency: base, signedBy: session.username });
      const messages: Record<string, string> = {
        not_found: "الزيارة غير موجودة.",
        already_signed: "الزيارة موقَّعة سلفًا. التصحيح يكون بملحق.",
        empty: "سجّل إجراءً أو تشخيصًا قبل توقيع الزيارة.",
        no_patient: "اربط الزيارة بملف مريض قبل التوقيع — الفاتورة تدخل كشف حسابه.",
      };
      if (result.reason) {
        return NextResponse.json({ message: messages[result.reason] }, { status: 409 });
      }
      await recordAudit({
        action: "visit.sign", entity: "visit", entityId: visitId,
        entityLabel: result.visit?.patientName,
        details: {
          الإجراءات: result.visit?.procedures.length ?? 0,
          الإجمالي: result.visit?.totalMinor ?? 0,
          الفاتورة: result.invoiceId,
          تحديثات_المخطط: result.chartUpdates,
        },
        actor: session.username, actorRole: session.role,
      });
      return NextResponse.json(result.visit);
    }

    if (action !== 'save' || !Array.isArray(source.procedures) || source.procedures.length>80) {
      return NextResponse.json({message:'طلب حفظ غير صالح؛ أرسل قائمة الإجراءات كاملة.'},{status:400});
    }
    const nullableNumber=(value:unknown)=>value===null||value===undefined||value===''?null:Number(value);
    const procedures=source.procedures.map((row:Record<string,unknown>)=>({
      serviceId:Number(row?.serviceId),toothCode:nullableNumber(row?.toothCode),planItemId:nullableNumber(row?.planItemId),
      surfaces:typeof row?.surfaces==='string'?row.surfaces:null,quantity:Number(row?.quantity??1),
      unitPriceMinor:Number(row?.unitPriceMinor??NaN),doctorId:nullableNumber(row?.doctorId),note:text(row?.note,300),
    }));
    const saved=await setVisitProcedures({visitId,procedures,notes:{
      chiefComplaint:text(source.chiefComplaint,500),examination:text(source.examination),diagnosis:text(source.diagnosis),
      treatmentDone:text(source.treatmentDone),nextPlan:text(source.nextPlan,500),doctorId:nullableNumber(source.doctorId),
    }});
    if(!saved)return NextResponse.json({message:'الزيارة موقّعة أو غير موجودة؛ لا يمكن تعديلها.'},{status:409});
    return NextResponse.json(await getClinicalVisit(visitId));
  } catch (error) {
    return NextResponse.json({ message: error instanceof ClinicInputError ? error.message : "تعذّر حفظ الزيارة." }, { status: error instanceof ClinicInputError ? 409 : 500 });
  }
}
