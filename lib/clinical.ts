import type { ToothCondition } from "./dental";

/**
 * الزيارة السريرية — المنطق الخالص.
 *
 * **الحلقة التي كانت مقطوعة**: الطبيب يعمل، والمالية لا تعرف. فيخرج المريض بلا
 * فاتورة، أو تُكتب له فاتورة بسعرٍ يخالف ما اتفق عليه الطبيب، أو يُفوتَر مرتين.
 *
 * والقاعدة الحاكمة (المبدأ الثاني في الدستور): **الخدمة المنفّذة تولّد الاستحقاق
 * تلقائيًا بلا تكرار إدخال**. فإغلاق الزيارة عملٌ واحد يُنتج ثلاثة آثار في معاملة
 * واحدة: إثبات الإجراءات، وفاتورةٌ من **دليل الخدمات** لا من ذاكرة أحد، وتحديث
 * المخطط السني. إمّا كلها أو لا شيء — الدستور، §٤٠.
 */

/** إجراء منفَّذ في زيارة: خدمةٌ من الدليل، وسنٌّ إن كان الإجراء على سن. */
export interface VisitProcedureInput {
  planItemId?: number | null;
  catalogCode?: string | null;
  serviceId: number;
  toothCode: number | null;
  surfaces: string | null;
  quantity: number;
  /** السعر لحظة التنفيذ — يُنسخ من الدليل ويجوز للطبيب تعديله بمبرّر. */
  unitPriceMinor: number;
  doctorId: number | null;
  note: string | null;
}

/**
 * أثر الإجراء على المخطط السني.
 *
 * جدولٌ صغير يربط **دليل الخدمات** بحالات الأسنان، وهو ما يجعل «حشوة نُفّذت» تُصبح
 * حشوةً على المخطط بلا أن يسجّلها الطبيب مرتين. والربط بفئة الخدمة لا باسمها: اسمٌ
 * يتغيّر غدًا يكسر الربط، والفئة قائمة في الدليل أصلًا.
 */
export const CATEGORY_TO_CONDITION: Record<string, ToothCondition> = {
  filling: "filling",
  rct: "rct",
  crown: "crown",
  bridge: "bridge",
  implant: "implant",
  extraction: "extracted",
  veneer: "veneer",
  sealant: "sealant",
  ortho: "bracket",
};

const CATALOG_CONDITIONS: Record<string,ToothCondition> = {
  composite:'filling',glass_ionomer:'filling',temporary:'filling',core:'filling',inlay:'filling',filling_repair:'filling',child_filling:'filling',
  rct:'rct',rct_anterior:'rct',rct_premolar:'rct',rct_molar:'rct',rct_retreatment:'rct',pulpectomy:'rct',
  simple_extraction:'extracted',surgical_extraction:'extracted',wisdom_extraction:'extracted',retained_root:'extracted',child_extraction:'extracted',
  zirconia:'crown',porcelain_metal:'crown',emax:'crown',temporary_crown:'crown',recement_crown:'crown',child_crown:'crown',implant_crown:'crown',
  bridge:'bridge',bridge_cement:'bridge',implant:'implant',veneer:'veneer',composite_veneer:'veneer',sealant:'sealant',fixed_ortho:'bracket',bracket_repair:'bracket',
};
export function conditionForCategory(category: string | null, catalogCode?:string|null): ToothCondition | null {
  if(catalogCode) return CATALOG_CONDITIONS[catalogCode] ?? null;
  if (!category) return null;
  return CATEGORY_TO_CONDITION[category] ?? null;
}

/** حالة الزيارة سريريًا. */
export type ClinicalStatus = "open" | "signed";

export interface ClinicalVisitInput {
  chiefComplaint: string | null;
  examination: string | null;
  diagnosis: string | null;
  treatmentDone: string | null;
  nextPlan: string | null;
}

export interface ProcedureLine {
  planItemId?: number | null;
  catalogCode?: string | null;
  serviceId: number;
  serviceName: string;
  category: string | null;
  toothCode: number | null;
  surfaces: string | null;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  doctorId: number | null;
}

/** مجموع الزيارة — نفس الحساب الذي تُبنى عليه الفاتورة، فلا رقمان لعمل واحد. */
export function visitTotal(lines: { quantity: number; unitPriceMinor: number }[]): number {
  return lines.reduce((sum, line) =>
    sum + Math.max(0, Math.round(line.quantity)) * Math.max(0, Math.round(line.unitPriceMinor)), 0);
}

export function procedureTotal(quantity: number, unitPriceMinor: number): number {
  return Math.max(0, Math.round(quantity)) * Math.max(0, Math.round(unitPriceMinor));
}

/**
 * هل تصلح الزيارة للإغلاق؟
 *
 * زيارةٌ بلا إجراء ولا تشخيص ليست زيارة سريرية — هي مريضٌ جلس على الكرسي وقام.
 * وإغلاقها يولّد فاتورة بصفر ويلوّث السجل بزيارات فارغة تُفسد كل إحصاء لاحق.
 */
export function canSign(input: {
  status: ClinicalStatus;
  procedures: { quantity: number; unitPriceMinor: number }[];
  diagnosis: string | null;
  treatmentDone: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (input.status === "signed") {
    return { ok: false, message: "الزيارة موقَّعة سلفًا. التصحيح يكون بملحق." };
  }
  const hasClinical = Boolean(input.diagnosis?.trim() || input.treatmentDone?.trim());
  if (input.procedures.length === 0 && !hasClinical) {
    return { ok: false, message: "سجّل إجراءً أو تشخيصًا قبل توقيع الزيارة." };
  }
  return { ok: true };
}

/**
 * نصّ الملحق (Addendum).
 *
 * الزيارة الموقَّعة لا تُعدَّل — والدستور صريح. والتصحيح يُكتب ملحقًا يحمل كاتبه
 * ووقته، فيبقى الأصل والتصحيح ظاهرين معًا. وهذا ما يجعل السجل الطبي شهادةً: من
 * يُعدِّل بصمت يمكن أن يُعدِّل بعد شكوى.
 */
export function formatAddendum(input: {
  text: string; author: string; at: string;
}): string {
  const stamp = input.at.slice(0, 16).replace("T", " ");
  return `— ملحق (${input.author} · ${stamp}): ${input.text.trim()}`;
}
