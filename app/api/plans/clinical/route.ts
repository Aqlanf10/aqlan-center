import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getSettings, recordAudit, CLINIC_TIME_ZONE } from '@/lib/db';
import { clinicDateString } from '@/lib/schedule';
import { isCurrency } from '@/lib/money';
import { createClinicalPlan, ClinicInputError } from '@/lib/treatmentWorkflow';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  const session=await requireSession();if(!session)return NextResponse.json({message:'سجّل الدخول.'},{status:401});
  if(!['admin','doctor','reception'].includes(session.role))return NextResponse.json({message:'صلاحية غير كافية.'},{status:403});
  let s;try{s=await request.json();}catch{return NextResponse.json({message:'طلب غير صالح.'},{status:400});}
  try {
    const base=(await getSettings())['finance.base_currency'];
    if(!isCurrency(base)||!Number.isSafeInteger(s?.patientId)||s.patientId<1||typeof s.title!=='string'||!s.title.trim()||s.title.length>120||!Array.isArray(s.items))throw new ClinicInputError('اختر المريض واكتب عنوان الخطة وأضف أعمالها.');
    const result=await createClinicalPlan({patientId:s.patientId,title:s.title.trim(),baseCurrency:base,startDate:clinicDateString(new Date(),CLINIC_TIME_ZONE),createdBy:session.username,
      items:s.items.map((i:{serviceId:unknown;toothCode:unknown;quantity:unknown})=>({serviceId:Number(i?.serviceId),toothCode:i?.toothCode==null||i.toothCode===''?null:Number(i.toothCode),quantity:Number(i?.quantity??1)}))});
    await recordAudit({action:'plan.create',entity:'treatment_plans',entityId:result.id,actor:session.username,actorRole:session.role});
    return NextResponse.json(result,{status:201});
  }catch(error){return NextResponse.json({message:error instanceof ClinicInputError?error.message:'تعذّر حفظ الخطة.'},{status:error instanceof ClinicInputError?400:500});}
}
