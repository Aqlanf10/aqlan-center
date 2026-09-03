/**
 * التحليل السيفالومتري — الهندسة والقياس.
 *
 * التحليل السيفالومتري هو أن تُعلَّم نقاطٌ تشريحية على الأشعة الجانبية، ثم تُحسب
 * منها زوايا ومسافات تُقارَن بالمعايير — فيُعرف موضع الفكّين من قاعدة الجمجمة
 * وميل القواطع ونمط النمو. وعليه تُبنى خطة التقويم كلها.
 *
 * ### القاعدة الحاكمة: القياس **يُشتقّ** ولا يُخزَّن
 *
 * تُحفظ النقاط وحدها. وكل زاوية تُحسب من النقاط عند كل عرض — كما تُشتقّ القيود
 * المحاسبية من المستندات لا تُكتب بجانبها. ولو خُزّنت الزوايا لصار للحقيقة مصدران:
 * يُصحَّح موضع نقطةٍ بعد مراجعة، فتبقى الزاوية القديمة في الجدول وتُبنى عليها خطة.
 *
 * ### ولماذا هذه القياسات دون غيرها — بصراحة
 *
 * زوايا **النقاط الثلاث** (كالزاوية عند N بين S وA) تعريفها واحدٌ لا خلاف فيه: هي
 * الزاوية بين شعاعين من رأسٍ واحد، وتُحسب كما تُقاس على الورق بالمنقلة تمامًا.
 *
 * أمّا زوايا **المستويات** (SN-MP، FMA، IMPA، الزاوية بين القاطعين…) فتعريفها
 * يحتاج اصطلاحًا: أيّ جهةٍ من التقاطع تُقاس، وأيّ الزاويتين المتكاملتين تُذكر.
 * وخطأٌ فيه يقلب ٣٥° إلى ١٤٥° — فيُقلب معه التشخيص.
 *
 * ولم يُكتب الاصطلاح من الذاكرة، بل **ثُبِّت بالبناء**: بُني وجهٌ سويّ في إطار
 * فرانكفورت من قيمٍ معيارية، ثم جُرِّب لكل قياس أيّ اتجاهَي الشعاعين يُعيد معياره.
 * والحكم ليس مطابقة رقمٍ واحد — بل **علاقتان متقاطعتان** لا تتحققان إلا إن صحّ
 * الاصطلاح كلّه معًا:
 *
 *   • SN-MP − FMA = ميل SN عن مستوى فرانكفورت (٧°)
 *   • SNA + U1-NA = U1-SN
 *
 * وفوقهما حارسٌ ثالث في الاختبارات: **اتجاه التغيّر**. قاطعٌ يُمال أمامًا يجب أن
 * تزيد IMPA، وفكٌّ أشدّ انحدارًا يجب أن تزيد FMA. واصطلاحٌ مقلوب يمرّ من مطابقة
 * الرقم أحيانًا، ولا يمرّ من اتجاه التغيّر أبدًا.
 */

/* ─────────────────────────── النقاط التشريحية ─────────────────────────── */

/**
 * النقاط الأربع والعشرون المعتمدة.
 *
 * **المصدر**: «الدليل السريري لتعريف واعتماد النقاط السيفالومترية الجانبية»،
 * الإصدار ADP-LM-LAT-v1.0-PILOT، المعتمد والموقَّع من د. عقلان الكامل ود. عبدالله
 * بتاريخ ١٦/٧/٢٠٢٦. والتعريفات هنا منقولةٌ منه لا مصوغةٌ من عندي — فالبرنامج يتبع
 * الوثيقة المعتمدة، ولا تُصاغ التعريفات في الكود ثم يُطلب من الطبيب أن يوافقها.
 *
 * وقرارات الدليل التي تظهر في التلميحات: البوريون **التشريحي** لا قضيب الأذن،
 * واللقمة الأبعد عن الفيلم عند ظهور اللقمتين، وطرفُ القاطع وذروته من **السن نفسه**
 * بلا مزجٍ بين صورتين متراكبتين.
 *
 * وأيّ تعديل على تعريفٍ هنا يستلزم إصدارًا جديدًا من الدليل — لا تغييرًا صامتًا في
 * الكود: الوثيقة موقَّعة، وتغييرُ ما وُقّع عليه بلا إصدارٍ جديد يُبطل قيمة التوقيع.
 */
export const LANDMARK_MANUAL = "ADP-LM-LAT-v1.0-PILOT";

export type LandmarkCode =
  | "S" | "N" | "Or" | "Po" | "Co" | "Ar"
  | "ANS" | "PNS" | "A"
  | "B" | "Pog" | "Gn" | "Me" | "Go" | "D" | "Pm"
  | "U1T" | "U1A" | "L1T" | "L1A"
  | "Pn" | "Cm" | "LS" | "LI"
  // من الأدبيات المنشورة لا من الدليل الموقَّع — بإذن المالك.
  | "Ba" | "U6" | "L6" | "PogS";

export type LandmarkGroup = "cranial" | "maxilla" | "mandible" | "teeth" | "soft";

export const GROUP_LABEL: Record<LandmarkGroup, { ar: string; en: string }> = {
  cranial: { ar: "قاعدة الجمجمة", en: "Cranial base" },
  maxilla: { ar: "الفك العلوي", en: "Maxilla" },
  mandible: { ar: "الفك السفلي", en: "Mandible" },
  teeth: { ar: "الأسنان", en: "Teeth" },
  soft: { ar: "الأنسجة الرخوة", en: "Soft tissue" },
};

export interface LandmarkDefinition {
  code: LandmarkCode;
  group: LandmarkGroup;
  name: { ar: string; en: string };
  /** التعريف التشريحي كما في مصدره. */
  hint: { ar: string; en: string };
  /** مطلوبة لأبسط تحليل — وما عداها يُعلَّم فتُحسب قياساته. */
  required: boolean;
  /**
   * مصدر التعريف — والتمييز هنا مقصود.
   *
   * أربعٌ وعشرون نقطةً من دليل المالك الموقَّع، وما بعدها من الأدبيات المنشورة
   * بإذنه. وخلطُهما كان سيجعل الشاشة تقول «منقولةٌ من الدليل المعتمد» عن نقطةٍ لم
   * يوقّعها أحد — فيصير الادّعاء أكبر من الحقيقة، وهو أخطر من النقص.
   */
  source?: string;
}

/** الدليل السريري الموقَّع — وما لا يحمل مصدرًا آخر فهو منه. */
export const MANUAL_SOURCE = LANDMARK_MANUAL;

export const LANDMARKS: LandmarkDefinition[] = [
  { code: "S", group: "cranial", required: true,
    name: { ar: "سيلا", en: "Sella" },
    hint: { ar: "المركز الهندسي للحد الشعاعي للحفرة النخامية — لا نقطة على أحد جدرانها",
            en: "Geometric centre of the radiographic outline of the pituitary fossa" } },
  { code: "N", group: "cranial", required: true,
    name: { ar: "ناسيون", en: "Nasion" },
    hint: { ar: "أكثر نقطة أمامية على الدرز الجبهي الأنفي — لا ناسيون الأنسجة الرخوة",
            en: "Most anterior point of the frontonasal suture — not soft-tissue nasion" } },
  { code: "Or", group: "cranial", required: false,
    name: { ar: "أوربيتالي", en: "Orbitale" },
    hint: { ar: "أدنى نقطة على الحافة السفلية للحجاج — لبناء مستوى فرانكفورت",
            en: "Lowest point on the inferior orbital rim — builds Frankfort plane" } },
  { code: "Po", group: "cranial", required: false,
    name: { ar: "بوريون تشريحي", en: "Anatomical Porion" },
    hint: { ar: "أعلى نقطة على الحد التشريحي للصماخ السمعي الخارجي — لا مركز قضيب الأذن",
            en: "Highest point of the anatomical external auditory meatus — not the ear rod" } },
  { code: "Co", group: "cranial", required: false,
    name: { ar: "كونديليون", en: "Condylion" },
    hint: { ar: "أكثر نقطة خلفية علوية على رأس اللقمة — وتُختار اللقمة الأبعد عن الفيلم",
            en: "Most postero-superior point of the condyle — the condyle farther from the film" } },
  { code: "Ar", group: "cranial", required: false,
    name: { ar: "أرتيكولاري", en: "Articulare" },
    hint: { ar: "تقاطع الحد الخلفي للرامس/اللقمة مع الحد السفلي لقاعدة الجمجمة — إنشائية",
            en: "Intersection of the ramus/condyle posterior border with the cranial base — constructed" } },

  { code: "ANS", group: "maxilla", required: false,
    name: { ar: "الشوكة الأنفية الأمامية", en: "Anterior Nasal Spine" },
    hint: { ar: "أكثر طرف عظمي أمامي للشوكة عند الحافة السفلية للفتحة الأنفية",
            en: "Most anterior bony tip of the spine at the inferior nasal aperture" } },
  { code: "PNS", group: "maxilla", required: false,
    name: { ar: "الشوكة الأنفية الخلفية", en: "Posterior Nasal Spine" },
    hint: { ar: "أكثر طرف خلفي للحنك الصلب",
            en: "Most posterior tip of the hard palate" } },
  { code: "A", group: "maxilla", required: true,
    name: { ar: "النقطة A", en: "Point A (Subspinale)" },
    hint: { ar: "أعمق نقطة على التقعّر الأمامي للفك العلوي بين ANS والعرف السنخي",
            en: "Deepest point of the anterior maxillary concavity between ANS and the alveolar crest" } },

  { code: "B", group: "mandible", required: true,
    name: { ar: "النقطة B", en: "Point B (Supramentale)" },
    hint: { ar: "أعمق نقطة على التقعّر السنخي الأمامي للفك السفلي بين السنخ وPogonion",
            en: "Deepest point of the anterior mandibular concavity between the alveolus and Pogonion" } },
  { code: "Pog", group: "mandible", required: false,
    name: { ar: "بوجونيون عظمي", en: "Bony Pogonion" },
    hint: { ar: "أكثر نقطة أمامية على القشرة العظمية الخارجية للارتفاق الذقني",
            en: "Most anterior point on the outer cortex of the bony symphysis" } },
  { code: "Gn", group: "mandible", required: false,
    name: { ar: "غناثيون", en: "Gnathion" },
    hint: { ar: "على الذقن بين Pogonion وMenton وفق منصّف الزاوية — لا متوسط إحداثيات",
            en: "On the chin between Pogonion and Menton at the angle bisector — not a coordinate average" } },
  { code: "Me", group: "mandible", required: false,
    name: { ar: "منتون", en: "Menton" },
    hint: { ar: "أدنى نقطة على الحد العظمي للارتفاق الذقني",
            en: "Lowest point on the bony outline of the symphysis" } },
  { code: "Go", group: "mandible", required: false,
    name: { ar: "غونيون", en: "Gonion" },
    hint: { ar: "منصّف تقاطع مماسّي الحد الخلفي للرامس والحد السفلي لجسم الفك — إنشائية",
            en: "Bisector of the ramus posterior and mandibular inferior tangents — constructed" } },
  { code: "D", group: "mandible", required: false,
    name: { ar: "النقطة D", en: "Point D" },
    /*
     * **مركز الارتفاق لا حدُّه.**
     *
     * وكان الوصف هنا «على الحد الشفوي» — وهو وصفٌ لنقطةٍ أخرى. وSND تُقاس من
     * مركز الارتفاق العظمي، والفرق بين المركز والحدّ الأمامي عدّة مليمترات،
     * فتُقارَن زاويةٌ مبنيّة على الحدّ بمعيار ٧٧° المبنيّ على المركز — ويخرج
     * الفرق حكمًا على موضع الفك السفلي لا سند له.
     */
    hint: { ar: "مركز الارتفاق الذقني العظمي — منتصفه هندسيًّا، لا نقطةٌ على حدّه",
            en: "Centre of the bony symphysis — its geometric middle, not a point on its outline" } },
  { code: "Pm", group: "mandible", required: false,
    name: { ar: "بروتوبرانس منتي", en: "Protuberance Menti" },
    hint: { ar: "حيث يتغيّر الحد الأمامي للارتفاق من التقعّر إلى التحدّب فوق Pogonion",
            en: "Where the anterior symphysis outline turns from concave to convex above Pogonion" } },

  { code: "U1T", group: "teeth", required: false,
    name: { ar: "طرف القاطع العلوي", en: "Upper Incisor Tip" },
    hint: { ar: "طرف الحافة القاطعة للقاطع المركزي العلوي المختار — سنٌّ واحد بلا مزج",
            en: "Incisal edge tip of the selected upper central incisor — one tooth, no averaging" } },
  { code: "U1A", group: "teeth", required: false,
    name: { ar: "ذروة القاطع العلوي", en: "Upper Incisor Apex" },
    hint: { ar: "ذروة جذر القاطع نفسه الممثَّل بـ U1T — لا سنٍّ آخر",
            en: "Root apex of the same tooth represented by U1T" } },
  { code: "L1T", group: "teeth", required: false,
    name: { ar: "طرف القاطع السفلي", en: "Lower Incisor Tip" },
    hint: { ar: "طرف الحافة القاطعة للقاطع المركزي السفلي المختار",
            en: "Incisal edge tip of the selected lower central incisor" } },
  { code: "L1A", group: "teeth", required: false,
    name: { ar: "ذروة القاطع السفلي", en: "Lower Incisor Apex" },
    hint: { ar: "ذروة جذر القاطع نفسه الممثَّل بـ L1T",
            en: "Root apex of the same tooth represented by L1T" } },

  { code: "Pn", group: "soft", required: false,
    name: { ar: "برونازالي", en: "Pronasale" },
    hint: { ar: "أكثر نقطة أمامية على طرف الأنف في ملف الأنسجة الرخوة",
            en: "Most anterior point of the nasal tip on the soft-tissue profile" } },
  { code: "Cm", group: "soft", required: false,
    name: { ar: "نقطة الكولوميلا", en: "Columella Point" },
    hint: { ar: "نقطة المماس الأمامية السفلية على الكولوميلا — تُبنى بها الزاوية الأنفية الشفوية",
            en: "Antero-inferior tangent point on the columella — builds the nasolabial angle" } },
  { code: "LS", group: "soft", required: false,
    name: { ar: "لابيالي سوبيريوس", en: "Labiale Superius" },
    hint: { ar: "أكثر نقطة أمامية على حد الشفة العليا",
            en: "Most anterior point of the upper lip vermilion" } },
  { code: "LI", group: "soft", required: false,
    name: { ar: "لابيالي إنفيريوس", en: "Labiale Inferius" },
    hint: { ar: "أكثر نقطة أمامية على حد الشفة السفلى",
            en: "Most anterior point of the lower lip vermilion" } },

  /*
   * ما بعد هذا من الأدبيات المنشورة لا من الدليل الموقَّع — بإذن المالك.
   * وكلٌّ يحمل مرجعه، ويُعرض في الشاشة موسومًا حتى لا يختلط بما اعتُمد ووُقّع.
   */
  { code: "Ba", group: "cranial", required: false,
    source: "Ricketts 1960 — قاعدة الجمجمة",
    name: { ar: "بازيون", en: "Basion" },
    hint: { ar: "أدنى وأخلف نقطة على الحافة الأمامية للثقبة العظمى، في المستوى المتوسط",
            en: "Most inferior-posterior point on the anterior margin of foramen magnum, in the midsagittal plane" } },

  { code: "U6", group: "teeth", required: false,
    source: "Jacobson 1975 — مستوى الإطباق الوظيفي",
    name: { ar: "إنسي الرحى العلوية", en: "Upper first molar cusp" },
    hint: { ar: "قمة الحدبة الإنسية الدهليزية للرحى الأولى العلوية — لبناء مستوى الإطباق",
            en: "Mesiobuccal cusp tip of the upper first molar — builds the occlusal plane" } },
  { code: "L6", group: "teeth", required: false,
    source: "Jacobson 1975 — مستوى الإطباق الوظيفي",
    name: { ar: "إنسي الرحى السفلية", en: "Lower first molar cusp" },
    hint: { ar: "قمة الحدبة الإنسية الدهليزية للرحى الأولى السفلية — ومنتصف ما بينهما مع العلوية نقطةُ المستوى الخلفية",
            en: "Mesiobuccal cusp tip of the lower first molar — its midpoint with the upper one is the posterior occlusal point" } },

  { code: "PogS", group: "soft", required: false,
    source: "Ricketts 1968 — الخط الجمالي E-line",
    name: { ar: "بوجونيون النسيج الرخو", en: "Soft tissue Pogonion" },
    hint: { ar: "أكثر نقطة أمامية على ظلّ الذقن الرخو — لا على العظم",
            en: "Most anterior point on the soft tissue chin outline — not on bone" } },

];

export const LANDMARK_BY_CODE = new Map(LANDMARKS.map((item) => [item.code, item]));

export function isLandmarkCode(value: unknown): value is LandmarkCode {
  return typeof value === "string" && LANDMARK_BY_CODE.has(value as LandmarkCode);
}

/**
 * إحداثيات النقطة **نسبيّة** لا بالبكسل: كسرٌ من عرض الصورة وارتفاعها (0..1).
 *
 * فالصورة تُعرض بأحجام مختلفة — على شاشة العيادة وعلى هاتف الطبيب — والنقطة يجب
 * أن تقع على المَعلم نفسه في الحالتين. وتخزينُ البكسل يربط التتبّع بمقاس عرضٍ
 * بعينه، فيزيح كل شيء عند أول تغيير في الشاشة.
 */
export interface TracedPoint {
  x: number;
  y: number;
}

export type Tracing = Partial<Record<LandmarkCode, TracedPoint>>;

/* ─────────────────────────── الهندسة ─────────────────────────── */

/**
 * تحويل من إحداثيات الصورة إلى إحداثيات التحليل.
 *
 * محور الصورة الرأسي يزداد **نزولًا**، وهذا يقلب إشارة كل زاوية ويجعل «أعلى»
 * تُحسب «أسفل». فتُقلب مرةً واحدة هنا عند الحدّ، ويبقى كل ما بعده بالاصطلاح
 * الطبيعي: y موجبة إلى الأعلى.
 */
interface Vector { x: number; y: number }

function toAnalysis(point: TracedPoint, aspect: number): Vector {
  // النسبة بين العرض والارتفاع تُعاد إلى الحساب: نقطتان متساويتا الإزاحة نسبيًّا
  // على صورةٍ غير مربّعة ليستا متساويتين على الورق، وزاويةٌ تُحسب بلا ذلك خطأ.
  return { x: point.x * aspect, y: -point.y };
}

const subtract = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (v: Vector): number => Math.hypot(v.x, v.y);

/** الزاوية بين متجهين، بالدرجات، في المدى 0..180. */
function angleBetween(u: Vector, v: Vector): number {
  const lengths = norm(u) * norm(v);
  if (lengths === 0) return Number.NaN;
  const cosine = Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y) / lengths));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * الزاوية عند رأسٍ بين شعاعين — وهي القياس الذي لا التباس فيه.
 *
 * `angleAt(N, S, A)` هي زاوية SNA حرفيًّا: رأسها عند الناسيون، وضلعاها إلى السرج
 * وإلى النقطة A. لا اصطلاح فيها ولا جهة تُختار — كما تُقاس بالمنقلة على الورق.
 */
export function angleAt(
  vertex: TracedPoint, first: TracedPoint, second: TracedPoint, aspect = 1,
): number {
  const v = toAnalysis(vertex, aspect);
  return angleBetween(subtract(toAnalysis(first, aspect), v), subtract(toAnalysis(second, aspect), v));
}

/**
 * الزاوية بين خطّين مُعرَّفَين باتجاهيهما.
 *
 * والاتجاه هنا **جزءٌ من التعريف لا تفصيلٌ فيه**: الزاوية بين S→N وGo→Me غير
 * الزاوية بين N→S وGo→Me — إحداهما ٣٢° والأخرى ١٤٨°. ولذلك يُكتب لكل قياس شعاعاه
 * صراحةً، ويُثبَّت بالبناء لا بالذاكرة.
 */
export function lineAngle(
  from1: TracedPoint, to1: TracedPoint,
  from2: TracedPoint, to2: TracedPoint,
  aspect = 1,
): number {
  const a = toAnalysis(from1, aspect), b = toAnalysis(to1, aspect);
  const c = toAnalysis(from2, aspect), d = toAnalysis(to2, aspect);
  return angleBetween(subtract(b, a), subtract(d, c));
}

/** المسافة بين نقطتين بوحدات الصورة النسبية — تُحوَّل إلى مليمترات بالمعايرة. */
export function distanceBetween(a: TracedPoint, b: TracedPoint, aspect = 1): number {
  return norm(subtract(toAnalysis(a, aspect), toAnalysis(b, aspect)));
}

/**
 * بُعد نقطةٍ عن خطّ، بإشارةٍ تقول أيّ جهةٍ هي منه.
 *
 * والإشارة هنا هي القياس كلّه: `U1-NA = 4mm` تعني أن القاطع **أمام** خط NA بأربعة،
 * و`-4` تعني أنه خلفه بأربعة — وبينهما علاجان مختلفان تمامًا. فالقيمة المطلقة
 * تمحو التشخيص لا تُبسّطه.
 *
 * ولا تُؤخذ الجهة من محور الصورة: الأشعة الجانبية تُصوَّر ووجهها إلى اليمين أحيانًا
 * وإلى اليسار أحيانًا، فربطُ «الأمام» بـ`+x` يقلب كل إشارةٍ على نصف الصور. فتُؤخذ
 * الجهة من التشريح نفسه: تُمرَّر نقطةٌ **معلومة الخلفية** (السرج S خلف كل شيء)،
 * ويكون الموجب هو الجهة المقابلة لها. فتصحّ الإشارة على الصورتين بلا إعداد.
 */
/**
 * الفجوة بين نقطتين **مقيسةً على اتجاه خط** — أساس Wits.
 *
 * ولا تُقاس على المسافة المباشرة بينهما: تقييم Wits يُسقط A وB عمودًا على مستوى
 * الإطباق ثم يقيس ما بين مسقطيهما **على المستوى نفسه**. والفرق بين القياسين هو
 * الفرق بين «كم يتقدّم الفك العلوي على السفلي في مستوى العضّة» و«كم يبعدان».
 *
 * واتجاه المستوى يُوجَّه تشريحيًّا: من الخلف إلى الأمام، فتخرج الإشارة موجبةً حين
 * يتقدّم A — وهو الصنف الثاني — وسالبةً في الثالث، على الصورتين معًا.
 */
export function projectedGap(
  ahead: TracedPoint, behind: TracedPoint,
  lineFrom: TracedPoint, lineTo: TracedPoint,
  aspect = 1,
): number {
  const a = toAnalysis(lineFrom, aspect), b = toAnalysis(lineTo, aspect);
  const direction = subtract(b, a);
  const length = norm(direction);
  if (length === 0) return Number.NaN;
  const unit = { x: direction.x / length, y: direction.y / length };
  const gap = subtract(toAnalysis(ahead, aspect), toAnalysis(behind, aspect));
  return gap.x * unit.x + gap.y * unit.y;
}

/** أيّ الطرفين أمام؟ — يُوجَّه به خطٌّ بلا اعتمادٍ على محور الصورة. */
export function orientedForward(
  from: TracedPoint, to: TracedPoint,
  frontHint: TracedPoint, backHint: TracedPoint,
  aspect = 1,
): { from: TracedPoint; to: TracedPoint } {
  return projectedGap(frontHint, backHint, from, to, aspect) >= 0
    ? { from, to } : { from: to, to: from };
}

export function offsetFromLine(
  point: TracedPoint,
  from: TracedPoint, to: TracedPoint,
  behind: TracedPoint,
  aspect = 1,
): number {
  const a = toAnalysis(from, aspect), b = toAnalysis(to, aspect);
  const direction = subtract(b, a);
  const length = norm(direction);
  if (length === 0) return Number.NaN;
  // العمودي على الخط، ثم إسقاط الفرق عليه: حاصل الضرب المتّجه في المستوي.
  const side = (p: Vector) => {
    const d = subtract(p, a);
    return (direction.x * d.y - direction.y * d.x) / length;
  };
  const behindSide = side(toAnalysis(behind, aspect));
  if (behindSide === 0) return Number.NaN;
  // الموجب هو الجهة المقابلة للنقطة الخلفية.
  return side(toAnalysis(point, aspect)) * (behindSide < 0 ? 1 : -1);
}

/* ─────────────────────────── المعايرة ─────────────────────────── */

/**
 * المقياس: كم مليمترًا في وحدة الصورة النسبية.
 *
 * الأشعة السيفالومترية تُصوَّر بتكبيرٍ يختلف بين جهازٍ وآخر، فلا يُقاس منها طولٌ
 * بلا معايرة. والطريقة المعتادة أن يُعلَّم على الفيلم مسطرةٌ أو مؤشّرٌ معلوم الطول،
 * فيُعلَّم طرفاه وتُكتب المسافة الحقيقية بينهما.
 *
 * وما لم تُضبط المعايرة **لا تُعرض القياسات الطولية أصلًا** — ولا تُعرض بالبكسل
 * ولا بأيّ وحدةٍ أخرى. رقمٌ بلا وحدة يُقرأ كأنه مليمترات، ويُبنى عليه قرار.
 */
export interface Calibration {
  /** طرفا المؤشّر المعلوم على الصورة. */
  from: TracedPoint;
  to: TracedPoint;
  /** المسافة الحقيقية بينهما بالمليمتر. */
  millimetres: number;
}

export function millimetresPerUnit(calibration: Calibration, aspect = 1): number | null {
  const span = distanceBetween(calibration.from, calibration.to, aspect);
  if (!(span > 0) || !(calibration.millimetres > 0)) return null;
  return calibration.millimetres / span;
}

/* ─────────────────────────── القياسات ─────────────────────────── */

export type Verdict = "low" | "normal" | "high";

export interface Norm {
  mean: number;
  /** الانحراف المعتاد — وخارجه يُعدّ القياس منخفضًا أو مرتفعًا. */
  tolerance: number;
  /** مرجع المعيار — كي يُراجَع لا يُصدَّق. */
  source: string;
  /**
   * معيارُ بالغين — **لا يُحكم به على وجهٍ ما زال ينمو**.
   *
   * وأطوال McNamara أوضح مثال: Co-A لطفلٍ في التاسعة نحو ٨٥ مم وهو سويٌّ
   * تمامًا لعمره، ومعيار البالغين ٩٤±٥ — فيخرج «منخفضًا» على ورقةٍ موقَّعة،
   * ويُقرأ نقصًا فكّيًّا يستدعي جهاز نموّ أو جراحة. والخطأ صامت: الرقم صحيح،
   * والحكم عليه وحده الكاذب.
   *
   * فحين يكون المريض دون سنّ اكتمال النموّ — أو عمرُه غير معروف — يُعرض
   * القياس **بلا معيارٍ وبلا حكم**، كما تُعرض الارتفاعات الوجهية.
   */
  adultOnly?: true;
}

/** نصٌّ بلغتين — التقويم علمٌ مصطلحاته إنجليزية، والعمل اليومي عربي. */
export interface Bilingual {
  ar: string;
  en: string;
}

export type Lang = "ar" | "en";

export const say = (text: Bilingual, lang: Lang): string => text[lang];

export type Unit = "deg" | "mm" | "ratio";

export interface Measurement {
  key: string;
  name: string;
  /** ما يعنيه القياس سريريًّا — لا تعريفه الهندسي. */
  meaning: Bilingual;
  unit: Unit;
  value: number;
  /**
   * المعيار — وقد لا يكون له معيار.
   *
   * ارتفاعُ الوجه الأمامي يختلف بالعمر والجنس اختلافًا كبيرًا، فمعيارٌ واحد له
   * لكل المرضى رقمٌ مخترع. فيُعرض الطول بلا حكم: قيمةٌ تُقرأ ولا تُصنَّف — وهذا
   * أصدق من «ضمن المعيار» مبنيّةٍ على معيارٍ لا يخصّ هذا المريض.
   */
  norm: Norm | null;
  verdict: Verdict | null;
  /** النقاط التي بُني عليها — فيُعرف أيّها يُراجَع إن بدا الرقم غريبًا. */
  from: LandmarkCode[];
  /** التحليل الذي ينتمي إليه — فتُقرأ القياسات مجموعةً كما تُقرأ في المراجع. */
  analysis?: string;
  /**
   * لماذا لا معيار — حين يكون للقياس معيارٌ منشور لكنه لا يخصّ هذا المريض.
   *
   * وفرقٌ بين «لا معيار له» و«له معيارٌ لا ينطبق عليك»: الثاني يُقال للقارئ
   * كي لا يظنّ القياس مهملًا فيبحث عن حكمٍ في مكانٍ آخر.
   */
  normNote?: Bilingual;
}

/**
 * الدرجة المعيارية — كم انحرافًا معياريًّا يبعد القياس عن متوسّطه.
 *
 * و«خارج المعيار» وحدها لا تكفي سريريًّا: قياسٌ يتجاوز حدَّه بعُشر درجة ليس كقياسٍ
 * يتجاوزه بثلاثة انحرافات، والعلاج يختلف. فيُعطى بُعدُه رقمًا يُقارَن به غيرُه.
 *
 * والانحراف المذكور في معاييرنا (‎82±2‎) هو الانحراف المعياري المنشور، فيُقسَم عليه.
 */
export function zScore(value: number, norm: Norm | null): number | null {
  if (!norm || !Number.isFinite(value) || !Number.isFinite(norm.mean)) return null;
  if (!Number.isFinite(norm.tolerance) || norm.tolerance <= 0) return null;
  return (value - norm.mean) / norm.tolerance;
}

export type Severity = "within" | "mild" | "marked";

export const SEVERITY_LABEL: Record<Severity, Bilingual> = {
  within: { ar: "داخل المدى المرجعي", en: "within the reference range" },
  mild: { ar: "انحرافٌ بسيط", en: "mild deviation" },
  marked: { ar: "انحرافٌ واضح", en: "marked deviation" },
};

/**
 * تصنيف البُعد: داخل المدى (‎|Z| ≤ 1‎)، بسيط (‎1–2‎)، واضح (فوق ‎2‎).
 *
 * قراءةُ عرضٍ لا حكمٌ سريري — واللفظ محمولٌ في النصّ لا في اللون وحده، فمن يطبع
 * التقرير بالأبيض والأسود يقرأ ما يقرأه من ينظر إلى الشاشة.
 */
export function severityOf(z: number | null): Severity | null {
  if (z === null || !Number.isFinite(z)) return null;
  const away = Math.abs(z);
  if (away <= 1) return "within";
  return away <= 2 ? "mild" : "marked";
}

export function verdictFor(value: number, norm: Norm): Verdict {
  if (value < norm.mean - norm.tolerance) return "low";
  if (value > norm.mean + norm.tolerance) return "high";
  return "normal";
}

/**
 * المعايير الافتراضية — الكلاسيكية المنشورة، كلٌّ بمرجعه.
 *
 * وهي **بذرةٌ لا حكم**: تُزرع بها المجموعة المرجعية الافتراضية في القاعدة عند أول
 * تشغيل، ثم تُقرأ المعايير من هناك — فللمدير أن يعدّلها أو يضيف مجموعةً محلّية
 * لمرضى المركز. وبقاؤها هنا لأن للنظام أن يعمل قبل أن تُزرع القاعدة، ولأن الافتراض
 * يجب أن يكون مكتوبًا في مكانٍ واحد يُقرأ ويُراجَع.
 */
export const DEFAULT_NORMS: Record<string, Norm> = {
  // المعايير القوقازية لستاينر، وهي الأوسع استعمالًا في التقويم السريري.
  // وليست مطلقة: تختلف بالعرق والجنس والعمر — ولذلك يُذكر المرجع ويُقرأ الرقم
  // مع الوجه لا وحده.
  SNA: { mean: 82, tolerance: 2, source: "Steiner" },
  SNB: { mean: 80, tolerance: 2, source: "Steiner" },
  ANB: { mean: 2, tolerance: 2, source: "Steiner" },
  SN_GoGn: { mean: 32, tolerance: 5, source: "Steiner" },
  FMA: { mean: 25, tolerance: 5, source: "Tweed" },
  IMPA: { mean: 90, tolerance: 5, source: "Tweed" },
  U1_SN: { mean: 103, tolerance: 5, source: "Steiner" },
  U1_NA: { mean: 22, tolerance: 4, source: "Steiner" },
  L1_NB: { mean: 25, tolerance: 4, source: "Steiner" },
  INTERINCISAL: { mean: 131, tolerance: 9, source: "Downs" },
  Y_AXIS: { mean: 59, tolerance: 4, source: "Downs" },
  // القياسات الطولية بالمليمتر — ولا تُحسب إلا بعد المعايرة.
  U1_NA_MM: { mean: 4, tolerance: 2, source: "Steiner" },
  L1_NB_MM: { mean: 4, tolerance: 2, source: "Steiner" },
  POG_NB_MM: { mean: 4, tolerance: 2, source: "Steiner" },
  // نسبةٌ لا طول: تُقسم فيها المسافتان فيسقط المقياس — فتُحسب بلا معايرة أصلًا.
  JARABAK: { mean: 63.5, tolerance: 1.5, source: "Jarabak" },
  // من الأدبيات المنشورة — بإذن المالك، وكلٌّ بمرجعه.
  FMIA: { mean: 65, tolerance: 5, source: "Tweed 1954" },
  WITS: { mean: 1, tolerance: 2, source: "Jacobson 1975 · \u2642 1\u00b12 \u00b7 \u2640 0\u00b12" },
  OCC_SN: { mean: 14, tolerance: 3, source: "Steiner" },
  FACIAL_ANGLE: { mean: 87.8, tolerance: 3.6, source: "Downs 1948" },
  CONVEXITY: { mean: 0, tolerance: 5.1, source: "Downs 1948" },
  AB_PLANE: { mean: -4.6, tolerance: 3.7, source: "Downs 1948" },
  E_LINE_UPPER: { mean: -4, tolerance: 2, source: "Ricketts 1968" },
  E_LINE_LOWER: { mean: -2, tolerance: 2, source: "Ricketts 1968" },
  /*
   * ستاينر — موضع وسط الارتفاق.
   *
   * وSNB تُقرأ عند B، وهي نقطةٌ تتأثّر بشكل قمة الارتفاق ودرجة انحداره؛ وSND
   * تُقرأ عند وسطه فتقلّ حساسيّتها لذلك. فتُقرآن معًا لا إحداهما بدل الأخرى.
   */
  SND: { mean: 77, tolerance: 2, source: "Steiner" },
  /*
   * McNamara ١٩٨٤ — أطوالٌ فعلية بالمليمتر لا زوايا.
   *
   * وفائدتها أنها تقول **كم** ينقص الفكّ لا «أهو خلفيّ»: زاويةٌ واحدة قد تخرج
   * سويّةً على فكّين صغيرين معًا، والطول يكشف ذلك.
   *
   * ومعاييرها هنا للبالغين، **وتختلف بالعمر والجنس اختلافًا كبيرًا** — فتُقرأ
   * مع الوجه، وتُصحَّح بمجموعةٍ مرجعية حين تُجمع بيانات المركز.
   */
  MAX_LEN: { mean: 94, tolerance: 5, source: "McNamara 1984 · بالغون", adultOnly: true },
  MAND_LEN: { mean: 122, tolerance: 5, source: "McNamara 1984 · بالغون", adultOnly: true },
  MM_DIFF: { mean: 28, tolerance: 4, source: "McNamara 1984 · بالغون", adultOnly: true },
  A_NPERP: { mean: 0.5, tolerance: 1.5, source: "McNamara 1984 · بالغون", adultOnly: true },
  POG_NPERP: { mean: -2, tolerance: 2, source: "McNamara 1984 · بالغون", adultOnly: true },
  // نسبةٌ لا طول — فتُحسب بلا معايرة، كنسبة Jarabak.
  LAFH: { mean: 55, tolerance: 3, source: "McNamara" },
};

/**
 * اسم التحليل من مرجع المعيار.
 *
 * والقاعدة: **التحليل هو صاحب المعيار الذي يُحكم به**. فما دام `SNA` يُصنَّف
 * بمعيار Steiner فهو من Steiner، ولا يُكتب الاسم مرّةً ثانية بيدٍ قد تخالف
 * المعيار الذي تحته — واسمٌ يخالف معياره أسوأ من لا اسم: يقرأ الطبيب مجموعةً
 * باسم تحليلٍ ويقارنها بجداوله، وحدودُها من جداول غيره.
 *
 * والسنة وما بعد الفاصلة تُقطعان: «Downs 1948» و«Jacobson 1975 · ♂ 1±2» و
 * «McNamara 1984 · بالغون» تصير Downs وJacobson وMcNamara — وهي عناوين تُقرأ
 * لا مراجع تُستشهد، والمرجع كاملًا يبقى في `norm.source` تحت كل قياس.
 */
export function analysisFromSource(source: string): string | null {
  const head = source.split("·")[0].trim();
  const name = head.replace(/\s*\d{4}\s*$/, "").trim();
  return name.length > 0 ? name : null;
}

/**
 * سنّ اكتمال النموّ الهيكلي — وعندها تُطبَّق معايير البالغين.
 *
 * والعمر عندنا من سنة الميلاد وحدها، فهو مضبوطٌ إلى سنة. واخترنا ١٨ لأنّ النموّ
 * الوجهي يكون قد قارب تمامه، ولأنّ الحجب فوق ذلك يمنع الحكم على بالغين فعليّين.
 */
export const ADULT_AGE = 18;

/**
 * عمر المريض يوم الأشعّة — من سنة الميلاد وحدها.
 *
 * والملفّ يحفظ السنة لا التاريخ الكامل، فالعمر مضبوطٌ إلى سنة: من وُلد في
 * ٢٠٠٨ وصُوّر في ٢٠٢٦ عمرُه ١٧ أو ١٨ بحسب شهر ميلاده. ونُعيد **الأكبر**
 * الممكن (١٨) — لأنّ الأصغر يحجب الحكم عن بالغين كثيرين، والفرق عند الحدّ
 * وحده وقد اكتمل النموّ فيه تقريبًا. والسنة المستقبلية أو غير المعقولة تُردّ
 * `null` — رقمٌ فاسد أسوأ من لا رقم.
 *
 * @param onDate تاريخ الأشعّة بصيغة `YYYY-MM-DD` بتوقيت العيادة.
 */
export function ageFromBirthYear(
  birthYear: number | null | undefined,
  onDate: string | null | undefined,
): number | null {
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear)) return null;
  if (birthYear < 1900 || birthYear > 2200) return null;
  const year = Number(String(onDate ?? "").slice(0, 4));
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  const age = year - birthYear;
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * المعيار المنطبق على هذا المريض — أو لا معيار.
 *
 * وحجبُ المعيار ليس نقصًا في التحليل بل شرطُ صدقه: القياس يُعرض بقيمته كاملةً
 * ويُقارَن بدراسةٍ سابقة للمريض نفسه، وإنما يُمنع **الحكم** الذي لا سند له.
 */
export function applicableNorm(
  norm: Norm | null | undefined,
  ageYears: number | null,
): { norm: Norm | null; normNote?: Bilingual } {
  if (!norm) return { norm: null };
  if (!norm.adultOnly) return { norm };
  if (typeof ageYears === "number" && Number.isFinite(ageYears) && ageYears >= ADULT_AGE) {
    return { norm };
  }
  return {
    norm: null,
    normNote: {
      ar: ageYears == null
        ? `معيار ${norm.source} للبالغين، وعمر المريض غير مسجَّل — فلا حكم`
        : `معيار ${norm.source} للبالغين، والمريض في ${Math.floor(ageYears)} سنة — فلا حكم`,
      en: ageYears == null
        ? `${norm.source} norm is for adults and the patient's age is unrecorded — no verdict`
        : `${norm.source} norm is for adults; the patient is ${Math.floor(ageYears)} — no verdict`,
    },
  };
}

/**
 * التصنيف الهيكلي من زاوية ANB.
 *
 * وهو أكثر ما يُقرأ من التحليل كلّه: يقول أين الفك السفلي من العلوي — وعليه
 * ينقسم العلاج إلى مسارات مختلفة تمامًا.
 */
export type SkeletalClass = "I" | "II" | "III";

export const SKELETAL_LABEL: Record<SkeletalClass, Bilingual> = {
  I: { ar: "الصنف الأول — علاقة هيكلية متوازنة", en: "Class I — balanced skeletal relation" },
  II: { ar: "الصنف الثاني — الفك السفلي خلف العلوي", en: "Class II — mandible behind the maxilla" },
  III: { ar: "الصنف الثالث — الفك السفلي أمام العلوي", en: "Class III — mandible ahead of the maxilla" },
};

export function skeletalClass(anb: number): SkeletalClass {
  if (anb > 4) return "II";
  if (anb < 0) return "III";
  return "I";
}

/**
 * النمط العمودي — يُقرأ من انحدار الفك السفلي.
 *
 * والصنف الهيكلي وحده نصف القراءة: مريضان بـANB واحدة أحدهما وجهه طويل مفتوح
 * العضّة والآخر قصيرٌ عميقها، وعلاجهما مختلف. فيُقرأ الانحدار معه.
 */
export type VerticalPattern = "horizontal" | "balanced" | "vertical";

export const VERTICAL_LABEL: Record<VerticalPattern, Bilingual> = {
  horizontal: { ar: "نمطٌ أفقيّ — وجهٌ قصير وزاويةٌ مغلقة", en: "Horizontal pattern — short face, closed angle" },
  balanced: { ar: "نمطٌ متوازن", en: "Balanced pattern" },
  vertical: { ar: "نمطٌ رأسيّ — وجهٌ طويل وزاويةٌ مفتوحة", en: "Vertical pattern — long face, open angle" },
};

/**
 * ويُقرأ من قياسين لا من واحد.
 *
 * FMA وSN-GoGn يقيسان الانحدار من مرجعين مختلفين، واتفاقهما أوثق من انفراد
 * أحدهما. فإن اختلفا لم يُحسم النمط — وقولُ «لم يُحسم» أصدق من ترجيحٍ بلا سبب.
 */
export function verticalPattern(
  fma: number | null, snGoGn: number | null, norms: Record<string, Norm>,
): VerticalPattern | null {
  const readings = [
    fma !== null ? severityOfSide(fma, norms.FMA) : null,
    snGoGn !== null ? severityOfSide(snGoGn, norms.SN_GoGn) : null,
  ].filter((side): side is -1 | 0 | 1 => side !== null);
  if (readings.length === 0) return null;
  if (readings.every((side) => side > 0)) return "vertical";
  if (readings.every((side) => side < 0)) return "horizontal";
  if (readings.every((side) => side === 0)) return "balanced";
  return null;
}

const severityOfSide = (value: number, norm: Norm | undefined): -1 | 0 | 1 | null => {
  const z = zScore(value, norm ?? null);
  if (z === null) return null;
  return z > 1 ? 1 : z < -1 ? -1 : 0;
};

export interface Analysis {
  measurements: Measurement[];
  skeletal: { anb: number; klass: SkeletalClass } | null;
  /** النمط العمودي — أو `null` إن اختلف القياسان أو نقصا. */
  vertical: VerticalPattern | null;
  /** ما نقص من النقاط المطلوبة — فيُقال للطبيب ما يُعلّمه ليكتمل التحليل. */
  missing: LandmarkCode[];
  /** القياسات الطولية معطّلة بلا معايرة — ويُقال ذلك لا يُسكت عنه. */
  calibrated: boolean;
}

/**
 * يبني التحليل من التتبّع.
 *
 * ولا يعطي نصف تحليل بصمت: ما نقصت نقطته لا يُحسب، ويُذكر الناقص باسمه.
 */
export function analyse(input: {
  tracing: Tracing;
  aspect?: number;
  calibration?: Calibration | null;
  /** المعايير المعتمدة — من المجموعة المرجعية. وبلا تمريرها تُستعمل الافتراضية. */
  norms?: Record<string, Norm>;
  /**
   * عمر المريض يوم الأشعّة — تُحجب به معايير البالغين عن وجهٍ ينمو.
   *
   * وغيابُه ليس محايدًا: يُعامَل معاملة «قد يكون طفلًا»، فتُحجب. ومريضٌ بالغ
   * بلا سنة ميلادٍ مسجّلة يخسر خمسة أحكام — وهذا أهون من طفلٍ يُقال عن فكّه
   * إنه ناقص وهو سويٌّ لعمره.
   */
  ageYears?: number | null;
}): Analysis {
  const { tracing } = input;
  const NORMS = { ...DEFAULT_NORMS, ...(input.norms ?? {}) };
  const aspect = input.aspect && input.aspect > 0 ? input.aspect : 1;
  const ageYears = typeof input.ageYears === "number" ? input.ageYears : null;
  const missing = LANDMARKS.filter((item) => item.required && !tracing[item.code])
    .map((item) => item.code);

  const measurements: Measurement[] = [];
  let anb: number | null = null;

  const { S, N, A, B } = tracing;

  if (S && N && A) {
    const value = angleAt(N, S, A, aspect);
    measurements.push({
      key: "SNA", name: "SNA", unit: "deg", value,
      meaning: { ar: "موضع الفك العلوي من قاعدة الجمجمة", en: "Maxillary position relative to the cranial base" },
      norm: NORMS.SNA, verdict: verdictFor(value, NORMS.SNA), from: ["S", "N", "A"],
    });
  }

  if (S && N && B) {
    const value = angleAt(N, S, B, aspect);
    measurements.push({
      key: "SNB", name: "SNB", unit: "deg", value,
      meaning: { ar: "موضع الفك السفلي من قاعدة الجمجمة", en: "Mandibular position relative to the cranial base" },
      norm: NORMS.SNB, verdict: verdictFor(value, NORMS.SNB), from: ["S", "N", "B"],
    });
  }

  /*
   * SND — موضع وسط الارتفاق.
   *
   * وSNB تُقرأ عند B، وهي نقطةٌ تتأثّر بشكل قمة الارتفاق ودرجة انحداره: ذقنٌ
   * بارزةٌ ترفعها وذقنٌ منحسرة تخفضها، والفكّ نفسُه لم يتحرّك. وSND تُقرأ عند
   * **وسط** الارتفاق فتقلّ حساسيّتها لذلك — فتُقرآن معًا لا إحداهما بدل الأخرى.
   */
  if (S && N && tracing.D) {
    const value = angleAt(N, S, tracing.D, aspect);
    measurements.push({
      key: "SND", name: "SND", unit: "deg", value,
      meaning: {
        ar: "موضع وسط الارتفاق من قاعدة الجمجمة — يُقرأ مع SNB لا بدلها",
        en: "Symphysis midpoint relative to the cranial base — read alongside SNB",
      },
      norm: NORMS.SND, verdict: verdictFor(value, NORMS.SND), from: ["S", "N", "D"],
      analysis: "Steiner",
    });
  }

  if (S && N && A && B) {
    // ANB فرقٌ بين زاويتين لا زاوية تُقاس — ولذلك تكون سالبة في الصنف الثالث،
    // وهي إشارةٌ ذات معنى لا خطأ يُلغى بالقيمة المطلقة.
    const value = angleAt(N, S, A, aspect) - angleAt(N, S, B, aspect);
    anb = value;
    measurements.push({
      key: "ANB", name: "ANB", unit: "deg", value,
      meaning: { ar: "العلاقة الهيكلية بين الفكّين — أساس التصنيف", en: "Skeletal relation between the jaws — the basis of classification" },
      norm: NORMS.ANB, verdict: verdictFor(value, NORMS.ANB), from: ["S", "N", "A", "B"],
    });
  }

  /*
   * زوايا المستويات — كل قياس بشعاعيه صراحةً.
   *
   * الشعاع مكتوبٌ في الاستدعاء نفسه لا مستنتَجٌ من ترتيب الوسائط، لأنه **هو**
   * الاصطلاح: عكسُه يقلب الزاوية إلى مكمّلتها فيقلب التشخيص.
   */
  const plane = (input: {
    key: string; name: string; meaning: Bilingual; norm: Norm;
    from: LandmarkCode[]; value: number; analysis?: string;
  }) => {
    measurements.push({
      key: input.key, name: input.name, unit: "deg", value: input.value,
      meaning: input.meaning, norm: input.norm,
      verdict: verdictFor(input.value, input.norm), from: input.from,
      analysis: input.analysis,
    });
  };

  const { Po, Or, Go, Me, Gn, Pog, ANS, U1T, U1A, L1T, L1A, U6, L6, Pn, PogS, LS, LI, Co } = tracing;

  // نمط النمو: كم ينحدر الفك السفلي عن قاعدة الجمجمة. المرتفع وجهٌ طويل مفتوح
  // العضّة، والمنخفض وجهٌ قصير عميق العضّة — ولكلٍّ علاجٌ مختلف.
  if (S && N && Go && Gn) {
    plane({
      key: "SN-GoGn", name: "SN-GoGn", norm: NORMS.SN_GoGn, from: ["S", "N", "Go", "Gn"],
      meaning: { ar: "انحدار الفك السفلي عن قاعدة الجمجمة — نمط النمو", en: "Mandibular inclination to the cranial base — growth pattern" },
      value: lineAngle(S, N, Go, Gn, aspect),
    });
  }

  if (Po && Or && Go && Me) {
    plane({
      key: "FMA", name: "FMA", norm: NORMS.FMA, from: ["Po", "Or", "Go", "Me"],
      meaning: { ar: "انحدار الفك السفلي عن مستوى فرانكفورت", en: "Mandibular plane angle to Frankfort horizontal" },
      value: lineAngle(Po, Or, Go, Me, aspect),
    });
  }

  // ميل القاطع السفلي على مستوى الفك: يزيد بإمالته أمامًا وينقص بانتصابه.
  // والشعاع Me→Go لا Go→Me — وهو ما يجعلها ٩٠ عند العمود لا مكمّلتها.
  if (Go && Me && L1A && L1T) {
    plane({
      key: "IMPA", name: "IMPA", norm: NORMS.IMPA, from: ["Go", "Me", "L1A", "L1T"],
      meaning: { ar: "ميل القاطع السفلي على مستوى الفك السفلي", en: "Lower incisor inclination to the mandibular plane" },
      value: lineAngle(Me, Go, L1A, L1T, aspect),
    });
  }

  // ميل القاطع العلوي: الشعاع N→S لا S→N — والفرق ٧٧° مقابل ١٠٣°.
  if (S && N && U1A && U1T) {
    plane({
      key: "U1-SN", name: "U1-SN", norm: NORMS.U1_SN, from: ["S", "N", "U1A", "U1T"],
      meaning: { ar: "ميل القاطع العلوي على قاعدة الجمجمة", en: "Upper incisor inclination to the cranial base" },
      value: lineAngle(N, S, U1A, U1T, aspect),
    });
  }

  if (N && A && U1A && U1T) {
    plane({
      key: "U1-NA", name: "U1-NA", norm: NORMS.U1_NA, from: ["N", "A", "U1A", "U1T"],
      meaning: { ar: "ميل القاطع العلوي على خط الفك العلوي", en: "Upper incisor inclination to the NA line" },
      value: lineAngle(N, A, U1A, U1T, aspect),
    });
  }

  // والشعاع هنا B→N لا N→B: القاطعان يتّجهان متعاكسَين، فاختلاف الشعاع بينهما
  // ليس تناقضًا في التعريف بل نتيجةٌ له.
  if (N && B && L1A && L1T) {
    plane({
      key: "L1-NB", name: "L1-NB", norm: NORMS.L1_NB, from: ["N", "B", "L1A", "L1T"],
      meaning: { ar: "ميل القاطع السفلي على خط الفك السفلي", en: "Lower incisor inclination to the NB line" },
      value: lineAngle(B, N, L1A, L1T, aspect),
    });
  }

  // الزاوية بين القاطعين: تنقص بإمالتهما أمامًا وتزيد بانتصابهما.
  if (U1A && U1T && L1A && L1T) {
    plane({
      key: "U1-L1", name: "U1-L1", norm: NORMS.INTERINCISAL,
      from: ["U1A", "U1T", "L1A", "L1T"],
      meaning: { ar: "انفتاح القاطعين على بعضهما — تنقص بإمالتهما", en: "Interincisal opening — decreases as incisors procline" },
      value: lineAngle(U1A, U1T, L1A, L1T, aspect),
    });
  }

  // اتجاه النمو: إلى الأمام (أفقي) أم إلى الأسفل (رأسي).
  if (Po && Or && S && Gn) {
    plane({
      key: "Y-Axis", name: "Y-Axis", norm: NORMS.Y_AXIS, from: ["Po", "Or", "S", "Gn"],
      meaning: { ar: "اتجاه النمو — أفقيّ أم رأسيّ", en: "Growth direction — horizontal or vertical" },
      value: lineAngle(Po, Or, S, Gn, aspect),
    });
  }

  /*
   * تحليل تويد — والمثلث يُغلق أو لا يكون.
   *
   * FMA وFMIA وIMPA زوايا مثلثٍ داخلية: مجموعها ١٨٠ بالضرورة الهندسية. وحسابُ
   * الثالثة طرحًا من ١٨٠ يجعل «التحقق» تحصيلَ حاصل — فتُحسب من نقاطها مستقلّةً،
   * ويُشترط في الفحص أن يخرج المجموع ١٨٠. فإن اختلّ فالخلل في اصطلاحٍ لا في تقريب.
   */
  if (Po && Or && L1A && L1T) {
    plane({
      key: "FMIA", name: "FMIA", norm: NORMS.FMIA, from: ["Po", "Or", "L1A", "L1T"],
      analysis: "Tweed",
      meaning: { ar: "زاوية القاطع السفلي مع مستوى فرانكفورت — ضلع مثلث تويد الثالث", en: "Lower incisor to Frankfort — the third side of the Tweed triangle" },
      value: lineAngle(Or, Po, L1T, L1A, aspect),
    });
  }

  /*
   * تحليل داونز — الوجه من فرانكفورت.
   */
  if (Po && Or && N && Pog) {
    plane({
      key: "Facial", name: "Facial angle", norm: NORMS.FACIAL_ANGLE, from: ["Po", "Or", "N", "Pog"],
      analysis: "Downs",
      meaning: { ar: "تقدّم الذقن — المرتفع وجهٌ مستقيم والمنخفض ذقنٌ متراجع", en: "Chin prominence — higher is straighter, lower is a retruded chin" },
      value: lineAngle(Po, Or, Pog, N, aspect),
    });
  }

  // تحدّب الوجه: موجبٌ حين يتراجع الذقن عن امتداد N-A، وسالبٌ حين يتقدّم عليه.
  if (N && A && Pog && S) {
    const magnitude = 180 - angleAt(A, N, Pog, aspect);
    const chinAhead = offsetFromLine(Pog, N, A, S, aspect) > 0;
    plane({
      key: "Convexity", name: "Convexity", norm: NORMS.CONVEXITY, from: ["N", "A", "Pog"],
      analysis: "Downs",
      meaning: { ar: "تحدّب الوجه الهيكلي — موجبٌ إن تراجع الذقن، سالبٌ إن تقدّم", en: "Skeletal convexity — positive when the chin is behind, negative when ahead" },
      value: chinAhead ? -magnitude : magnitude,
    });
  }

  // مستوى A-B مع المستوى الوجهي: سالبٌ في السويّ لأن B خلف الخط.
  if (N && Pog && A && B && S) {
    const magnitude = lineAngle(N, Pog, A, B, aspect);
    const bAhead = offsetFromLine(B, N, Pog, S, aspect) > 0;
    plane({
      key: "AB-plane", name: "A-B plane", norm: NORMS.AB_PLANE, from: ["N", "Pog", "A", "B"],
      analysis: "Downs",
      meaning: { ar: "علاقة القاعدتين بالمستوى الوجهي — سالبةٌ في السويّ", en: "Apical bases against the facial plane — negative in the normal face" },
      value: bAhead ? magnitude : -magnitude,
    });
  }

  /*
   * مستوى الإطباق الوظيفي — ومنه Wits.
   *
   * ولا يُؤخذ من حوافّ القواطع وحدها: مستوى Jacobson الوظيفي يمرّ بمنتصف تراكب
   * القواطع ومنتصف تراكب الأرحاء، فيتبع العضّة كما هي لا كما تبدو من الأمام.
   */
  const midOf = (first: TracedPoint, second: TracedPoint) =>
    ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
  const occlusal = U1T && L1T && U6 && L6
    ? { front: midOf(U1T, L1T), back: midOf(U6, L6) } : null;

  if (occlusal && S && N) {
    plane({
      key: "OccP-SN", name: "OccP-SN", norm: NORMS.OCC_SN, from: ["S", "N", "U1T", "L1T", "U6", "L6"],
      analysis: "Steiner",
      meaning: { ar: "ميل مستوى الإطباق عن قاعدة الجمجمة", en: "Occlusal plane inclination to the cranial base" },
      value: lineAngle(S, N, occlusal.back, occlusal.front, aspect),
    });
  }

  /*
   * النسب — تُحسب بلا معايرة.
   *
   * المقياس يسقط بالقسمة: نسبةُ ارتفاعٍ إلى ارتفاع هي هي، صُوّرت الأشعة بتكبير
   * عشرة في المئة أو عشرين. فالنسبة تصحّ حيث يمتنع الطول — وهذا ليس تحايلًا على
   * المعايرة بل خاصّةٌ في النسبة نفسها.
   */
  if (S && Go && N && Me) {
    const posterior = distanceBetween(S, Go, aspect);
    const anterior = distanceBetween(N, Me, aspect);
    if (anterior > 0) {
      const value = (posterior / anterior) * 100;
      measurements.push({
        key: "Jarabak", name: "Jarabak %", unit: "ratio", value,
        meaning: {
          ar: "نسبة الارتفاع الخلفي إلى الأمامي — نمط النمو: أقلّ من ٦٢ رأسيّ، وأكثر من ٦٥ أفقيّ",
          en: "Posterior-to-anterior facial height — growth pattern: below 62 vertical, above 65 horizontal",
        },
        norm: NORMS.JARABAK, verdict: verdictFor(value, NORMS.JARABAK),
        from: ["S", "Go", "N", "Me"],
      });
    }
  }

  /*
   * نسبة McNamara للارتفاع الوجهي الأمامي السفلي — ANS-Me من N-Me.
   *
   * **وتُحسب بلا معايرة** كنسبة Jarabak: المقياس يسقط بالقسمة. والمستودع المصغّر
   * يحوّل الطولين إلى مليمترات ثم يقسمهما، فتمتنع نسبتُه بلا معايرة بلا سبب —
   * والنسبة لا تحتاج مليمترًا لتصحّ.
   */
  if (N && ANS && Me) {
    const total = distanceBetween(N, Me, aspect);
    const lower = distanceBetween(ANS, Me, aspect);
    if (total > 0) {
      const value = (lower / total) * 100;
      measurements.push({
        key: "LAFH", name: "LAFH %", unit: "ratio", value,
        meaning: {
          ar: "نسبة الارتفاع الوجهي الأمامي السفلي من الكلّي — يُقرأ مع النمط العمودي",
          en: "Lower anterior facial height as a share of the total — read with the vertical pattern",
        },
        norm: NORMS.LAFH, verdict: verdictFor(value, NORMS.LAFH),
        from: ["N", "ANS", "Me"],
        analysis: "McNamara",
      });
    }
  }

  /*
   * القياسات الطولية — ولا واحد منها بلا معايرة.
   *
   * لا يُعرض الطول بالبكسل ولا بأيّ وحدةٍ أخرى حين تغيب المعايرة: رقمٌ بلا وحدة
   * يُقرأ كأنه مليمترات ويُبنى عليه قرار. فإمّا مليمترٌ صحيح أو لا شيء.
   */
  const scale = input.calibration ? millimetresPerUnit(input.calibration, aspect) : null;

  if (scale) {
    const mm = (input: {
      key: string; name: string; meaning: Bilingual; norm: Norm | null;
      from: LandmarkCode[]; value: number; analysis?: string;
    }) => {
      const value = input.value * scale;
      // المعيار يمرّ بالعمر قبل أن يصير حكمًا — ولا يُبنى الحكم إلّا مما بقي.
      const { norm, normNote } = applicableNorm(input.norm, ageYears);
      measurements.push({
        key: input.key, name: input.name, unit: "mm", value,
        meaning: input.meaning, norm,
        verdict: norm ? verdictFor(value, norm) : null,
        from: input.from,
        analysis: input.analysis,
        normNote,
      });
    };

    // بروز القاطع العلوي عن خط NA — موجبٌ أمامه، سالبٌ خلفه، والجهة من S لا من الصورة.
    if (N && A && U1T && S) {
      mm({
        key: "U1-NA-mm", name: "U1-NA (mm)", norm: NORMS.U1_NA_MM, from: ["N", "A", "U1T"],
        meaning: { ar: "بروز حافة القاطع العلوي أمام خط NA", en: "Upper incisor edge ahead of the NA line" },
        value: offsetFromLine(U1T, N, A, S, aspect),
      });
    }

    if (N && B && L1T && S) {
      mm({
        key: "L1-NB-mm", name: "L1-NB (mm)", norm: NORMS.L1_NB_MM, from: ["N", "B", "L1T"],
        meaning: { ar: "بروز حافة القاطع السفلي أمام خط NB", en: "Lower incisor edge ahead of the NB line" },
        value: offsetFromLine(L1T, N, B, S, aspect),
      });
    }

    // بروز الذقن: يُقرأ مع L1-NB — تقاربهما هو توازن الوجه السفلي.
    if (N && B && Pog && S) {
      mm({
        key: "Pog-NB-mm", name: "Pog-NB (mm)", norm: NORMS.POG_NB_MM, from: ["N", "B", "Pog"],
        meaning: { ar: "بروز الذقن أمام خط NB — يُقرأ مع بروز القاطع السفلي", en: "Chin prominence ahead of the NB line — read with the lower incisor" },
        value: offsetFromLine(Pog, N, B, S, aspect),
      });
    }

    /*
     * تقييم Wits — تقدّم القاعدتين مقيسًا على مستوى الإطباق لا على قاعدة الجمجمة.
     *
     * وهو يُقرأ حيث تكذب ANB: زاويةٌ رأسها عند الناسيون تتأثّر بارتفاع الناسيون
     * نفسه وبدوران الفكّين معًا، فيخرج الصنف الثاني «سويًّا» على الورق. وWits
     * يتجاوز الناسيون كلّه: يُسقط A وB على مستوى العضّة ويقيس ما بينهما عليه.
     *
     * والاتجاه من التشريح: مقدّم المستوى حيث القواطع، ومؤخّره حيث الأرحاء —
     * فتخرج الإشارة موجبةً في الصنف الثاني وسالبةً في الثالث، على الصورتين معًا.
     */
    if (occlusal && A && B) {
      const line = orientedForward(occlusal.back, occlusal.front, occlusal.front, occlusal.back, aspect);
      mm({
        key: "Wits", name: "Wits", norm: NORMS.WITS, from: ["A", "B", "U1T", "L1T", "U6", "L6"],
        analysis: "Wits",
        meaning: { ar: "تقدّم قاعدة الفك العلوي على السفلي على مستوى الإطباق — يُقرأ حيث تُضلّل ANB", en: "Maxillary over mandibular base along the occlusal plane — read where ANB misleads" },
        value: projectedGap(A, B, line.from, line.to, aspect),
      });
    }

    /*
     * الخط الجمالي — بروز الشفتين عن خط الأنف والذقن.
     *
     * والسالب هو السويّ: الشفتان **خلف** الخط بمليمترات. وهذا ممّا لا يُقرأ من
     * الهيكل: مريضٌ سويّ الزوايا قد يكون بروفايله متحدّبًا، وهو ما يراه المريض في
     * المرآة ويأتي من أجله.
     */
    if (Pn && PogS && S) {
      if (LS) {
        mm({
          key: "E-LS", name: "E-line · LS", norm: NORMS.E_LINE_UPPER, from: ["Pn", "PogS", "LS"],
          analysis: "Ricketts",
          meaning: { ar: "الشفة العليا عن الخط الجمالي — السالب خلفه وهو السويّ", en: "Upper lip to the aesthetic line — negative is behind it, and normal" },
          value: offsetFromLine(LS, Pn, PogS, S, aspect),
        });
      }
      if (LI) {
        mm({
          key: "E-LI", name: "E-line · LI", norm: NORMS.E_LINE_LOWER, from: ["Pn", "PogS", "LI"],
          analysis: "Ricketts",
          meaning: { ar: "الشفة السفلى عن الخط الجمالي", en: "Lower lip to the aesthetic line" },
          value: offsetFromLine(LI, Pn, PogS, S, aspect),
        });
      }
    }

    /*
     * McNamara ١٩٨٤ — أطوالٌ فعلية لا زوايا.
     *
     * وفائدتها أنها تقول **كم** ينقص الفكّ لا «أهو خلفيّ»: ANB سويّةٌ على فكّين
     * صغيرين معًا، وعلى فكّين كبيرين معًا — والزاوية لا تفرّق، والطول يفرّق.
     * وعليها يُبنى قرار الجراحة الفكّية أو الانتظار للنموّ.
     */
    if (Co && A) {
      mm({
        key: "Co-A", name: "Co-A", norm: NORMS.MAX_LEN, from: ["Co", "A"],
        analysis: "McNamara",
        meaning: { ar: "الطول الفعلي للفك العلوي", en: "Effective maxillary length" },
        value: distanceBetween(Co, A, aspect),
      });
    }

    if (Co && Gn) {
      mm({
        key: "Co-Gn", name: "Co-Gn", norm: NORMS.MAND_LEN, from: ["Co", "Gn"],
        analysis: "McNamara",
        meaning: { ar: "الطول الفعلي للفك السفلي", en: "Effective mandibular length" },
        value: distanceBetween(Co, Gn, aspect),
      });
    }

    if (Co && A && Gn) {
      mm({
        key: "MM-diff", name: "Co-Gn − Co-A", norm: NORMS.MM_DIFF, from: ["Co", "A", "Gn"],
        analysis: "McNamara",
        meaning: {
          ar: "الفرق الفعلي بين الفكّين — يُقرأ مع الطولين لا وحده",
          en: "Maxillomandibular differential — read with both lengths, not alone",
        },
        value: distanceBetween(Co, Gn, aspect) - distanceBetween(Co, A, aspect),
      });
    }

    /*
     * عمود N على مستوى فرانكفورت — وموجبُه الأمام.
     *
     * **والاتجاه من التشريح لا من محور الصورة**: تُبنى نقطةٌ على العمود ثم يُقاس
     * الجانب بالنسبة إلى Po، وPo خلفيّةٌ بالتعريف — فالجهة المقابلة لها هي الأمام
     * على الصورة اليمينية واليسارية معًا.
     *
     * وهذا بالضبط ما رأيتُه معطوبًا في المستودع المصغّر: دالّته تثبّت الإشارة على
     * محور الصورة، فتخرج قياساتُه معكوسةً على كل أشعّةٍ يواجه فيها الوجه اليسار.
     */
    if (N && Po && Or) {
      const fh = { x: (Or.x - Po.x) * aspect, y: -(Or.y - Po.y) };
      const span = Math.hypot(fh.x, fh.y);
      if (span > 0) {
        // عمودٌ على فرانكفورت مارٌّ بـN — نقطةٌ ثانية عليه تكفي لتعريف الخط.
        const anchor: TracedPoint = {
          x: N.x + (-fh.y / span) * 0.2 / aspect,
          y: N.y - (fh.x / span) * 0.2,
        };
        if (A) {
          mm({
            key: "A-NPerp", name: "A–N⊥", norm: NORMS.A_NPERP, from: ["N", "Po", "Or", "A"],
            analysis: "McNamara",
            meaning: { ar: "بُعد A عن عمود N — الموجب أمامه", en: "A to N-perpendicular — positive is anterior" },
            value: offsetFromLine(A, N, anchor, Po, aspect),
          });
        }
        if (Pog) {
          mm({
            key: "Pog-NPerp", name: "Pog–N⊥", norm: NORMS.POG_NPERP, from: ["N", "Po", "Or", "Pog"],
            analysis: "McNamara",
            meaning: { ar: "بُعد الذقن عن عمود N — الموجب أمامه", en: "Pog to N-perpendicular — positive is anterior" },
            value: offsetFromLine(Pog, N, anchor, Po, aspect),
          });
        }
      }
    }

    // الارتفاعات: تُعرض بلا حكم — معيارها يختلف بالعمر والجنس، ولا معيار واحد لها.
    if (N && Me) {
      mm({
        key: "N-Me", name: "N-Me", norm: null, from: ["N", "Me"],
        meaning: { ar: "ارتفاع الوجه الأمامي الكلّي — يختلف بالعمر والجنس، فيُقرأ ولا يُصنَّف", en: "Total anterior facial height — varies with age and sex, so read not graded" },
        value: distanceBetween(N, Me, aspect),
      });
    }

    if (ANS && Me) {
      mm({
        key: "ANS-Me", name: "ANS-Me", norm: null, from: ["ANS", "Me"],
        meaning: { ar: "ارتفاع الوجه الأمامي السفلي", en: "Lower anterior facial height" },
        value: distanceBetween(ANS, Me, aspect),
      });
    }

    if (S && Go) {
      mm({
        key: "S-Go", name: "S-Go", norm: null, from: ["S", "Go"],
        meaning: { ar: "ارتفاع الوجه الخلفي", en: "Posterior facial height" },
        value: distanceBetween(S, Go, aspect),
      });
    }
  }

  /*
   * التسمية في موضعٍ واحد بعد بناء القياسات كلّها.
   *
   * وكانت ثمانيةٌ من ثلاثةٍ وثلاثين مسمّاةً وحدها، والباقي — ومنه SNA وSNB
   * وANB وFMA وIMPA — يخرج على الشاشة والورقة في مجموعةٍ بلا عنوان. فالطبيب
   * يقرأ Steiner متفرّقًا بين مجموعتين ولا يراه مجموعةً كما في مراجعه.
   *
   * والاسم يُشتقّ من مرجع المعيار لا يُكتب بيد: فما يُصنَّف بمعيار Steiner هو
   * من Steiner بالضرورة. ومعيارٌ حُجب لعمر المريض لا يُسمّى منه — ولذلك تحمل
   * قياسات McNamara اسمها صريحًا عند بنائها، فلا تفقد عنوانها حين يُحجب
   * حكمُها عن طفل.
   */
  for (const item of measurements) {
    if (item.analysis || !item.norm) continue;
    const name = analysisFromSource(item.norm.source);
    if (name) item.analysis = name;
  }

  const valueOf = (key: string) => measurements.find((item) => item.key === key)?.value ?? null;

  return {
    measurements,
    skeletal: anb === null ? null : { anb, klass: skeletalClass(anb) },
    vertical: verticalPattern(valueOf("FMA"), valueOf("SN-GoGn"), NORMS),
    missing,
    calibrated: Boolean(scale),
  };
}

/**
 * صياغة الرقم للعرض — بمنزلة عشرية واحدة، ووحدةٍ تتبع لغة الشاشة.
 *
 * وكانت «مم» مكتوبةً في الكود بالعربية وحدها، فتظهر عربيةً في الشاشة الإنجليزية.
 */
export function formatMeasurement(value: number, unit: Unit, lang: Lang = "ar"): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = value.toFixed(1);
  if (unit === "deg") return `${rounded}°`;
  if (unit === "ratio") return `${rounded}%`;
  return `${rounded} ${lang === "ar" ? "مم" : "mm"}`;
}


/** الاسم القديم مُبقًى: الافتراضُ هو المعيار حين لا تُمرَّر مجموعة. */
export const NORMS = DEFAULT_NORMS;


/**
 * أسماء المعايير للعرض في شاشة الإدارة.
 *
 * ومفتاحُ المعيار غير اسم القياس: `SN_GoGn` مفتاحٌ في القاعدة، و`SN-GoGn` اسمٌ
 * على الشاشة. وجمعُهما هنا يمنع أن يُكتب الاسم مرّتين فيختلفا.
 */
export const NORM_LABEL: Record<string, { name: string; unit: Unit; meaning: Bilingual }> = {
  SNA: { name: "SNA", unit: "deg", meaning: { ar: "موضع الفك العلوي", en: "Maxillary position" } },
  SNB: { name: "SNB", unit: "deg", meaning: { ar: "موضع الفك السفلي", en: "Mandibular position" } },
  ANB: { name: "ANB", unit: "deg", meaning: { ar: "العلاقة بين الفكّين", en: "Inter-jaw relation" } },
  SN_GoGn: { name: "SN-GoGn", unit: "deg", meaning: { ar: "انحدار الفك السفلي", en: "Mandibular plane angle" } },
  FMA: { name: "FMA", unit: "deg", meaning: { ar: "انحدار الفك عن فرانكفورت", en: "Mandibular plane to Frankfort" } },
  IMPA: { name: "IMPA", unit: "deg", meaning: { ar: "ميل القاطع السفلي", en: "Lower incisor inclination" } },
  U1_SN: { name: "U1-SN", unit: "deg", meaning: { ar: "ميل القاطع العلوي عن SN", en: "Upper incisor to SN" } },
  U1_NA: { name: "U1-NA", unit: "deg", meaning: { ar: "ميل القاطع العلوي عن NA", en: "Upper incisor to NA" } },
  L1_NB: { name: "L1-NB", unit: "deg", meaning: { ar: "ميل القاطع السفلي عن NB", en: "Lower incisor to NB" } },
  INTERINCISAL: { name: "U1-L1", unit: "deg", meaning: { ar: "الزاوية بين القاطعين", en: "Interincisal angle" } },
  Y_AXIS: { name: "Y-Axis", unit: "deg", meaning: { ar: "اتجاه النمو", en: "Growth direction" } },
  U1_NA_MM: { name: "U1-NA (mm)", unit: "mm", meaning: { ar: "بروز القاطع العلوي", en: "Upper incisor prominence" } },
  L1_NB_MM: { name: "L1-NB (mm)", unit: "mm", meaning: { ar: "بروز القاطع السفلي", en: "Lower incisor prominence" } },
  POG_NB_MM: { name: "Pog-NB (mm)", unit: "mm", meaning: { ar: "بروز الذقن", en: "Chin prominence" } },
  JARABAK: { name: "Jarabak %", unit: "ratio", meaning: { ar: "نمط النمو", en: "Growth pattern" } },
  FMIA: { name: "FMIA", unit: "deg", meaning: { ar: "القاطع السفلي مع فرانكفورت", en: "Lower incisor to Frankfort" } },
  WITS: { name: "Wits", unit: "mm", meaning: { ar: "تقدّم القاعدتين على مستوى الإطباق", en: "Apical bases on the occlusal plane" } },
  OCC_SN: { name: "OccP-SN", unit: "deg", meaning: { ar: "ميل مستوى الإطباق", en: "Occlusal plane inclination" } },
  FACIAL_ANGLE: { name: "Facial angle", unit: "deg", meaning: { ar: "تقدّم الذقن", en: "Chin prominence" } },
  CONVEXITY: { name: "Convexity", unit: "deg", meaning: { ar: "تحدّب الوجه", en: "Facial convexity" } },
  AB_PLANE: { name: "A-B plane", unit: "deg", meaning: { ar: "القاعدتان مع المستوى الوجهي", en: "Apical bases to the facial plane" } },
  E_LINE_UPPER: { name: "E-line · LS", unit: "mm", meaning: { ar: "الشفة العليا عن الخط الجمالي", en: "Upper lip to the aesthetic line" } },
  E_LINE_LOWER: { name: "E-line · LI", unit: "mm", meaning: { ar: "الشفة السفلى عن الخط الجمالي", en: "Lower lip to the aesthetic line" } },
  SND: { name: "SND", unit: "deg", meaning: { ar: "موضع وسط الارتفاق", en: "Symphysis midpoint position" } },
  MAX_LEN: { name: "Co-A", unit: "mm", meaning: { ar: "الطول الفعلي للفك العلوي", en: "Effective maxillary length" } },
  MAND_LEN: { name: "Co-Gn", unit: "mm", meaning: { ar: "الطول الفعلي للفك السفلي", en: "Effective mandibular length" } },
  MM_DIFF: { name: "Co-Gn − Co-A", unit: "mm", meaning: { ar: "الفرق الفعلي بين الفكّين", en: "Maxillomandibular differential" } },
  A_NPERP: { name: "A–N⊥", unit: "mm", meaning: { ar: "بُعد A عن عمود N", en: "A to N-perpendicular" } },
  POG_NPERP: { name: "Pog–N⊥", unit: "mm", meaning: { ar: "بُعد الذقن عن عمود N", en: "Pog to N-perpendicular" } },
  LAFH: { name: "LAFH %", unit: "ratio", meaning: { ar: "نسبة الارتفاع الوجهي الأمامي السفلي", en: "Lower anterior facial height ratio" } },
};


/* ─────────────────────── المستويات المرجعية للرسم ─────────────────────── */

export interface ReferenceLine {
  key: string;
  name: Bilingual;
  from: TracedPoint;
  to: TracedPoint;
}

/**
 * الخطوط التي تُرسم على الصورة في التقرير.
 *
 * وهي **توصيل نقاطٍ لا تتبّعٌ تشريحي**: لا تُرسم حدود العظم ولا ظلّ الأنسجة الرخوة،
 * بل المستويات التي تُبنى عليها الزوايا. والفرق يُقال في التقرير صراحةً — فادّعاء
 * «تتبّعٍ كامل» على رسمٍ من ثمانية خطوط أكبر من الحقيقة.
 *
 * ولا يُرسم خطٌّ نقطتاه غير موضوعتين: خطٌّ ناقص يوحي بقياسٍ لم يُحسب.
 */
export function referenceLines(tracing: Tracing): ReferenceLine[] {
  const { S, N, A, B, Po, Or, Go, Me, Pog, U1A, U1T, L1A, L1T, U6, L6, Pn, PogS, ANS, PNS } = tracing;
  const mid = (first: TracedPoint, second: TracedPoint) =>
    ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });

  const lines: (ReferenceLine | null)[] = [
    S && N ? { key: "SN", name: { ar: "قاعدة الجمجمة SN", en: "Cranial base SN" }, from: S, to: N } : null,
    Po && Or ? { key: "FH", name: { ar: "مستوى فرانكفورت", en: "Frankfort horizontal" }, from: Po, to: Or } : null,
    ANS && PNS ? { key: "PP", name: { ar: "مستوى الحنك", en: "Palatal plane" }, from: ANS, to: PNS } : null,
    Go && Me ? { key: "MP", name: { ar: "مستوى الفك السفلي", en: "Mandibular plane" }, from: Go, to: Me } : null,
    N && Pog ? { key: "FP", name: { ar: "المستوى الوجهي", en: "Facial plane" }, from: N, to: Pog } : null,
    N && A ? { key: "NA", name: { ar: "خط NA", en: "NA line" }, from: N, to: A } : null,
    N && B ? { key: "NB", name: { ar: "خط NB", en: "NB line" }, from: N, to: B } : null,
    U1A && U1T ? { key: "U1", name: { ar: "محور القاطع العلوي", en: "Upper incisor axis" }, from: U1A, to: U1T } : null,
    L1A && L1T ? { key: "L1", name: { ar: "محور القاطع السفلي", en: "Lower incisor axis" }, from: L1A, to: L1T } : null,
    U1T && L1T && U6 && L6
      ? { key: "OccP", name: { ar: "مستوى الإطباق الوظيفي", en: "Functional occlusal plane" },
          from: mid(U6, L6), to: mid(U1T, L1T) } : null,
    Pn && PogS ? { key: "E", name: { ar: "الخط الجمالي", en: "Aesthetic E-line" }, from: Pn, to: PogS } : null,
  ];
  return lines.filter((line): line is ReferenceLine => line !== null);
}

/** فرق القياس عن معياره — يُقرأ مع القيمة لا بدلها. */
export function deviation(value: number, norm: Norm | null): number | null {
  return norm ? value - norm.mean : null;
}
