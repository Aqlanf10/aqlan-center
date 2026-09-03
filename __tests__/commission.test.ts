import { describe, expect, it } from "vitest";
import {
  allocateFifo,
  commissionForPatient,
  summarizeCommissions,
  type CommissionInvoice, deductLabCost,} from "../lib/commission";

describe("توزيع الدفعات على الفواتير", () => {
  const invoices = [
    { id: 1, netMinor: 50000, createdAt: "2026-08-01T10:00:00Z" },
    { id: 2, netMinor: 30000, createdAt: "2026-08-10T10:00:00Z" },
  ];

  it("يغطّي الأقدم أولًا", () => {
    const allocation = allocateFifo(invoices, 60000);
    expect(allocation.get(1)).toBe(50000);
    expect(allocation.get(2)).toBe(10000);
  });

  it("لا ينسب الفائض إلى فاتورة — يبقى رصيدًا للمريض", () => {
    // ولو نُسب لحُسبت للطبيب عمولةٌ على مالٍ لم يقابله عمل.
    const allocation = allocateFifo(invoices, 120000);
    expect(allocation.get(1)).toBe(50000);
    expect(allocation.get(2)).toBe(30000);
    expect([...allocation.values()].reduce((a, b) => a + b, 0)).toBe(80000);
  });

  it("يعطي نفس النتيجة مهما اختلف ترتيب الإدخال", () => {
    const reversed = [...invoices].reverse();
    expect(allocateFifo(reversed, 60000)).toEqual(allocateFifo(invoices, 60000));
  });
});

function invoice(over: Partial<CommissionInvoice> & { id: number }): CommissionInvoice {
  return {
    netMinor: 100000,
    createdAt: "2026-08-01T10:00:00Z",
    doctorShares: [{ doctorId: 7, amountMinor: 100000 }],
    ...over,
  };
}

describe("عمولة الطبيب", () => {
  const percent = new Map([[7, 35]]);

  it("تُحسب على المحصّل لا على المفوتر", () => {
    // عمولةٌ على فاتورة لم تُحصَّل تعني أن يدفع صاحب العيادة من ماله عن مريض لم يدفع.
    const result = commissionForPatient([invoice({ id: 1 })], 0, percent);
    expect(result.get(7)).toEqual({ accruedMinor: 35000, earnedMinor: 0 });
  });

  it("تتناسب مع نسبة التغطية لا كل-أو-لا-شيء", () => {
    // الكل-أو-لا-شيء يؤجّل عمولة الطبيب شهورًا على مريض يدفع أقساطًا.
    const result = commissionForPatient([invoice({ id: 1 })], 50000, percent);
    expect(result.get(7)).toEqual({ accruedMinor: 35000, earnedMinor: 17500 });
  });

  it("تكتمل عند السداد الكامل", () => {
    const result = commissionForPatient([invoice({ id: 1 })], 100000, percent);
    expect(result.get(7)?.earnedMinor).toBe(35000);
  });

  it("توزّع بين طبيبين في فاتورة واحدة", () => {
    const shared = invoice({
      id: 1, netMinor: 100000,
      doctorShares: [{ doctorId: 7, amountMinor: 60000 }, { doctorId: 8, amountMinor: 40000 }],
    });
    const result = commissionForPatient([shared], 100000, new Map([[7, 35], [8, 50]]));
    expect(result.get(7)?.earnedMinor).toBe(21000);
    expect(result.get(8)?.earnedMinor).toBe(20000);
  });

  it("توزّع على كل الفواتير ثم تحسب المُصفَّاة وحدها", () => {
    // لو حُذفت القديمة قبل التوزيع لبدت دفعةٌ قديمة كأنها تغطّي فاتورة الشهر الحالي،
    // فتُصرف عمولة مرتين على مالٍ واحد.
    const invoices = [
      invoice({ id: 1, netMinor: 100000, createdAt: "2026-07-01T10:00:00Z" }),
      invoice({ id: 2, netMinor: 100000, createdAt: "2026-08-01T10:00:00Z" }),
    ];
    const august = (item: CommissionInvoice) => item.createdAt >= "2026-08-01";

    // 100,000 محصّلة تغطّي فاتورة يوليو كاملة ولا شيء من أغسطس.
    const result = commissionForPatient(invoices, 100000, percent, august);
    expect(result.get(7)?.earnedMinor).toBe(0);
    expect(result.get(7)?.accruedMinor).toBe(35000);

    // ولو حُسبت فواتير أغسطس وحدها لبدت مغطّاة بالكامل — وهو الخطأ المقصود منعه.
    expect(commissionForPatient([invoices[1]], 100000, percent).get(7)?.earnedMinor).toBe(35000);
  });

  it("تتجاهل الطبيب بلا نسبة", () => {
    expect(commissionForPatient([invoice({ id: 1 })], 100000, new Map()).size).toBe(0);
  });
});

describe("ملخص العمولات", () => {
  it("يطرح المدفوع ويُظهر الصرف بلا استحقاق", () => {
    const summary = summarizeCommissions(
      [new Map([[7, { accruedMinor: 35000, earnedMinor: 20000 }]])],
      new Map([[7, 12000], [9, 5000]]),
    );
    const seven = summary.find((row) => row.doctorId === 7)!;
    expect(seven.dueMinor).toBe(8000);
    // طبيبٌ صُرف له بلا استحقاق محسوب يجب أن يُرى لا أن يختفي من التقرير.
    const nine = summary.find((row) => row.doctorId === 9)!;
    expect(nine.earnedMinor).toBe(0);
    expect(nine.dueMinor).toBe(-5000);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * خصم تكلفة المختبر
 *
 * قرارُ المالك، ومكتوبٌ في ذاكرة المشروع: **العمولة المكتسبة من التحصيل الفعلي
 * مع خصم تكاليف المختبر**. وبلا الخصم تُدفع النسبة على مالٍ خرج أكثرُه إلى
 * المختبر: تاجٌ بستّين ألفًا تكلفة تركيبه عشرون، ونسبة الطبيب أربعون بالمئة —
 * فيُصرف له أربعةٌ وعشرون ألفًا من أربعين هي كلُّ ما بقي للمركز، بدل ستّة عشر.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("خصم تكلفة المختبر من العمولة", () => {
  const row = (over: Partial<{ doctorId: number; accruedMinor: number; earnedMinor: number; paidMinor: number }> = {}) => ({
    doctorId: 1, accruedMinor: 24_000, earnedMinor: 24_000, paidMinor: 0, ...over,
  });

  it("**مثال التاج** — ستّون ألفًا ومختبرٌ بعشرين ونسبةٌ أربعون بالمئة", () => {
    // العمولة على المحصّل ٢٤٬٠٠٠، وتكلفة المختبر ٢٠٬٠٠٠ × ٤٠٪ ليست القاعدة:
    // القاعدة أنّ التكلفة تُخصم كاملةً من مكتسبه، فيبقى ٤٠٪ من ٤٠٬٠٠٠ = ١٦٬٠٠٠.
    const [result] = deductLabCost([row()], new Map([[1, 8_000]]), true);
    expect(result.earnedMinor).toBe(24_000);
    expect(result.labCostMinor).toBe(8_000);
    expect(result.netEarnedMinor).toBe(16_000);
    expect(result.dueMinor).toBe(16_000);
  });

  it("ومُطفَأً لا يُخصم شيء — والرقم هو رقم اليوم", () => {
    const [result] = deductLabCost([row()], new Map([[1, 8_000]]), false);
    expect(result.labCostMinor).toBe(0);
    expect(result.netEarnedMinor).toBe(24_000);
    expect(result.dueMinor).toBe(24_000);
  });

  it("**ولا ينزل الصافي تحت الصفر** — العمولة لا تصير دَينًا على الطبيب", () => {
    const [result] = deductLabCost([row({ earnedMinor: 5_000 })], new Map([[1, 12_000]]), true);
    expect(result.netEarnedMinor).toBe(0);
    expect(result.uncoveredLabCostMinor).toBe(7_000);
    expect(result.dueMinor).toBe(0);
  });

  it("والفائض يُعرض ولا يُرحَّل — فلا تأكل تكلفةُ شهرٍ عمولةَ شهرٍ آخر", () => {
    // الفائض رقمٌ في صفّه، لا طرحٌ صامتٌ من مدّةٍ تالية.
    const [result] = deductLabCost([row({ earnedMinor: 0 })], new Map([[1, 9_000]]), true);
    expect(result.uncoveredLabCostMinor).toBe(9_000);
    expect(result.netEarnedMinor).toBe(0);
  });

  it("وما صُرف يُطرح من الصافي لا من المكتسب", () => {
    const [result] = deductLabCost([row({ paidMinor: 10_000 })], new Map([[1, 8_000]]), true);
    expect(result.netEarnedMinor).toBe(16_000);
    expect(result.dueMinor).toBe(6_000);
  });

  it("وطبيبٌ بلا تكلفة لا يتغيّر حسابه", () => {
    const [result] = deductLabCost([row()], new Map(), true);
    expect(result.labCostMinor).toBe(0);
    expect(result.netEarnedMinor).toBe(24_000);
  });

  it("وتكلفةٌ سالبة — بيانٌ فاسد — لا تزيد عمولة أحد", () => {
    const [result] = deductLabCost([row()], new Map([[1, -5_000]]), true);
    expect(result.labCostMinor).toBe(0);
    expect(result.netEarnedMinor).toBe(24_000);
  });

  it("والحصيلة تُظهر طبيبًا عليه تكلفة ولا عمولة له في المدّة", () => {
    // فأمرُ مختبرٍ بلا فاتورةٍ محصّلة بعدُ حقيقةٌ تخصّه، وإخفاؤه يجعل تكلفةً
    // قائمة لا تُرى في الشاشة التي بُنيت لتُريها.
    const rows = summarizeCommissions([], new Map(), new Map([[9, 3_000]]), true);
    expect(rows.map((one) => one.doctorId)).toContain(9);
    const nine = rows.find((one) => one.doctorId === 9)!;
    expect(nine.uncoveredLabCostMinor).toBe(3_000);
  });

  it("ومُطفَأً لا يظهر — فلا يُعرض صفٌّ لا معنى له", () => {
    expect(summarizeCommissions([], new Map(), new Map([[9, 3_000]]), false)).toEqual([]);
  });
});
