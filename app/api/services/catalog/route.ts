import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getSettings, recordAudit } from '@/lib/db';
import { isCurrency, parseAmount } from '@/lib/money';
import { importClinicCatalog, setCatalogPrices, ClinicInputError } from '@/lib/treatmentWorkflow';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  const session=await requireSession();
  if(!session)return NextResponse.json({message:'سجّل الدخول.'},{status:401});
  if(session.role!=='admin')return NextResponse.json({message:'إدارة الدليل والأسعار للمدير.'},{status:403});
  let source;try{source=await request.json();}catch{return NextResponse.json({message:'طلب غير صالح.'},{status:400});}
  try {
    if(source?.action==='import') {
      const result=await importClinicCatalog();
      await recordAudit({action:'service.catalog_import',entity:'services',details:result,actor:session.username,actorRole:session.role});
      return NextResponse.json(result);
    }
    const base=(await getSettings())['finance.base_currency'];
    if(!isCurrency(base)||!Array.isArray(source?.prices))throw new ClinicInputError('راجع الأسعار والعملة الأساسية.');
    const prices=source.prices.map((p:{id:unknown;price:unknown})=>({id:Number(p?.id),priceMinor:parseAmount(String(p?.price??''),base)??-1}));
    await setCatalogPrices(prices);
    await recordAudit({action:'service.prices',entity:'services',details:{prices},actor:session.username,actorRole:session.role});
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({message:error instanceof ClinicInputError?error.message:'تعذّر حفظ دليل الأعمال.'},{status:error instanceof ClinicInputError?400:500});}
}
