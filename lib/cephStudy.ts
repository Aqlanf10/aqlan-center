import type { Calibration, Tracing } from "./ceph";

/**
 * الدراسة السيفالومترية — الوثيقة التي تُبنى على التتبّع.
 *
 * التتبّع سطحُ عمل: نقاطٌ تُوضع وتُصحَّح على صورة. والدراسة **وثيقةٌ سريرية**
 * لها موضعٌ في زمن العلاج: أهي أشعّة ما قبل العلاج التي بُنيت عليها الخطة؟ أم
 * أشعّةُ منتصفٍ تُقاس بها الاستجابة؟ أم أشعّةُ نهايةٍ يُوقَّع بها الإنجاز؟
 * وسؤالُ الطبيب بعد سنتين ليس «أين النقاط» بل **«ما الذي كان صحيحًا يوم قرّرت»**.
 *
 * ولذلك القاعدة الحاكمة هنا واحدة:
 *
 *   **الدراسة المعتمدة لا تتغيّر تحت من اعتمدها.**
 *
 * وقبل هذا الكيان كان التتبّع صفًّا واحدًا لكل صورة يُكتب فوقه: من يصحّح نقطةً
 * اليوم يغيّر — بأثرٍ رجعي وبلا أثرٍ في السجل — الأرقامَ التي بُنيت عليها خطّةُ
 * علاجٍ قبل سنة. والخطّة تبقى، والأرقام التي بُرِّرت بها تصير أرقامًا أخرى.
 *
 * ### ما يُجمَّد: المعالم لا الزوايا
 *
 * اللقطة تحفظ **مواضع النقاط والمعايرة**، ثم تُشتقّ منها القياسات عند كل قراءة —
 * كما تُشتقّ القيود من المستندات والرصيد من الحركات. وتجميدُ الزوايا نفسها يعني
 * رقمين لحقيقةٍ واحدة: واحدٌ محفوظ وآخر يُحسب، ويومَ يُصحَّح خللٌ في معادلةٍ لا
 * يُصحَّح المحفوظ — فيبقى في الملف رقمٌ يعرف الجميع أنه خطأ ولا أحد يجرؤ على مسّه.
 */

/** موضع الدراسة من زمن العلاج. */
export type StudyPhase = "pre" | "mid" | "post" | "followup";

export const STUDY_PHASE_LABEL: Record<StudyPhase, string> = {
  pre: "ما قبل العلاج",
  mid: "أثناء العلاج",
  post: "ما بعد العلاج",
  followup: "متابعة",
};

export const STUDY_PHASE_ORDER: StudyPhase[] = ["pre", "mid", "post", "followup"];

export function isStudyPhase(value: unknown): value is StudyPhase {
  return typeof value === "string" && value in STUDY_PHASE_LABEL;
}

/**
 * حالة الدراسة.
 *
 * ثلاثٌ تكفي: مسودّةٌ تُعمل عليها، ومعتمدةٌ يُبنى عليها، ومؤرشفةٌ أُبطلت ولم
 * تُمحَ. ولا «قيد المراجعة» ولا «مرفوضة» — عيادةٌ فيها طبيبٌ واحد يعتمد، وحالاتٌ
 * لا يمرّ بها أحد تُصيّر الشاشة نموذجًا إداريًّا لا أداة عمل.
 */
export type StudyStatus = "draft" | "approved" | "archived";

export const STUDY_STATUS_LABEL: Record<StudyStatus, string> = {
  draft: "مسودّة",
  approved: "معتمدة",
  archived: "مؤرشفة",
};

export function isStudyStatus(value: unknown): value is StudyStatus {
  return typeof value === "string" && value in STUDY_STATUS_LABEL;
}

/**
 * ما يجوز من انتقالٍ إلى ماذا.
 *
 * والمعتمدة **لا تعود مسودّة**: من يريد تغييرها يُنشئ إصدارًا جديدًا، فيبقى في
 * الملف ما اعتُمد ومتى ومَن — وما صار بعده. وإرجاعُها مسودّةً يمحو أن اعتمادًا
 * وقع أصلًا، وهو ما يُسأل عنه بعد سنتين.
 */
const TRANSITIONS: Record<StudyStatus, StudyStatus[]> = {
  draft: ["approved", "archived"],
  approved: ["archived"],
  archived: [],
};

export function canTransition(from: StudyStatus, to: StudyStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionRefusal(from: StudyStatus, to: StudyStatus): string {
  if (from === to) return `الدراسة ${STUDY_STATUS_LABEL[from]} أصلًا.`;
  if (from === "approved" && to === "draft") {
    return "الدراسة المعتمدة لا تعود مسودّة — أنشئ إصدارًا جديدًا منها.";
  }
  if (from === "archived") return "الدراسة مؤرشفة — لا تُغيَّر حالتها.";
  return "انتقالٌ غير مسموح لحالة الدراسة.";
}

/** ما يلزم قبل الاعتماد — عددُ المعالم التي لا يقوم تحليلٌ بدونها. */
export const MINIMUM_LANDMARKS = 8;

export interface ApprovalCheck {
  ok: boolean;
  message: string | null;
}

/**
 * هل تُعتمد هذه الدراسة؟
 *
 * الاعتماد توقيعٌ لا زرّ حفظ: دراسةٌ بأربع نقاطٍ تُعتمد اليوم تُقرأ بعد سنة على
 * أنها رأيُ الطبيب المستقرّ. فيُشترط حدٌّ أدنى من المعالم — ويُقال بالرقم لا
 * بـ«بيانات ناقصة»، لأن من يقرأ «ناقصة» لا يعرف كم ينقصه.
 */
export function checkApproval(input: {
  status: StudyStatus;
  points: Tracing;
}): ApprovalCheck {
  if (!canTransition(input.status, "approved")) {
    return { ok: false, message: transitionRefusal(input.status, "approved") };
  }
  const count = Object.keys(input.points).length;
  if (count < MINIMUM_LANDMARKS) {
    return {
      ok: false,
      message: `الدراسة تحتاج ${MINIMUM_LANDMARKS} معالمَ على الأقل قبل الاعتماد — الموضوع الآن ${count}.`,
    };
  }
  return { ok: true, message: null };
}

/**
 * بصمةُ اللقطة — لتُقارَن الدراسةُ المعتمدة بالتتبّع الحيّ.
 *
 * والغرض ليس الأمان بل **الصدق في الشاشة**: صورةٌ واحدة قد تحمل دراسةً معتمدة
 * ثم يُصحَّح تتبّعُها لدراسةٍ تالية. فيجب أن تقول الشاشة أيّهما تُري: أرقامَ ما
 * اعتُمد، أم أرقام ما على الشاشة الآن. وبلا بصمةٍ تُقارَن يبقى الفرق غير مرئي —
 * ويُقرأ رقمٌ على أنه المعتمد وهو ليس هو.
 *
 * والترتيب مُثبَّت بالفرز، والإحداثيات مقرّبة إلى ستّ منازل: نفسُ النقاط بترتيبٍ
 * آخر أو بفارق تقريبٍ عائم يجب أن تعطي البصمة نفسها.
 */
export function tracingFingerprint(points: Tracing, calibration: Calibration | null): string {
  const body = Object.entries(points)
    .filter((entry): entry is [string, { x: number; y: number }] => Boolean(entry[1]))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([code, point]) => `${code}:${point.x.toFixed(6)},${point.y.toFixed(6)}`)
    .join("|");
  const scale = calibration
    ? `@${calibration.from.x.toFixed(6)},${calibration.from.y.toFixed(6)}` +
      `>${calibration.to.x.toFixed(6)},${calibration.to.y.toFixed(6)}=${calibration.millimetres}`
    : "@—";
  return `${body}${scale}`;
}

/** أتغيّر التتبّع عمّا اعتُمد؟ */
export function hasDrifted(
  approved: { points: Tracing; calibration: Calibration | null },
  live: { points: Tracing; calibration: Calibration | null },
): boolean {
  return tracingFingerprint(approved.points, approved.calibration)
    !== tracingFingerprint(live.points, live.calibration);
}

export interface StudyLike {
  id: number;
  phase: StudyPhase;
  status: StudyStatus;
  revision: number;
  takenOn: string | null;
  createdAt: string;
}

/**
 * ترتيب الدراسات في ملف المريض.
 *
 * بمرحلة العلاج أوّلًا — قبل، فأثناء، فبعد، فمتابعة — لأن هذا هو ترتيبها في
 * رأس الطبيب. وداخل المرحلة: الأحدث أوّلًا، فآخرُ إصدارٍ هو المقصود عادةً.
 */
export function sortStudies<T extends StudyLike>(studies: T[]): T[] {
  return [...studies].sort((a, b) => {
    const phase = STUDY_PHASE_ORDER.indexOf(a.phase) - STUDY_PHASE_ORDER.indexOf(b.phase);
    if (phase !== 0) return phase;
    const at = Date.parse(a.takenOn ?? a.createdAt);
    const bt = Date.parse(b.takenOn ?? b.createdAt);
    if (at !== bt) return bt - at;
    return b.revision - a.revision;
  });
}

/**
 * الدراسة التي يُبنى عليها لمرحلةٍ ما: آخرُ **معتمدة** فيها.
 *
 * ومسودّةٌ أحدث لا تغلبها: المسودّة عملٌ لم يُوقَّع بعد، والخطّة تُبنى على ما
 * وُقِّع. وإرجاعُ المسودّة هنا كان سيجعل نصفَ عملٍ يُقارَن به علاجُ سنتين.
 */
export function currentStudy<T extends StudyLike>(studies: T[], phase: StudyPhase): T | null {
  const approved = sortStudies(studies.filter(
    (study) => study.phase === phase && study.status === "approved"));
  return approved[0] ?? null;
}

/** رقم الإصدار التالي على الصورة نفسها — الإصدارات تتراكم ولا تُستبدل. */
export function nextRevision(existing: { revision: number }[]): number {
  return existing.reduce((top, study) => Math.max(top, study.revision), 0) + 1;
}
