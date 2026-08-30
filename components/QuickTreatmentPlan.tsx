"use client";
import { useEffect, useState } from 'react';
import { ServicePicker, ToothSelect, type CatalogService } from './ClinicSelectors';
import { TREATMENT_BUNDLES } from '@/lib/clinicCatalog';
import { formatMoney, type Currency } from '@/lib/money';
export function QuickTreatmentPlan({patientId,base,onSaved,onError}:{patientId:number;base:Currency;onSaved:()=>void;onError:(message:string|null)=>void}) {
  const [services,setServices]=useState<CatalogService[]>([]);
  const [title,setTitle]=useState('');const [tooth,setTooth]=useState('');
  const [items,setItems]=useState<{serviceId:number;toothCode:string;quantity:number}[]>([]);const [busy,setBusy]=useState(false);
  useEffect(()=>{void fetch('/api/clinical/catalog').then(async r=>{if(!r.ok)throw Error();setServices((await r.json()).services);}).catch(()=>onError('تعذّر تحميل دليل الأعمال.'));},[onError]);
  const total=items.reduce((n,i)=>n+(services.find(s=>s.id===i.serviceId)?.priceMinor??0)*i.quantity,0);
  return <section aria-label="خطة علاج سريعة" className="mb-4 space-y-3 rounded-2xl border border-navy-200 bg-white p-4">
    <h3 className="font-bold">اختر أعمال الخطة كاملة</h3>
    <p className="text-xs text-slate-500">تُحفظ مسودة، ثم تُسجّل موافقة المريض. أضف في كل زيارة البنود التي نُفّذت فقط؛ سعر الاتفاق يبقى محفوظًا.</p>
    <input aria-label="اسم الخطة" placeholder="اسم الخطة" value={title} onChange={e=>setTitle(e.target.value)} className="w-full rounded-xl border p-2" />
    <label className="block text-xs">السن للأعمال الجديدة<ToothSelect value={tooth} onChange={setTooth}/></label>
    <select aria-label="مجموعة أعمال جاهزة" value="" onChange={e=>{
      const bundle=TREATMENT_BUNDLES[Number(e.target.value)];if(!bundle)return;
      const selected=bundle.codes.map(code=>services.find(s=>s.catalogCode===code));
      if(selected.some(s=>!s||s.priceConfigured===false)){onError('يجب أن يستورد المدير دليل الأعمال ويضبط أسعار هذه المجموعة أولًا.');return;}
      setTitle(t=>t||bundle.name);setItems(rows=>[...rows,...selected.map(s=>({serviceId:s!.id,toothCode:tooth,quantity:1}))]);onError(null);
    }} className="w-full rounded-xl border p-2"><option value="">+ مجموعة أعمال جاهزة</option>{TREATMENT_BUNDLES.map((b,i)=><option key={b.name} value={i}>{b.name}</option>)}</select>
    <ServicePicker services={services} base={base} onSelect={s=>setItems(rows=>[...rows,{serviceId:s.id,toothCode:tooth,quantity:1}])}/>
    {items.map((item,index)=><div key={index} className="space-y-2 rounded-xl bg-slate-50 p-2">
      <div className="flex justify-between"><strong className="text-sm">{services.find(s=>s.id===item.serviceId)?.name}</strong><button onClick={()=>setItems(rows=>rows.filter((_,i)=>i!==index))} className="text-xs text-red-700">حذف</button></div>
      <div className="flex gap-2"><ToothSelect value={item.toothCode} onChange={value=>setItems(rows=>rows.map((r,i)=>i===index?{...r,toothCode:value}:r))}/><input aria-label="كمية بند الخطة" type="number" min={1} max={99} value={item.quantity} onChange={e=>setItems(rows=>rows.map((r,i)=>i===index?{...r,quantity:Number(e.target.value)}:r))} className="w-20 rounded-xl border p-2"/></div>
    </div>)}
    <p className="font-bold">إجمالي الأعمال: {formatMoney(total,base)}</p>
    <button disabled={busy||!items.length||!title.trim()} onClick={async()=>{setBusy(true);try{
      const response=await fetch('/api/plans/clinical',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({patientId,title,items:items.map(i=>({...i,toothCode:i.toothCode?Number(i.toothCode):null}))})});
      const result=await response.json();if(!response.ok){onError(result.message);return;}onError(null);onSaved();
    }catch{onError('تعذّر الاتصال بالخادم.');}finally{setBusy(false);}}} className="w-full rounded-xl bg-navy-800 p-3 font-bold text-white disabled:opacity-40">احفظ الخطة بكل أعمالها</button>
  </section>;
}
