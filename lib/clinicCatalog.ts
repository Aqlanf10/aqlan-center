/** Administrative choices only. The treating dentist selects the actual findings and treatment. */
export const CATEGORY_LABELS: Record<string, string> = {
  exam: "الكشف والاستشارة", imaging: "الأشعة والتوثيق", filling: "الحشوات والبناء",
  rct: "علاج العصب", post: "الأوتاد", extraction: "الخلع والجراحة", perio: "اللثة والتنظيف",
  crown: "التيجان", bridge: "الجسور", denture: "الأطقم", implant: "الزراعة",
  veneer: "القشور التجميلية", cosmetic: "التجميل", pediatric: "أسنان الأطفال",
  sealant: "الوقاية", ortho: "التقويم", appliance: "الأجهزة والواقيات", followup: "المتابعة والطوارئ",
};
export const categoryLabel = (category: string | null) => category ? CATEGORY_LABELS[category] ?? category : "أخرى";

const groups: Record<string, [string, string][]> = {
  exam: [["exam", "كشف أسنان"], ["consult", "استشارة تخصصية"], ["comprehensive_exam", "فحص شامل وخطة علاج"]],
  imaging: [["periapical", "أشعة حول ذروية"], ["bitewing", "أشعة جناحية"], ["panorama", "أشعة بانوراما"], ["ceph", "أشعة سيفالومترية"], ["cbct", "أشعة مقطعية CBCT"], ["scan", "مسح رقمي للأسنان"], ["photos", "تصوير وتوثيق الحالة"]],
  filling: [["composite", "حشوة تجميلية"], ["glass_ionomer", "حشوة زجاج أيونومر"], ["temporary", "حشوة مؤقتة"], ["core", "بناء السن"], ["inlay", "حشوة غير مباشرة Inlay / Onlay"], ["filling_repair", "إصلاح حشوة"]],
  rct: [["rct", "علاج عصب / نزع عصب"], ["rct_anterior", "علاج عصب سن أمامي"], ["rct_premolar", "علاج عصب ضاحك"], ["rct_molar", "علاج عصب ضرس"], ["rct_retreatment", "إعادة علاج عصب"], ["pulp_cap", "تغطية لبية"]],
  post: [["post", "وتد ليفي"], ["metal_post", "وتد معدني"], ["cast_post", "وتد مصبوب"], ["post_removal", "إزالة وتد"]],
  extraction: [["simple_extraction", "خلع بسيط"], ["surgical_extraction", "خلع جراحي"], ["wisdom_extraction", "خلع ضرس عقل"], ["retained_root", "إزالة بقايا جذور"], ["abscess_drainage", "تصريف خراج"], ["suture", "خياطة جرح"], ["apicoectomy", "جراحة ذروة الجذر"]],
  perio: [["scaling", "إزالة الجير وتلميع"], ["deep_scaling", "تنظيف عميق وتسوية الجذور"], ["gingivectomy", "قص وتشكيل اللثة"], ["perio_surgery", "جراحة لثة"], ["crown_lengthening", "إطالة تاج السن"]],
  crown: [["zirconia", "تاج زيركون"], ["porcelain_metal", "تاج خزف على معدن"], ["emax", "تاج إيماكس"], ["temporary_crown", "تاج مؤقت"], ["recement_crown", "إعادة تثبيت تاج"], ["remove_crown", "إزالة تاج"]],
  bridge: [["bridge", "جسر ثابت"], ["bridge_repair", "إصلاح جسر"], ["bridge_cement", "تثبيت جسر"]],
  denture: [["full_denture", "طقم كامل"], ["partial_denture", "طقم جزئي"], ["flexible_denture", "طقم مرن"], ["denture_repair", "إصلاح طقم"], ["reline", "تبطين طقم"]],
  implant: [["implant", "زراعة سن"], ["implant_abutment", "دعامة زرعة"], ["implant_crown", "تاج على زرعة"], ["bone_graft", "تطعيم عظمي"], ["sinus_lift", "رفع جيب فكي"]],
  veneer: [["veneer", "قشرة خزفية"], ["composite_veneer", "قشرة كومبوزيت"]],
  cosmetic: [["office_whitening", "تبييض في العيادة"], ["home_whitening", "قوالب تبييض منزلي"], ["cosmetic_recontour", "تعديل شكل السن"]],
  pediatric: [["child_filling", "حشوة سن لبني"], ["pulpotomy", "بتر لب سن لبني"], ["pulpectomy", "علاج عصب سن لبني"], ["child_crown", "تاج معدني لسن لبني"], ["child_extraction", "خلع سن لبني"], ["space_maintainer", "حافظ مسافة"]],
  sealant: [["sealant", "سد الشقوق الوقائي"], ["fluoride", "تطبيق فلورايد"], ["hygiene_instruction", "تعليم العناية بالفم"]],
  ortho: [["ortho_records", "سجلات وخطة تقويم"], ["fixed_ortho", "تركيب تقويم ثابت"], ["aligner", "تقويم شفاف"], ["ortho_adjustment", "شد ومتابعة تقويم"], ["bracket_repair", "إعادة تثبيت حاصرة"], ["ortho_remove", "فك التقويم"], ["retainer", "مثبت بعد التقويم"]],
  appliance: [["night_guard", "واقي ليلي"], ["sports_guard", "واقي رياضي"], ["appliance_repair", "إصلاح جهاز متحرك"]],
  followup: [["followup", "مراجعة ومتابعة"], ["emergency", "زيارة طارئة"], ["suture_removal", "إزالة خيوط"], ["dressing", "تغيير ضماد"], ["occlusal_adjustment", "تعديل إطباق"]],
};
export const CLINIC_SERVICES = Object.entries(groups).flatMap(([category, entries]) =>
  entries.map(([code, name]) => ({ code, name, category })));
export const TREATMENT_BUNDLES = [
  { name: "علاج عصب + وتد + بناء", codes: ["rct", "post", "core"] },
  { name: "علاج عصب + وتد + بناء + تاج زيركون", codes: ["rct", "post", "core", "zirconia"] },
  { name: "كشف + أشعة حول ذروية", codes: ["exam", "periapical"] },
  { name: "تنظيف + تلميع + فلورايد", codes: ["scaling", "fluoride"] },
];
export const QUICK_NOTES: Record<string, string[]> = {
  "الشكوى الرئيسية": ["ألم في السن", "ألم عند المضغ", "حساسية للبارد", "حساسية للحار", "تورم", "نزيف لثة", "كسر سن أو حشوة", "فقدان سن", "مراجعة علاج عصب", "مراجعة تقويم", "طلب تجميلي", "كشف دوري"],
  "الفحص": ["أُجري فحص داخل الفم", "أُجري فحص خارج الفم", "أُجري اختبار القرع", "أُجري اختبار حيوية اللب", "أُجري فحص اللثة", "أُجري تقييم الإطباق", "تمت مراجعة الأشعة"],
  "التشخيص": ["تسوس سني", "التهاب لب قابل للعكس", "التهاب لب غير قابل للعكس", "تموت اللب", "التهاب حول الذروة", "خراج سني", "التهاب لثة", "التهاب دواعم السن", "كسر تاج السن", "سن مفقود", "سن منطمر", "سوء إطباق", "يحتاج استكمال الفحوص"],
  "ما نُفّذ": ["فحص وتقييم الحالة", "شرح الخطة للمريض", "بدء علاج العصب", "تنظيف وتشكيل القنوات", "حشو القنوات", "تركيب وتد", "بناء السن", "تحضير للتاج", "أخذ طبعة", "تجربة التركيبة", "تثبيت التركيبة", "جلسة متابعة دون إجراء جديد مستحق", "تعليمات بعد العلاج"],
  "الخطة القادمة": ["استكمال علاج العصب", "تركيب وتد وبناء", "تحضير تاج", "أخذ طبعة", "تجربة التركيبة", "تثبيت نهائي", "استكمال الحشوات", "مراجعة اللثة", "مراجعة تقويم", "إزالة خيوط", "مراجعة دورية", "إحالة إلى اختصاصي"],
};
