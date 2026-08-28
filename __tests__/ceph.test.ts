import { describe, expect, it } from "vitest";
import {
  analyse,
  angleAt,
  distanceBetween,
  formatMeasurement,
  isLandmarkCode,
  millimetresPerUnit,
  skeletalClass,
  verdictFor,
  NORMS,
  type Tracing,
} from "../lib/ceph";

/*
 * وجهٌ سويّ بُني بالحساب لا بالتخمين.
 *
 * وُضعت S وN، ثم اشتُقّت A وB على شعاعين يبعدان ٨٢° و٨٠° عن شعاع N→S — فإن كانت
 * الصيغة صحيحة أعادت ٨٢ و٨٠ بالضبط. وإحداثيات الصورة هنا كما هي في الواقع: x
 * يزداد أمامًا والمريض ينظر يمينًا، وy يزداد **نزولًا**.
 */
const NORMAL: Tracing = {
  S: { x: 0.34, y: 0.235 },
  N: { x: 0.62, y: 0.26 },
  A: { x: 0.5588, y: 0.5230 },
  B: { x: 0.5158, y: 0.6462 },
};

describe("الزاوية عند رأس", () => {
  it("قائمةٌ حين تكون قائمة", () => {
    // y الصورة تزداد نزولًا، فالنقطة ذات y الأكبر أسفل.
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 6);
  });

  it("مستقيمةٌ حين تكون على استقامة", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180, 6);
  });

  it("لا تتأثّر بترتيب الضلعين", () => {
    const a = angleAt(NORMAL.N!, NORMAL.S!, NORMAL.A!);
    const b = angleAt(NORMAL.N!, NORMAL.A!, NORMAL.S!);
    expect(a).toBeCloseTo(b, 10);
  });

  it("تراعي أن الصورة ليست مربّعة", () => {
    // إزاحةٌ نسبية متساوية على صورةٍ عرضها ضعف ارتفاعها ليست زاوية ٤٥°.
    const square = angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, 1);
    const wide = angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, 2);
    expect(square).toBeCloseTo(45, 6);
    expect(wide).toBeLessThan(square);
  });
});

describe("التحليل على وجهٍ سويّ", () => {
  const result = analyse({ tracing: NORMAL });
  const value = (key: string) => result.measurements.find((m) => m.key === key)!.value;

  it("SNA ٨٢ وSNB ٨٠", () => {
    expect(value("SNA")).toBeCloseTo(82, 1);
    expect(value("SNB")).toBeCloseTo(80, 1);
  });

  it("وANB فرقُهما لا زاويةٌ تُقاس", () => {
    expect(value("ANB")).toBeCloseTo(2, 1);
    expect(value("ANB")).toBeCloseTo(value("SNA") - value("SNB"), 10);
  });

  it("وكلّها ضمن المعيار", () => {
    expect(result.measurements.every((m) => m.verdict === "normal")).toBe(true);
  });

  it("والتصنيف الأول", () => {
    expect(result.skeletal?.klass).toBe("I");
    expect(result.missing).toEqual([]);
  });

  it("والقياس يذكر نقاطه — فيُعرف ما يُراجَع", () => {
    expect(result.measurements.find((m) => m.key === "ANB")!.from).toEqual(["S", "N", "A", "B"]);
  });
});

describe("التصنيف الهيكلي", () => {
  it("ثانٍ حين يتخلّف الفك السفلي", () => {
    // يُزاح B خلفًا فتكبر ANB.
    const back = analyse({ tracing: { ...NORMAL, B: { x: 0.44, y: 0.66 } } });
    expect(back.skeletal!.anb).toBeGreaterThan(4);
    expect(back.skeletal!.klass).toBe("II");
  });

  it("وثالثٌ حين يتقدّم — وANB سالبة لا تُلغى", () => {
    const forward = analyse({ tracing: { ...NORMAL, B: { x: 0.60, y: 0.63 } } });
    expect(forward.skeletal!.anb).toBeLessThan(0);
    expect(forward.skeletal!.klass).toBe("III");
  });

  it("والحدود كما هي معرّفة", () => {
    expect(skeletalClass(0)).toBe("I");
    expect(skeletalClass(4)).toBe("I");
    expect(skeletalClass(4.1)).toBe("II");
    expect(skeletalClass(-0.1)).toBe("III");
  });
});

describe("النقص يُقال لا يُسكت عنه", () => {
  it("تحليلٌ ناقص النقاط يذكر الناقص باسمه", () => {
    const partial = analyse({ tracing: { S: NORMAL.S, N: NORMAL.N } });
    expect(partial.missing).toEqual(["A", "B"]);
    expect(partial.skeletal).toBeNull();
    expect(partial.measurements).toEqual([]);
  });

  it("ونقطةٌ واحدة ناقصة تُسقط ما يعتمد عليها وحده", () => {
    const noB = analyse({ tracing: { S: NORMAL.S, N: NORMAL.N, A: NORMAL.A } });
    expect(noB.missing).toEqual(["B"]);
    expect(noB.measurements.map((m) => m.key)).toEqual(["SNA"]);
    expect(noB.skeletal).toBeNull();
  });
});

describe("المعايرة", () => {
  it("بلا معايرة لا قياس طولي", () => {
    expect(analyse({ tracing: NORMAL }).calibrated).toBe(false);
  });

  it("ومعها يُعرف المليمتر من وحدة الصورة", () => {
    const calibration = { from: { x: 0.1, y: 0.9 }, to: { x: 0.3, y: 0.9 }, millimetres: 20 };
    expect(millimetresPerUnit(calibration)).toBeCloseTo(100, 6);
    expect(analyse({ tracing: NORMAL, calibration }).calibrated).toBe(true);
  });

  it("ومعايرةٌ فاسدة لا تُقبل", () => {
    expect(millimetresPerUnit({ from: { x: 0.1, y: 0.5 }, to: { x: 0.1, y: 0.5 }, millimetres: 20 })).toBeNull();
    expect(millimetresPerUnit({ from: { x: 0.1, y: 0.5 }, to: { x: 0.3, y: 0.5 }, millimetres: 0 })).toBeNull();
  });

  it("والمسافة تراعي نسبة الصورة", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, 2)).toBeCloseTo(2, 6);
  });
});

describe("الحكم والعرض", () => {
  it("خارج المعيار مرتفعٌ أو منخفض", () => {
    expect(verdictFor(82, NORMS.SNA)).toBe("normal");
    expect(verdictFor(84, NORMS.SNA)).toBe("normal");
    expect(verdictFor(84.1, NORMS.SNA)).toBe("high");
    expect(verdictFor(79.9, NORMS.SNA)).toBe("low");
  });

  it("والرقم يُعرض بوحدته", () => {
    expect(formatMeasurement(82.04, "deg")).toBe("82.0°");
    expect(formatMeasurement(4.25, "mm")).toBe("4.3 مم");
    expect(formatMeasurement(Number.NaN, "deg")).toBe("—");
  });

  it("ورمز النقطة قائمة مغلقة", () => {
    expect(isLandmarkCode("S")).toBe(true);
    expect(isLandmarkCode("XX")).toBe(false);
  });
});
