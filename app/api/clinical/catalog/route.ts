import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { listServices, listParties } from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET() {
  if(!await requireSession())return NextResponse.json({message:'سجّل الدخول.'},{status:401});
  try {const [services,parties]=await Promise.all([listServices(),listParties('doctor')]);
    return NextResponse.json({services,doctors:parties.map(({id,name})=>({id,name}))});
  }catch{return NextResponse.json({message:'تعذّر تحميل دليل الأعمال.'},{status:500});}
}
