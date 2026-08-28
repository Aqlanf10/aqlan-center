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
 * والاصطلاح يختلف بين مدرسةٍ وأخرى، وخطأٌ فيه يقلب ٣٥° إلى ١٤٥° — فيُقلب معه
 * التشخيص. ولأن من يقرأ هذه الأرقام أخصائي يبني عليها علاجَ سنتين، لم أكتب ما لم
 * أتحقّق من اصطلاحه: تبدأ الوحدة بما لا لبس فيه، ويُضاف الباقي بعد أن يقابله
 * المالك بمخرجات WebCeph على حالةٍ حقيقية فيثبت الاصطلاح.
 */

/* ─────────────────────────── النقاط التشريحية ─────────────────────────── */

export type LandmarkCode =
  | "S" | "N" | "A" | "B" | "Po" | "Or" | "Go" | "Me" | "Gn" | "Pog"
  | "ANS" | "PNS" | "U1T" | "U1A" | "L1T" | "L1A" | "Ar" | "Ba";

export interface LandmarkDefinition {
  code: LandmarkCode;
  name: string;
  hint: string;
  /** مطلوبة للتحليل الحالي — وما عداها يُعلَّم للمستقبل والعرض. */
  required: boolean;
}

export const LANDMARKS: LandmarkDefinition[] = [
  { code: "S", name: "السِّرج", hint: "مركز السرج التركي — منتصف التجويف", required: true },
  { code: "N", name: "الناسيون", hint: "أمامي درز الجبهة والأنف", required: true },
  { code: "A", name: "النقطة A", hint: "أعمق نقطة في مقعّر الفك العلوي الأمامي", required: true },
  { code: "B", name: "النقطة B", hint: "أعمق نقطة في مقعّر الفك السفلي الأمامي", required: true },
  { code: "Po", name: "البوريون", hint: "أعلى الصماخ السمعي الظاهر", required: false },
  { code: "Or", name: "الأوربيتال", hint: "أسفل حافة الحجاج", required: false },
  { code: "Go", name: "الغونيون", hint: "منتصف زاوية الفك السفلي", required: false },
  { code: "Me", name: "المنتون", hint: "أسفل نقطة في ارتفاق الذقن", required: false },
  { code: "Gn", name: "الغناثيون", hint: "أمامي-أسفل نقطة في الذقن", required: false },
  { code: "Pog", name: "البوغونيون", hint: "أبرز نقطة في الذقن أمامًا", required: false },
  { code: "ANS", name: "الشوكة الأنفية الأمامية", hint: "طرف الشوكة الأمامي", required: false },
  { code: "PNS", name: "الشوكة الأنفية الخلفية", hint: "طرف الشوكة الخلفي", required: false },
  { code: "U1T", name: "حافة القاطع العلوي", hint: "الحافة القاطعة للثنية العلوية", required: false },
  { code: "U1A", name: "ذروة جذر القاطع العلوي", hint: "قمة الجذر", required: false },
  { code: "L1T", name: "حافة القاطع السفلي", hint: "الحافة القاطعة للثنية السفلية", required: false },
  { code: "L1A", name: "ذروة جذر القاطع السفلي", hint: "قمة الجذر", required: false },
  { code: "Ar", name: "الأرتيكولار", hint: "تقاطع ظل القاعدة مع عنق اللقمة", required: false },
  { code: "Ba", name: "الباسيون", hint: "أمامي-أسفل الثقبة العظمى", required: false },
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

/** المسافة بين نقطتين بوحدات الصورة النسبية — تُحوَّل إلى مليمترات بالمعايرة. */
export function distanceBetween(a: TracedPoint, b: TracedPoint, aspect = 1): number {
  return norm(subtract(toAnalysis(a, aspect), toAnalysis(b, aspect)));
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
}

export interface Measurement {
  key: string;
  name: string;
  /** ما يعنيه القياس سريريًّا — لا تعريفه الهندسي. */
  meaning: string;
  unit: "deg" | "mm";
  value: number;
  norm: Norm;
  verdict: Verdict;
  /** النقاط التي بُني عليها — فيُعرف أيّها يُراجَع إن بدا الرقم غريبًا. */
  from: LandmarkCode[];
}

export function verdictFor(value: number, norm: Norm): Verdict {
  if (value < norm.mean - norm.tolerance) return "low";
  if (value > norm.mean + norm.tolerance) return "high";
  return "normal";
}

export const NORMS: Record<string, Norm> = {
  // المعايير القوقازية لستاينر، وهي الأوسع استعمالًا في التقويم السريري.
  // وليست مطلقة: تختلف بالعرق والجنس والعمر — ولذلك يُذكر المرجع ويُقرأ الرقم
  // مع الوجه لا وحده.
  SNA: { mean: 82, tolerance: 2, source: "Steiner" },
  SNB: { mean: 80, tolerance: 2, source: "Steiner" },
  ANB: { mean: 2, tolerance: 2, source: "Steiner" },
};

/**
 * التصنيف الهيكلي من زاوية ANB.
 *
 * وهو أكثر ما يُقرأ من التحليل كلّه: يقول أين الفك السفلي من العلوي — وعليه
 * ينقسم العلاج إلى مسارات مختلفة تمامًا.
 */
export type SkeletalClass = "I" | "II" | "III";

export const SKELETAL_LABEL: Record<SkeletalClass, string> = {
  I: "الصنف الأول — علاقة هيكلية متوازنة",
  II: "الصنف الثاني — الفك السفلي خلف العلوي",
  III: "الصنف الثالث — الفك السفلي أمام العلوي",
};

export function skeletalClass(anb: number): SkeletalClass {
  if (anb > 4) return "II";
  if (anb < 0) return "III";
  return "I";
}

export interface Analysis {
  measurements: Measurement[];
  skeletal: { anb: number; klass: SkeletalClass; label: string } | null;
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
}): Analysis {
  const { tracing } = input;
  const aspect = input.aspect && input.aspect > 0 ? input.aspect : 1;
  const missing = LANDMARKS.filter((item) => item.required && !tracing[item.code])
    .map((item) => item.code);

  const measurements: Measurement[] = [];
  let anb: number | null = null;

  const { S, N, A, B } = tracing;

  if (S && N && A) {
    const value = angleAt(N, S, A, aspect);
    measurements.push({
      key: "SNA", name: "SNA", unit: "deg", value,
      meaning: "موضع الفك العلوي من قاعدة الجمجمة",
      norm: NORMS.SNA, verdict: verdictFor(value, NORMS.SNA), from: ["S", "N", "A"],
    });
  }

  if (S && N && B) {
    const value = angleAt(N, S, B, aspect);
    measurements.push({
      key: "SNB", name: "SNB", unit: "deg", value,
      meaning: "موضع الفك السفلي من قاعدة الجمجمة",
      norm: NORMS.SNB, verdict: verdictFor(value, NORMS.SNB), from: ["S", "N", "B"],
    });
  }

  if (S && N && A && B) {
    // ANB فرقٌ بين زاويتين لا زاوية تُقاس — ولذلك تكون سالبة في الصنف الثالث،
    // وهي إشارةٌ ذات معنى لا خطأ يُلغى بالقيمة المطلقة.
    const value = angleAt(N, S, A, aspect) - angleAt(N, S, B, aspect);
    anb = value;
    measurements.push({
      key: "ANB", name: "ANB", unit: "deg", value,
      meaning: "العلاقة الهيكلية بين الفكّين — أساس التصنيف",
      norm: NORMS.ANB, verdict: verdictFor(value, NORMS.ANB), from: ["S", "N", "A", "B"],
    });
  }

  return {
    measurements,
    skeletal: anb === null ? null : {
      anb,
      klass: skeletalClass(anb),
      label: SKELETAL_LABEL[skeletalClass(anb)],
    },
    missing,
    calibrated: Boolean(input.calibration && millimetresPerUnit(input.calibration, aspect)),
  };
}

/** صياغة الرقم للعرض — درجةٌ بمنزلة عشرية واحدة، والمليمتر كذلك. */
export function formatMeasurement(value: number, unit: "deg" | "mm"): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = value.toFixed(1);
  return unit === "deg" ? `${rounded}°` : `${rounded} مم`;
}
