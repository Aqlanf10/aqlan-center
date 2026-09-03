import { describe, expect, it } from "vitest";
import {
  CHANGE_LABEL, NOISE_FLOOR, chronologicalOrder, compareAnalyses, comparisonSummary,
  directionOf, type OrderableStudy,
} from "../lib/cephCompare";
import type { Analysis, Measurement } from "../lib/ceph";

/**
 * السؤال الذي تجيب عنه المقارنة ليس «أين المريض من المعيار» بل **ماذا فعل
 * العلاج** — ويُسأل في نهاية علاجٍ امتدّ سنتين، وأمام مريضٍ يسأل «هل تحسّنت؟».
 *
 * وأخطر ما فيها أن «تحسّن» تُقرأ من **الاقتراب من المعيار** لا من اتجاه الرقم:
 * SNA ينزل من ٩٠ إلى ٨٤ تحسّن، وينزل من ٨٢ إلى ٧٦ تراجع — والاتجاه واحد.
 */

const measure = (key: string, value: number, mean: number | null): Measurement => ({
  key, name: key, unit: "deg", value,
  meaning: { ar: "", en: "" },
  norm: mean === null ? null : { mean, tolerance: 2 },
  verdict: null, from: [], analysis: "Steiner",
} as Measurement);

const analysis = (items: Measurement[]): Analysis => ({
  measurements: items, skeletal: null, vertical: null, missing: [], calibrated: false,
});

describe("اتجاه التغيّر", () => {
  it("الاقتراب من المعيار تحسّن — ولو نزل الرقم أو صعد", () => {
    // نزولٌ نحو المعيار.
    expect(directionOf(8, 2, -6)).toBe("improved");
    // وصعودٌ نحوه.
    expect(directionOf(-8, -2, 6)).toBe("improved");
  });

  it("والابتعاد تراجع — ولو كان الاتجاه هو نفسه", () => {
    // النزول نفسه: مرّةً تحسّن ومرّةً تراجع. ومن يقرأ السهم وحده يقرأ نصف
    // الحالات مقلوبة.
    expect(directionOf(0, -6, -6)).toBe("worsened");
    expect(directionOf(2, 8, 6)).toBe("worsened");
  });

  it("وما دون عتبة الضجيج ليس تغيّرًا — وضعُ نقطةٍ باليد يتحرّك", () => {
    expect(directionOf(3, 2.7, -0.3)).toBe("steady");
    expect(NOISE_FLOOR).toBe(0.5);
    // وعند العتبة تمامًا لا يزال ثباتًا؛ وفوقها بقليل يُحكم.
    expect(directionOf(3, 2.5, -0.5)).toBe("steady");
    expect(directionOf(3, 2.4, -0.6)).toBe("improved");
  });

  it("وعبورُ المتوسط بالمقدار نفسه ليس تحسّنًا ولا تراجعًا", () => {
    // ‎+2‎ ثم ‎−2‎: تحرّكت أربعًا لكنها بقيت على البعد نفسه من المتوسط.
    expect(directionOf(2, -2, -4)).toBe("steady");
  });

  it("وبلا معيار لا حكم — يُعرض الفرق ويُقال ذلك", () => {
    expect(directionOf(null, 3, 5)).toBe("ungraded");
    expect(directionOf(3, null, 5)).toBe("ungraded");
    expect(CHANGE_LABEL.ungraded.ar).toContain("بلا معيار");
  });
});

describe("مقارنة تحليلين", () => {
  const before = analysis([
    measure("SNA", 90, 82),
    measure("SNB", 78, 80),
    measure("ANB", 12, 2),
    measure("FMA", 25, 25),
    measure("FaceHeight", 120, null),
    measure("OnlyBefore", 5, 5),
  ]);
  const after = analysis([
    measure("SNA", 84, 82),
    measure("SNB", 79.9, 80),
    measure("ANB", 4, 2),
    measure("FMA", 25.2, 25),
    measure("FaceHeight", 130, null),
    measure("OnlyAfter", 5, 5),
  ]);

  const result = compareAnalyses(before, after);

  it("يقارن ما قيس في الاثنتين وحده", () => {
    expect(result.measurements.map((item) => item.key))
      .toEqual(["SNA", "SNB", "ANB", "FMA", "FaceHeight"]);
  });

  it("وما قيس في واحدةٍ يُقال بالاسم ولا يُقارَن", () => {
    // عرضُه بفرقٍ صفر يجعل الطبيب يقرأ **غيابًا** على أنه ثبات.
    expect(result.onlyBefore).toEqual(["OnlyBefore"]);
    expect(result.onlyAfter).toEqual(["OnlyAfter"]);
  });

  it("والفرق بإشارته كما هو", () => {
    const sna = result.measurements.find((item) => item.key === "SNA")!;
    expect(sna.delta).toBeCloseTo(-6, 10);
    expect(sna.before).toBe(90);
    expect(sna.after).toBe(84);
  });

  it("والحكم بالاقتراب: SNA و ANB اقتربا، وSNB اقترب بأقلّ من العتبة", () => {
    const by = (key: string) => result.measurements.find((item) => item.key === key)!.direction;
    expect(by("SNA")).toBe("improved");
    expect(by("ANB")).toBe("improved");
    // ‎78 → 79.9‎ اقترابٌ ‎1.9‎ من المعيار: فوق العتبة.
    expect(by("SNB")).toBe("improved");
    // ‎25 → 25.2‎: ضجيج.
    expect(by("FMA")).toBe("steady");
    expect(by("FaceHeight")).toBe("ungraded");
  });

  it("والعدّ يوافق التصنيف — لا رقمًا يُحسب على حدة", () => {
    expect(result.improved).toBe(3);
    expect(result.worsened).toBe(0);
    expect(result.steady).toBe(1);
    expect(result.improved + result.worsened + result.steady
      + result.measurements.filter((item) => item.direction === "ungraded").length)
      .toBe(result.measurements.length);
  });

  it("والخلاصة تعدّ ولا تحكم على العلاج", () => {
    const summary = comparisonSummary(result);
    expect(summary.ar).toContain("3");
    // جملةٌ تحكم بدل الطبيب في ورقةٍ تُعطى لمريض تجاوزٌ لحدّ الأداة.
    expect(summary.ar).not.toContain("نجح");
    expect(summary.ar).not.toContain("ممتاز");
  });

  it("ودراستان بلا قياسٍ مشترك تُقال ولا تُقارَن", () => {
    const empty = compareAnalyses(analysis([measure("A", 1, 1)]), analysis([measure("B", 1, 1)]));
    expect(empty.measurements).toHaveLength(0);
    expect(comparisonSummary(empty).ar).toContain("لا تُقارَنان");
  });

  it("وقلبُ الترتيب يقلب كل إشارة وكل حكم", () => {
    // المستدعي هو من يرتّب — والشاشة تُظهر تاريخ كلٍّ منهما صراحةً.
    const flipped = compareAnalyses(after, before);
    expect(flipped.measurements.find((item) => item.key === "SNA")!.delta).toBeCloseTo(6, 10);
    expect(flipped.measurements.find((item) => item.key === "SNA")!.direction).toBe("worsened");
    expect(flipped.improved).toBe(0);
    expect(flipped.worsened).toBe(3);
  });
});

describe("أيّهما «قبل» — ترتيبٌ لا يتبع من نادى", () => {
  const study = (over: Partial<OrderableStudy> & { id: number }): OrderableStudy => ({
    revision: 1, takenOn: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", ...over,
  });

  it("تاريخ التصوير أوّلًا", () => {
    const early = study({ id: 9, takenOn: "2025-03-01" });
    const late = study({ id: 2, takenOn: "2026-08-01" });
    expect(chronologicalOrder(early, late).map((one) => one.id)).toEqual([9, 2]);
    expect(chronologicalOrder(late, early).map((one) => one.id)).toEqual([9, 2]);
  });

  it("وإصدارا أشعّةٍ واحدة يرثان تاريخها — فيُحسم بالإصدار", () => {
    /*
     * وهذه أشيع الحالات لا أندرها: كل إصدارٍ ثانٍ على الصورة نفسها.
     * وقبل هذا كان الترتيب يتبع ترتيب المعاملين، فقلبُهما يقلب كل حكم.
     */
    const first = study({ id: 11, revision: 1 });
    const second = study({ id: 12, revision: 2 });
    expect(chronologicalOrder(first, second).map((one) => one.revision)).toEqual([1, 2]);
    expect(chronologicalOrder(second, first).map((one) => one.revision)).toEqual([1, 2]);
  });

  it("ووقتُ الإنشاء يسبق الإصدار حين يختلف اليوم فيه", () => {
    const morning = study({ id: 5, createdAt: "2026-01-01T08:00:00.000Z", revision: 9 });
    const evening = study({ id: 4, createdAt: "2026-01-01T20:00:00.000Z", revision: 1 });
    expect(chronologicalOrder(evening, morning).map((one) => one.id)).toEqual([5, 4]);
  });

  it("وحين يتساوى كل شيء يحسم المعرّف — فلا يبقى شيءٌ لمن نادى", () => {
    const a = study({ id: 3 });
    const b = study({ id: 7 });
    expect(chronologicalOrder(b, a).map((one) => one.id)).toEqual([3, 7]);
  });

  it("والقلبُ لا يغيّر النتيجة أبدًا — على كل تشكيلة", () => {
    const rows: OrderableStudy[] = [
      study({ id: 1 }),
      study({ id: 2, revision: 2 }),
      study({ id: 3, takenOn: null, createdAt: "2026-05-05T00:00:00.000Z" }),
      study({ id: 4, takenOn: "2026-05-05" }),
    ];
    for (const one of rows) {
      for (const two of rows) {
        if (one.id === two.id) continue;
        expect(chronologicalOrder(one, two).map((row) => row.id))
          .toEqual(chronologicalOrder(two, one).map((row) => row.id));
      }
    }
  });

  it("والفحص نفسه يمسك الترتيب القديم الذي يتبع من نادى", () => {
    const older = (one: OrderableStudy, two: OrderableStudy) =>
      (one.takenOn ?? one.createdAt) <= (two.takenOn ?? two.createdAt) ? [one, two] : [two, one];
    const first = study({ id: 11, revision: 1 });
    const second = study({ id: 12, revision: 2 });
    // تاريخهما واحد، فالقديم يُبقي ترتيب المنادي — ويقلب الحكم بقلب المعاملين.
    expect(older(second, first).map((one) => one.id)).toEqual([12, 11]);
    expect(chronologicalOrder(second, first).map((one) => one.id)).toEqual([11, 12]);
  });
});
