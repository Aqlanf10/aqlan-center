"use client";
import { useState } from 'react';
import { type CatalogService } from './ClinicSelectors';
import { categoryLabel, CLINIC_SERVICES } from '@/lib/clinicCatalog';
import { type Currency, formatAmount } from '@/lib/money';
export function CatalogSetup({services,base,onChanged}:{services:CatalogService[];base:Currency;onChanged:()=>void}) {
  const [editing,setEditing]=useState(false);const [prices,setPrices]=useState<Record<number,string>>({});const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  async function send(body:unknown){setBusy(true);try{const r=await fetch('/api/services/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const p=await r.json();if(!r.ok){setMessage(p.message);return false;}setMessage(body&&typeof body==='object'&&'action' in body?`أُضيفت ${p.added} خدمة. اضبط أسعارها قبل استخدامها.`:'حُفظت الأسعار.');onChanged();return true;}catch{setMessage('تعذّر الاتصال بالخادم.');return false;}finally{setBusy(false);}}
  return <section className="mb-4 space-y-2 rounded-2xl border border-sky-200 bg-sky-50 p-4">
    <h2 className="font-bold">دليل أعمال العيادة الجاهز — {CLINIC_SERVICES.length} عملًا</h2>
    <p className="text-xs">إضافة القوائم لا تغيّر أسعارك الحالية. الأعمال الجديدة تحتاج سعرًا يحدده المركز؛ الصفر لا يعني مجانًا إلا بعد حفظه صراحة.</p>
    <div className="flex gap-2"><button disabled={busy} onClick={()=>void send({action:'import'})} className="rounded-xl bg-navy-800 p-2 text-sm text-white">إضافة قوائم الأعمال الجاهزة</button><button onClick={()=>setEditing(!editing)} className="rounded-xl border bg-white p-2 text-sm">{editing?'إغلاق الأسعار الجماعية':'تسعير عدة أعمال معًا'}</button></div>
    {message&&<p role="status" className="text-sm">{message}</p>}
    {editing&&<><div className="max-h-96 space-y-2 overflow-auto">{services.map(s=><label key={s.id} className="flex items-center gap-2 rounded-xl bg-white p-2"><span className="flex-1 text-xs">{s.name}<small className="block text-slate-500">{categoryLabel(s.category)}</small></span><input aria-label={`سعر ${s.name}`} value={prices[s.id]??''} placeholder={s.priceConfigured===false?'لم يحدد':formatAmount(s.priceMinor,base)} inputMode="decimal" dir="ltr" onChange={e=>setPrices(p=>({...p,[s.id]:e.target.value}))} className="w-28 rounded-lg border p-2"/></label>)}</div>
      <button disabled={busy||!Object.values(prices).some(v=>v.trim())} onClick={async()=>{if(await send({prices:Object.entries(prices).filter(([,price])=>price.trim()).map(([id,price])=>({id:Number(id),price}))}))setPrices({});}} className="rounded-xl bg-navy-800 p-2 text-white disabled:opacity-40">حفظ الأسعار المدخلة فقط</button></>}
  </section>;
}
