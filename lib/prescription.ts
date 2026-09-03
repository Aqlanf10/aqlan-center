/**
 * الوصفة الطبية — الروشتة التي يخرج بها المريض إلى الصيدلية.
 *
 * وهي **وثيقة**، لا شاشةٌ تُملأ ثم تُطبع: يحملها المريض إلى صيدليٍّ يصرف بها
 * دواءً، ويرجع إليها الطبيب بعد شهرٍ ليعرف بماذا عالج، وقد تُطلب في نزاع. فما
 * يُطبع منها يجب أن يكون **محفوظًا كما طُبع**، ومنسوبًا إلى من أصدره، وبتاريخه.
 *
 * وثلاثةٌ تُحرَس هنا:
 *
 * ١) **لا تُختلق وصفة.** صفحةٌ تُفتح بلا محتوى لا تطبع دواءً «مثالًا»: ورقةٌ
 *    عليها ترويسة المركز واسم الطبيب وأدويةٌ لم يصفها أحد وصفةٌ حقيقية في يد
 *    من يحملها، ويصرفها الصيدليّ.
 *
 * ٢) **لا تُعدَّل بعد إصدارها.** المريض خرج بنسخته، فتعديل المحفوظ يجعل نسخته
 *    ونسخة الملف تقولان شيئين. والخطأ يُصحَّح بإبطالٍ مُعلَّلٍ ووصفةٍ جديدة —
 *    فيبقى في السجل أنّ الأولى كانت وأنّها أُبطلت ولماذا.
 *
 * ٣) **أسماء الأدوية بالإنجليزية.** هي لغة العلب والصيدليات في اليمن، ونقلُها
 *    إلى العربية يُنتج اسمًا لا يجده الصيدليّ. أمّا تعليمات المريض فبلغته.
 */

export type InstructionsLang = "both" | "ar" | "en";

export const INSTRUCTIONS_LANG_TEXT: Record<InstructionsLang, { ar: string; en: string }> = {
  both: { ar: "بالعربية والإنجليزية", en: "Arabic and English" },
  ar: { ar: "بالعربية", en: "Arabic" },
  en: { ar: "بالإنجليزية", en: "English" },
};

export function isInstructionsLang(value: unknown): value is InstructionsLang {
  return value === "both" || value === "ar" || value === "en";
}

/** دواءٌ واحد في الوصفة. */
export interface RxItem {
  /** الاسم كما يُكتب على العلبة — إنجليزيًّا. */
  name: string;
  /** العيار: `500mg` · `1g` — نصٌّ لأنّ الوحدات تختلف. */
  dose: string;
  /** الشكل: أقراص، كبسولات، شراب، غسول، مرهم. */
  form: string;
  /** التكرار: `1 tablet every 8 hours`. */
  frequency: string;
  /** المدّة: `5 days`. */
  duration: string;
  /** تعليمات المريض بالعربية. */
  instructions: string;
  /** وبالإنجليزية. */
  instructionsEn: string;
}

/** حدودٌ تمنع حقلًا واحدًا من أن يبتلع الوثيقة. */
export const MAX_ITEMS = 20;
export const MAX_FIELD = 200;
export const MAX_TEXT = 2000;
/** أقصر سببٍ يُقبل للإبطال — «خطأ» وحدها لا تقول شيئًا لمن يقرأ السجل بعد سنة. */
export const MIN_VOID_REASON = 6;

const text = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

/**
 * دواءٌ من مُدخلٍ غير موثوق.
 *
 * ويعيد `null` لما لا اسم له: سطرٌ فيه جرعةٌ بلا دواء ليس دواءً ناقصًا بل سطرٌ
 * فارغ تركه من يملأ النموذج. وحفظُه يطبع «(500mg)» وحدها في الروشتة.
 */
export function sanitizeRxItem(input: unknown): RxItem | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const name = text(source.name, MAX_FIELD);
  if (!name) return null;
  return {
    name,
    dose: text(source.dose, MAX_FIELD),
    form: text(source.form, MAX_FIELD),
    frequency: text(source.frequency, MAX_FIELD),
    duration: text(source.duration, MAX_FIELD),
    instructions: text(source.instructions, MAX_TEXT),
    instructionsEn: text(source.instructionsEn, MAX_TEXT),
  };
}

export function sanitizeRxItems(input: unknown): RxItem[] {
  if (!Array.isArray(input)) return [];
  const items: RxItem[] = [];
  for (const raw of input) {
    const item = sanitizeRxItem(raw);
    if (item) items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export interface PrescriptionDraft {
  patientId: number;
  visitId: number | null;
  diagnosis: string;
  notes: string;
  instructionsLang: InstructionsLang;
  items: RxItem[];
}

export type DraftCheck =
  | { ok: true; value: PrescriptionDraft }
  | { ok: false; message: string };

/**
 * يقرأ مسوّدةً من طلبٍ غير موثوق ويقول لماذا تُرفض.
 *
 * والرسالة عربية تقول ما يُفعل — لا «طلب غير صالح»: من يملأ النموذج يريد أن
 * يعرف أيّ حقلٍ ينقصه.
 */
export function readDraft(input: unknown): DraftCheck {
  const source = (input ?? {}) as Record<string, unknown>;

  const patientId = Number(source.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return { ok: false, message: "الوصفة تُكتب لمريضٍ في الملف — اختر المريض أولًا." };
  }

  const rawVisit = source.visitId;
  const visitId = rawVisit === null || rawVisit === undefined || rawVisit === ""
    ? null : Number(rawVisit);
  if (visitId !== null && (!Number.isInteger(visitId) || visitId <= 0)) {
    return { ok: false, message: "رقم الزيارة غير صالح." };
  }

  const items = sanitizeRxItems(source.items);
  if (items.length === 0) {
    // وصفةٌ بلا دواء ورقةٌ بترويسة المركز وتوقيع الطبيب ولا شيء فيها.
    return { ok: false, message: "الوصفة بلا دواء — أضف دواءً واحدًا على الأقل." };
  }

  const lang = source.instructionsLang;
  if (lang !== undefined && !isInstructionsLang(lang)) {
    return { ok: false, message: "لغة التعليمات غير معروفة." };
  }

  return {
    ok: true,
    value: {
      patientId,
      visitId,
      diagnosis: text(source.diagnosis, MAX_TEXT),
      notes: text(source.notes, MAX_TEXT),
      instructionsLang: isInstructionsLang(lang) ? lang : "both",
      items,
    },
  };
}

export interface Prescription {
  id: number;
  patientId: number;
  patientName: string;
  patientNumber: string;
  visitId: number | null;
  diagnosis: string;
  notes: string;
  instructionsLang: InstructionsLang;
  items: RxItem[];
  issuedBy: string;
  issuedAt: string;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/** أمُبطَلةٌ هي؟ — سؤالٌ يُجاب من حقلٍ واحد، فلا يفترق جوابان عليه. */
export const isVoided = (rx: Pick<Prescription, "voidedAt">): boolean => Boolean(rx.voidedAt);

export type VoidCheck = { ok: true; reason: string } | { ok: false; message: string };

/**
 * أيجوز إبطالها، وبأيّ سبب؟
 *
 * والسبب لازم: من يقرأ السجل بعد سنة يجد وصفةً مُبطَلة، والسؤال الوحيد الذي
 * يعنيه هو **لماذا** — أخطأ الطبيب في الجرعة؟ ظهرت حساسية؟ تغيّرت الخطة؟
 */
export function checkVoid(rx: Pick<Prescription, "voidedAt">, rawReason: unknown): VoidCheck {
  if (isVoided(rx)) {
    return { ok: false, message: "الوصفة مُبطَلة أصلًا." };
  }
  const reason = text(rawReason, MAX_TEXT);
  if (reason.length < MIN_VOID_REASON) {
    return { ok: false, message: "اكتب سبب الإبطال — يبقى في السجل ويُقرأ بعد سنة." };
  }
  return { ok: true, reason };
}

/**
 * أيُعرض هذا النصّ من التعليمات؟
 *
 * ولغةُ التعليمات اختيارُ الطبيب لا لغةُ الورقة: مريضٌ لا يقرأ الإنجليزية
 * تُكتب تعليماته بالعربية ولو طُبعت الروشتة بالإنجليزية للصيدليّ.
 */
export function showsInstructions(lang: InstructionsLang, which: "ar" | "en"): boolean {
  return lang === "both" || lang === which;
}
