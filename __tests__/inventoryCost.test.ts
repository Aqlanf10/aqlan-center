import { describe, expect, it } from "vitest";
import { costNow, costStates, issuedCostMinor, type CostedMovement } from "../lib/inventoryCost";

const buy = (qty: number, unitCostMinor: number): CostedMovement => ({ kind: "in", qty, unitCostMinor });
const issue = (qty: number): CostedMovement => ({ kind: "out", qty });
const back = (qty: number): CostedMovement => ({ kind: "in", qty, isReturn: true });

describe("متوسّط تكلفة المخزون", () => {
  it("شراءٌ واحد: المتوسّط هو ثمنه", () => {
    const state = costNow([buy(100, 50)]);
    expect(state.qty).toBe(100);
    expect(state.valueMinor).toBe(5_000);
    expect(state.unitCostMinor).toBe(50);
  });

  it("**وشراءٌ ثانٍ بثمنٍ آخر يحرّك المتوسّط** — لا يستبدله", () => {
    // ١٠٠ بـ٥٠ ثم ١٠٠ بـ٧٠ = ٢٠٠ بقيمة ١٢٬٠٠٠ ومتوسّطٍ ٦٠.
    const state = costNow([buy(100, 50), buy(100, 70)]);
    expect(state.qty).toBe(200);
    expect(state.valueMinor).toBe(12_000);
    expect(state.unitCostMinor).toBe(60);
  });

  it("والصرف يُقوَّم بالمتوسّط ولا يغيّره", () => {
    const states = costStates([buy(100, 50), buy(100, 70), issue(50)]);
    const after = states[2];
    expect(after.qty).toBe(150);
    expect(after.valueMinor).toBe(9_000); // ١٢٬٠٠٠ − ٥٠×٦٠
    expect(after.unitCostMinor).toBe(60);
  });

  it("**والردُّ يعود بالمتوسّط القائم** — لا بثمنٍ جديد، فهو إلغاءُ استهلاك", () => {
    const state = costNow([buy(100, 50), buy(100, 70), issue(50), back(50)]);
    expect(state.qty).toBe(200);
    expect(state.valueMinor).toBe(12_000);
    expect(state.unitCostMinor).toBe(60);
  });

  it("ورفٌّ فارغ قيمتُه صفر لا سالب", () => {
    const state = costNow([buy(10, 100), issue(10)]);
    expect(state.qty).toBe(0);
    expect(state.valueMinor).toBe(0);
    // ولا متوسّط لما لا رصيد له — ولا قسمةَ على صفر.
    expect(state.unitCostMinor).toBeNull();
  });

  it("وصرفٌ يتجاوز الرصيد لا يُنزل القيمة تحت الصفر", () => {
    const state = costNow([buy(10, 100), { kind: "adjust", qty: -20 }]);
    expect(state.valueMinor).toBe(0);
  });

  it("وإدخالٌ بلا ثمنٍ يدخل بالمتوسّط القائم — لا بصفرٍ يخفض المتوسّط", () => {
    const state = costNow([buy(100, 50), { kind: "in", qty: 100 }]);
    expect(state.unitCostMinor).toBe(50);
    expect(state.valueMinor).toBe(10_000);
  });

  it("وبندٌ بلا حركةٍ أصلًا: صفرٌ بلا متوسّط، لا خطأ", () => {
    expect(costNow([])).toEqual({ qty: 0, valueMinor: 0, unitCostMinor: null });
  });
});

describe("تكلفةُ ما صُرف", () => {
  const timeline = [buy(100, 50), issue(50), buy(100, 70), issue(50)];

  it("**كلُّ صرفٍ بمتوسّط لحظته** — لا بمتوسّطٍ لاحق", () => {
    // الأول عند متوسّط ٥٠ = ٢٬٥٠٠؛ والثاني: ٥٠ بقيمة ٢٬٥٠٠ + ١٠٠ بـ٧٠ = ٩٬٥٠٠/١٥٠ ≈ ٦٣٫٣٣
    expect(issuedCostMinor(timeline, (i) => i === 1)).toBe(2_500);
    expect(issuedCostMinor(timeline, (i) => i === 3)).toBe(3_167);
  });

  it("وشراءٌ بعد الصرف لا يغيّر تكلفة ذلك الصرف", () => {
    const withoutLater = issuedCostMinor([buy(100, 50), issue(50)], (i) => i === 1);
    expect(issuedCostMinor(timeline, (i) => i === 1)).toBe(withoutLater);
  });

  it("والنافذة تجمع ما فيها وحده", () => {
    expect(issuedCostMinor(timeline, () => true)).toBe(2_500 + 3_167);
    expect(issuedCostMinor(timeline, () => false)).toBe(0);
  });

  it("والإدخال ليس صرفًا فلا يُحسب فيها", () => {
    expect(issuedCostMinor(timeline, (i) => i === 0 || i === 2)).toBe(0);
  });
});
