"use client";
import { useState } from "react";
import { ALL_TEETH, toothName } from "@/lib/dental";
import { categoryLabel } from "@/lib/clinicCatalog";
import { formatAmount, type Currency } from "@/lib/money";
export interface CatalogService { id: number; name: string; category: string | null; priceMinor: number; catalogCode?: string | null; priceConfigured?: boolean }
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50";
export function ToothSelect({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <select aria-label="رقم السن" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={inputClass}>
    <option value="">الفم عمومًا / لا ينطبق</option>
    {ALL_TEETH.map(code => <option key={code} value={code}>{code} — {toothName(code)}</option>)}
  </select>;
}
export function ServicePicker({ services, base, onSelect, disabled = false }: { services: CatalogService[]; base: Currency; onSelect: (service: CatalogService) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(services.map(s => s.category ?? ""))];
  const filtered = services.filter(s => (!category || s.category === category) && s.name.includes(query.trim()));
  return <div className="my-2 space-y-2">
    <div className="flex gap-2"><input aria-label="بحث في الأعمال" placeholder="ابحث عن العمل…" value={query} onChange={e => setQuery(e.target.value)} className={inputClass} />
      <select aria-label="تصنيف الأعمال" value={category} onChange={e => setCategory(e.target.value)} className={inputClass}><option value="">كل التصنيفات</option>{categories.filter(Boolean).map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></div>
    <select aria-label="أضف إجراءً" value="" disabled={disabled} onChange={e => {const s = services.find(s => s.id === Number(e.target.value)); if (s) onSelect(s);}} className={inputClass}>
      <option value="">+ اختر إجراءً من دليل الأعمال</option>
      {categories.map(c => <optgroup key={c} label={categoryLabel(c)}>{filtered.filter(s => (s.category ?? "") === c).map(s => <option key={s.id} value={s.id} disabled={s.priceConfigured === false}>{s.name} — {s.priceConfigured === false ? "لم يُحدد السعر" : formatAmount(s.priceMinor, base)}</option>)}</optgroup>)}
    </select>
    {!services.length && <p className="text-xs text-amber-800">لا خدمات متاحة. يضيف المدير دليل الأعمال ويضبط الأسعار من قائمة الأسعار.</p>}
  </div>;
}
