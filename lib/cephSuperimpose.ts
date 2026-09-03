import { millimetresPerUnit, type Calibration, type Tracing, type TracedPoint } from "./ceph";

/**
 * التراكب — رسمُ دراستين فوق بعضهما لتُرى الحركة بالعين.
 *
 * الجدول يقول «SNA نزل ستّ درجات»؛ والتراكب يُري **أين تحرّك الوجه** — أنزل
 * الفكّ العلوي أم دار؟ أدارت الذقن للأمام أم نمت؟ وهذا ما يُقرأ في ثانية ولا
 * يُقرأ من عمودٍ من الأرقام.
 *
 * ### التسجيل: على قاعدة الجمجمة SN عند S
 *
 * وهي التراكب «العام» الكلاسيكي: تُثبَّت الصورتان على خطّ S→N ويُطابَق موضع S،
 * فما تحرّك بعد ذلك تحرّك فعلًا. واخترناها لأن معلَميها (S وN) **مطلوبان في كل
 * تتبّع** — فتعمل على كل دراسة، بخلاف تراكب الفكّ العلوي الذي يحتاج ANS وPNS.
 *
 * ### وقاعدةُ القياس هي الحدّ الحاكم
 *
 * الإحداثيات كسورٌ من الصورة، والصورتان قد تختلفان في المقاس والتكبير. فلا
 * يُعرف كم يساوي «الكسر» بالمليمتر إلا من **المعايرة**. ولذلك:
 *
 *   **لا تراكب بلا معايرةٍ على الدراستين معًا.**
 *
 * وقد يُغرى المرء بالتحجيم على طول SN حتى تتطابق الصورتان — وهذا **يمحو النموّ**:
 * قاعدة الجمجمة تطول في الطفل، فجعلُ طولها واحدًا في الصورتين يُلغي بالضبط ما
 * جاء التراكب ليُظهره. فالتحجيم هنا من المعايرة وحدها، ولا شيء غيرها.
 */

export interface SuperimposeInput {
  points: Tracing;
  calibration: Calibration | null;
  /** العرض ÷ الارتفاع — تدخل لأن الإحداثيات كسورٌ من بُعدين مختلفين. */
  aspect: number;
}

export interface Superimposition {
  /** معالمُ الدراسة الثانية منقولةً إلى فضاء الأولى — تُرسم على صورتها. */
  points: Tracing;
  /** ما ضُرب فيه مقاس الثانية لتصير بوحدات الأولى. */
  scale: number;
  /** ما دارته الثانية لتستقيم على خطّ SN — بالدرجات، موجبها عكس عقارب الساعة. */
  rotationDegrees: number;
  /** طول SN بالمليمتر في كلٍّ — فيُرى النموّ رقمًا لا رسمًا فقط. */
  cranialBaseBefore: number;
  cranialBaseAfter: number;
}

export type SuperimposeResult =
  | { ok: true; value: Superimposition }
  | { ok: false; message: string };

/** إلى فضاء الحساب: أفقيٌّ مضروبٌ في النسبة، ورأسيٌّ مقلوب — كما في التحليل. */
const toAnalysis = (point: TracedPoint, aspect: number) => ({ x: point.x * aspect, y: -point.y });

/** ومنه إلى الكسور من جديد — لتُرسم على الصورة. */
const toFraction = (point: { x: number; y: number }, aspect: number): TracedPoint =>
  ({ x: point.x / aspect, y: -point.y });

/**
 * يضع الدراسة الثانية على الأولى.
 *
 * والترتيب معنيّ: `base` هي التي تبقى مكانها وتُرسم عليها صورتها، و`target` هي
 * التي تُنقل. والمستدعي هو من يرتّبهما زمنيًّا.
 */
export function superimposeOnSN(base: SuperimposeInput, target: SuperimposeInput): SuperimposeResult {
  const baseS = base.points.S;
  const baseN = base.points.N;
  const targetS = target.points.S;
  const targetN = target.points.N;
  if (!baseS || !baseN || !targetS || !targetN) {
    return {
      ok: false,
      message: "التراكب يحتاج المعلمين S وN في الدراستين — ضعهما ثم أعد المحاولة.",
    };
  }

  if (!base.calibration || !target.calibration) {
    return {
      ok: false,
      message: "التراكب يحتاج معايرة الصورتين — بلا مقياسٍ معلوم لا يُعرف كم يساوي الفرق.",
    };
  }
  const baseMm = millimetresPerUnit(base.calibration, base.aspect);
  const targetMm = millimetresPerUnit(target.calibration, target.aspect);
  if (!baseMm || !targetMm) {
    return { ok: false, message: "معايرة إحدى الصورتين غير صالحة." };
  }

  // مقاسُ الثانية بوحدات الأولى: مليمترٌ واحد يجب أن يكون طولًا واحدًا في الرسمين.
  const scale = targetMm / baseMm;

  const bs = toAnalysis(baseS, base.aspect);
  const bn = toAnalysis(baseN, base.aspect);
  const ts = toAnalysis(targetS, target.aspect);
  const tn = toAnalysis(targetN, target.aspect);

  const baseAngle = Math.atan2(bn.y - bs.y, bn.x - bs.x);
  const targetAngle = Math.atan2(tn.y - ts.y, tn.x - ts.x);
  const rotation = baseAngle - targetAngle;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const moved: Tracing = {};
  for (const [code, point] of Object.entries(target.points)) {
    if (!point) continue;
    const p = toAnalysis(point, target.aspect);
    // الإزاحة إلى S، ثم التحجيم بالمعايرة، ثم الدوران، ثم الوضع عند S الأولى.
    const dx = (p.x - ts.x) * scale;
    const dy = (p.y - ts.y) * scale;
    moved[code as keyof Tracing] = toFraction(
      { x: bs.x + dx * cos - dy * sin, y: bs.y + dx * sin + dy * cos },
      base.aspect,
    );
  }

  const spanOf = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    Math.hypot(to.x - from.x, to.y - from.y);

  return {
    ok: true,
    value: {
      points: moved,
      scale,
      rotationDegrees: (rotation * 180) / Math.PI,
      // بالمليمتر لا بالكسور — فرقُ الطولين هو نموّ قاعدة الجمجمة، ويُقرأ رقمًا.
      cranialBaseBefore: spanOf(bs, bn) * baseMm,
      cranialBaseAfter: spanOf(ts, tn) * targetMm,
    },
  };
}
