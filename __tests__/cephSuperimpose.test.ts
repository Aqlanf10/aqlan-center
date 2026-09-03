import { describe, expect, it } from "vitest";
import { superimposeOnSN, type SuperimposeInput } from "../lib/cephSuperimpose";
import type { Calibration, Tracing } from "../lib/ceph";

/**
 * التراكب يُري ما لا يُقرأ من عمودٍ من الأرقام: **أين تحرّك الوجه**.
 *
 * وأخطر ما فيه إغراءٌ واحد: أن تُحجَّم الصورتان حتى يتطابق طول SN فتنطبقا
 * تمامًا. وهذا **يمحو النموّ** — قاعدة الجمجمة تطول في الطفل، فجعلُ طولها واحدًا
 * يُلغي بالضبط ما جاء التراكب ليُظهره. فالتحجيم من المعايرة وحدها.
 */

/** معايرة: طرفان أفقيّان تفصلهما مسافةٌ معلومة. */
const scaleBar = (span: number, millimetres: number): Calibration =>
  ({ from: { x: 0.1, y: 0.5 }, to: { x: 0.1 + span, y: 0.5 }, millimetres });

const face = (over: Partial<Tracing> = {}): Tracing => ({
  S: { x: 0.30, y: 0.30 },
  N: { x: 0.60, y: 0.30 },
  A: { x: 0.60, y: 0.50 },
  Pog: { x: 0.55, y: 0.75 },
  ...over,
});

/** نسبةٌ ١ ومعايرةٌ تجعل الوحدة الواحدة ١٠٠ مم — فتُقرأ الأرقام بالنظر. */
const study = (points: Tracing, over: Partial<SuperimposeInput> = {}): SuperimposeInput => ({
  points, aspect: 1, calibration: scaleBar(0.1, 10), ...over,
});

const close = (one: { x: number; y: number }, two: { x: number; y: number }, tolerance = 1e-9) => {
  expect(one.x).toBeCloseTo(two.x, 9);
  expect(one.y).toBeCloseTo(two.y, 9);
  void tolerance;
};

describe("ما لا يُتراكب", () => {
  it("بلا S أو N لا تراكب — ويُقال أيّ معلمٍ ينقص", () => {
    const verdict = superimposeOnSN(study(face()), study({ S: { x: 0.3, y: 0.3 } }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("S وN");
  });

  it("وبلا معايرةٍ على الاثنتين لا تراكب — ويُقال لماذا", () => {
    /*
     * الإحداثيات كسورٌ من الصورة، والصورتان قد تختلفان مقاسًا وتكبيرًا. فبلا
     * مقياسٍ معلوم لا يُعرف كم يساوي الفرق — والرسم حينها يبدو صحيحًا وهو غلط.
     */
    const bare = study(face(), { calibration: null });
    const first = superimposeOnSN(bare, study(face()));
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.message).toContain("معايرة");
    expect(superimposeOnSN(study(face()), bare).ok).toBe(false);
  });

  it("ومعايرةٌ بطرفين على نقطةٍ واحدة تُردّ", () => {
    const broken = study(face(), {
      calibration: { from: { x: 0.2, y: 0.2 }, to: { x: 0.2, y: 0.2 }, millimetres: 10 },
    });
    expect(superimposeOnSN(study(face()), broken).ok).toBe(false);
  });
});

describe("التسجيل على SN عند S", () => {
  it("الدراسة على نفسها لا تتحرّك", () => {
    const one = study(face());
    const result = superimposeOnSN(one, one);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const code of ["S", "N", "A", "Pog"] as const) {
      close(result.value.points[code]!, one.points[code]!);
    }
    expect(result.value.scale).toBeCloseTo(1, 9);
    expect(result.value.rotationDegrees).toBeCloseTo(0, 9);
  });

  it("وإزاحةُ الصورة كلّها تُلغى — الوجه نفسه في مكانٍ آخر ينطبق", () => {
    const shifted = study(face({
      S: { x: 0.45, y: 0.20 }, N: { x: 0.75, y: 0.20 },
      A: { x: 0.75, y: 0.40 }, Pog: { x: 0.70, y: 0.65 },
    }));
    const result = superimposeOnSN(study(face()), shifted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    close(result.value.points.A!, face().A!);
    close(result.value.points.Pog!, face().Pog!);
  });

  it("ودورانُ الرأس في الصورة يُلغى", () => {
    /*
     * نفس الوجه مُدارًا ٩٠° حول S في فضاء الحساب — فيصير S→N رأسيًّا.
     * والدوران هناك على (x, −y): النقطة (dx, dy) تصير (−dy, dx).
     */
    const turned = study({
      S: { x: 0.30, y: 0.30 },
      N: { x: 0.30, y: 0.00 },
      A: { x: 0.50, y: 0.00 },
      Pog: { x: 0.75, y: 0.05 },
    });
    const result = superimposeOnSN(study(face()), turned);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    close(result.value.points.N!, face().N!);
    close(result.value.points.A!, face().A!);
    expect(Math.abs(result.value.rotationDegrees)).toBeCloseTo(90, 6);
  });
});

describe("النموّ لا يُمحى — وهذا هو الحدّ الحاكم", () => {
  /*
   * قاعدة الجمجمة تطول في الطفل. والصورة الثانية هنا **نفس المقياس** (المعايرة
   * ذاتها) لكن SN فيها أطول بالمليمتر — أي نموّ حقيقي.
   */
  const grown = study({
    S: { x: 0.30, y: 0.30 },
    N: { x: 0.72, y: 0.30 },   // SN أطول بـ٤٠٪
    A: { x: 0.72, y: 0.50 },
    Pog: { x: 0.60, y: 0.80 },
  });

  const result = superimposeOnSN(study(face()), grown);

  it("لا يُحجَّم على طول SN", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // التحجيم من المعايرة، وهي واحدة — فالمقياس واحد لا يُعدَّل ليُطابق SN.
    expect(result.value.scale).toBeCloseTo(1, 9);
  });

  it("فيقع N الجديد بعد القديم على الخطّ نفسه — والنموّ مرئي", () => {
    if (!result.ok) return;
    const moved = result.value.points.N!;
    expect(moved.y).toBeCloseTo(0.30, 9);
    // القديم عند ‎0.60‎؛ والجديد أبعد لأن القاعدة طالت.
    expect(moved.x).toBeGreaterThan(0.60);
    expect(moved.x).toBeCloseTo(0.72, 9);
  });

  it("ويُقال طول القاعدة في كلٍّ بالمليمتر — فيُقرأ النموّ رقمًا", () => {
    if (!result.ok) return;
    expect(result.value.cranialBaseBefore).toBeCloseTo(30, 6);
    expect(result.value.cranialBaseAfter).toBeCloseTo(42, 6);
  });

  it("والفحص نفسه يمسك التحجيم على SN — وهو الإغراء الذي يمحو النموّ", () => {
    if (!result.ok) return;
    const span = (t: Tracing) => Math.hypot(t.N!.x - t.S!.x, t.N!.y - t.S!.y);
    const onSN = span(face()) / span(grown.points);
    // نسبةُ التحجيم على SN ليست واحدًا — ولو استُعملت لانطبق N على N تمامًا،
    // فيختفي أربعون بالمئة من نموّ قاعدة الجمجمة من الرسم.
    expect(onSN).toBeLessThan(0.99);
    expect(result.value.scale).not.toBeCloseTo(onSN, 3);
  });
});

describe("اختلاف المقاس بين الصورتين", () => {
  it("صورةٌ بمعايرةٍ أخرى تُحوَّل إلى وحدات الأولى", () => {
    /*
     * نفس الوجه على صورةٍ نصفَ مقياسها: كل شيءٍ فيها نصفُ حجمه، ومعايرتُها تقول
     * ذلك. فبعد التراكب ينطبق تمامًا — لأن المليمتر مليمتر.
     */
    const half = study({
      S: { x: 0.30, y: 0.30 },
      N: { x: 0.45, y: 0.30 },
      A: { x: 0.45, y: 0.40 },
      Pog: { x: 0.425, y: 0.525 },
    }, { calibration: scaleBar(0.1, 20) });

    const result = superimposeOnSN(study(face()), half);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scale).toBeCloseTo(2, 9);
    close(result.value.points.N!, face().N!);
    close(result.value.points.A!, face().A!);
    close(result.value.points.Pog!, face().Pog!);
  });

  it("ونسبةُ الصورة تدخل الحساب — كما في كل قياسٍ في هذا النظام", () => {
    // نفس الوجه على صورةٍ ٤:٥: الكسور الأفقية تختلف، والنتيجة يجب أن تنطبق.
    const tall: SuperimposeInput = {
      aspect: 0.8,
      calibration: scaleBar(0.125, 10),
      points: {
        S: { x: 0.375, y: 0.30 },
        N: { x: 0.750, y: 0.30 },
        A: { x: 0.750, y: 0.50 },
        Pog: { x: 0.6875, y: 0.75 },
      },
    };
    const result = superimposeOnSN(study(face()), tall);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    close(result.value.points.N!, face().N!);
    close(result.value.points.A!, face().A!);
    close(result.value.points.Pog!, face().Pog!);
  });
});
