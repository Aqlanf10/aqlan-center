import { describe, expect, it } from "vitest";
import { FULL_RATE_BP, materialCost, parseRateBp, ratePercentText } from "../lib/materialRate";
import { commissionForPatient, deductCosts, type CommissionInvoice } from "../lib/commission";

describe("قراءة نسبة الإهلاك", () => {
  it("تُقرأ بالكسر وتُخزَّن نقاطَ أساس", () => {
    expect(parseRateBp("7.5")).toBe(750);
    expect(parseRateBp("0")).toBe(0);
    expect(parseRateBp("100")).toBe(FULL_RATE_BP);
  });

  it("وتُقبل بعلامة النسبة وبالفواصل — يكتبها الناس هكذا", () => {
    expect(parseRateBp("7.5%")).toBe(750);
    expect(parseRateBp("٧٫٥".replace("٧", "7").replace("٫", ".").replace("٥", "5"))).toBe(750);
  });

  /*
   * **والسقف مئةٌ بالمئة.**
   *
   * فنسبةٌ فوقه تعني موادَّ كلّفت أكثر ممّا حُصّل من العمل: تأكل العمولة كلَّها
   * ويبقى فائضٌ يظهر «غير مُغطّى» — ولا معنى له إلا أنّ أحدًا كتب ٧٥٠ حيث أراد ٧٫٥.
   */
  it("وما فوق المئة يُردّ — ٧٥٠ حيث أُريد ٧٫٥", () => {
    expect(parseRateBp("750")).toBeNull();
    expect(parseRateBp("100.01")).toBeNull();
  });

  it("والسالب يُردّ — إهلاكٌ سالب يزيد عمولة الطبيب", () => {
    expect(parseRateBp("-5")).toBeNull();
  });

  it("وما ليس رقمًا يُردّ ولا يُقرأ صفرًا", () => {
    // وصفرٌ صامت هنا يقول «هذا العمل بلا موادّ» — وهو غيرُ ما كُتب.
    expect(parseRateBp("كثير")).toBeNull();
    expect(parseRateBp("")).toBeNull();
    expect(parseRateBp(null)).toBeNull();
  });

  it("والنصّ يعود كما كُتب", () => {
    expect(ratePercentText(750)).toBe("7.5");
    expect(ratePercentText(0)).toBe("0");
    expect(ratePercentText(1_250)).toBe("12.5");
  });
});

describe("تكلفة المواد المقدَّرة", () => {
  it("تُقاس على المحصَّل في كل تخصّصٍ بنسبته", () => {
    const covered = new Map<string | null, number>([["ortho", 100_000], ["exam", 20_000]]);
    const rates = new Map([["ortho", 1_500], ["exam", 200]]);   // ١٥٪ و٢٪
    expect(materialCost(covered, rates).costMinor).toBe(15_000 + 400);
  });

  /*
   * **وتخصّصٌ بلا نسبةٍ لا يُخصم منه، ويُقال كم هو.**
   *
   * فصفرٌ صامت يقول «لا موادّ لهذا العمل»، والحقيقة أنّ المالك لم يقرّر نسبته
   * بعد. والفرق بينهما مالٌ يُخصم أو لا يُخصم من عمولة طبيب.
   */
  it("وتخصّصٌ بلا نسبةٍ يُعرض ولا يُقدَّر", () => {
    const covered = new Map<string | null, number>([["ortho", 100_000], ["crown", 50_000]]);
    const result = materialCost(covered, new Map([["ortho", 1_000]]));
    expect(result.costMinor).toBe(10_000);
    expect(result.unratedCoveredMinor).toBe(50_000);
  });

  it("وبندٌ بلا تخصّصٍ أصلًا يُعدّ بلا نسبة — لا يُقدَّر بمتوسّط", () => {
    // كُتب باليد بلا خدمةٍ من الدليل، ولا يُعرف ما هو.
    const result = materialCost(new Map([[null, 30_000]]), new Map([["ortho", 1_000]]));
    expect(result.costMinor).toBe(0);
    expect(result.unratedCoveredMinor).toBe(30_000);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * الخصم من العمولة — **وهو الموضع الذي يُخطأ فيه**.
 *
 * فطرحُ التكلفة كاملةً من المكتسب يعطي `نسبة × محصّل − تكلفة`، وهو أقلُّ بكثير من
 * `نسبة × (محصّل − تكلفة)` المقصودة. وهو الخطأ نفسه الذي كُشف في حصّة المختبر
 * وكلّف طبيبًا ثلثي عمولته في مثال المالك.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("خصم الإهلاك من العمولة", () => {
  const covered = new Map<string | null, number>([["ortho", 100_000]]);
  const rates = new Map([["ortho", 1_000]]);   // ١٠٪
  const row = (over: Record<string, unknown> = {}) => ({
    doctorId: 1, accruedMinor: 40_000, earnedMinor: 40_000, paidMinor: 0,
    coveredByCategory: covered, ...over,
  });
  const forty = new Map([[1, 40]]);

  it("**نسبته × (المحصَّل − الإهلاك)** — لا المكتسب ناقص الإهلاك كاملًا", () => {
    const [result] = deductCosts([row()], new Map(), forty, false, rates, true);
    expect(result.materialCostMinor).toBe(10_000);       // ١٠٪ × ١٠٠٬٠٠٠
    expect(result.materialShareMinor).toBe(4_000);       // ٤٠٪ × ١٠٬٠٠٠
    expect(result.netEarnedMinor).toBe(36_000);          // ٤٠٪ × (١٠٠٬٠٠٠ − ١٠٬٠٠٠)
    // ولو طُرح الإهلاك كاملًا لصار ٣٠٬٠٠٠ — أقلَّ بستّة آلاف بلا وجه.
    expect(result.netEarnedMinor).not.toBe(30_000);
  });

  it("والمعادلة تصدق لأيّ نسبة", () => {
    for (const percent of [10, 25, 40, 60, 100]) {
      const collected = 100_000;
      const wear = 10_000;
      const [result] = deductCosts(
        [row({ earnedMinor: Math.round((collected * percent) / 100) })],
        new Map(), new Map([[1, percent]]), false, rates, true,
      );
      expect(result.netEarnedMinor, `${percent}%`)
        .toBe(Math.round(((collected - wear) * percent) / 100));
    }
  });

  it("ومُطفَأً لا يُخصم شيء — والمفتاحان مستقلّان", () => {
    const [result] = deductCosts([row()], new Map(), forty, false, rates, false);
    expect(result.materialCostMinor).toBe(0);
    expect(result.materialShareMinor).toBe(0);
    expect(result.netEarnedMinor).toBe(40_000);
  });

  /*
   * والخصمان يجتمعان على المكتسب نفسه.
   *
   * ولا يُطرح أحدهما من ناتج الآخر: طرحٌ متتابع يخصم نسبةً من نسبة، فيخرج رقمٌ
   * لا يوافق «نسبته × (المحصَّل − التكاليف)» التي وُعد بها الطبيب.
   */
  it("والمختبر والمواد يُخصمان معًا من المكتسب — لا أحدهما من ناتج الآخر", () => {
    const [result] = deductCosts(
      [row()], new Map([[1, 20_000]]), forty, true, rates, true,
    );
    expect(result.labShareMinor).toBe(8_000);        // ٤٠٪ × ٢٠٬٠٠٠
    expect(result.materialShareMinor).toBe(4_000);   // ٤٠٪ × ١٠٬٠٠٠
    expect(result.netEarnedMinor).toBe(28_000);      // ٤٠٪ × (١٠٠٬٠٠٠ − ٢٠٬٠٠٠ − ١٠٬٠٠٠)
  });

  it("**ولا ينزل الصافي تحت الصفر** — والفائض يجمع الخصمين", () => {
    const [result] = deductCosts(
      [row({ earnedMinor: 5_000 })], new Map([[1, 20_000]]), forty, true, rates, true,
    );
    expect(result.netEarnedMinor).toBe(0);
    expect(result.uncoveredLabCostMinor).toBe(7_000);   // ٨٬٠٠٠ + ٤٬٠٠٠ − ٥٬٠٠٠
  });

  it("وما لا نسبةَ لتخصّصه يظهر ولا يُخصم", () => {
    const [result] = deductCosts(
      [row({ coveredByCategory: new Map([["crown", 60_000]]) })],
      new Map(), forty, false, rates, true,
    );
    expect(result.materialShareMinor).toBe(0);
    expect(result.unratedCoveredMinor).toBe(60_000);
    expect(result.netEarnedMinor).toBe(40_000);
  });
});

/*
 * والأساسُ **المحصَّل من العمل** لا المفوتَر ولا العمولة عليه.
 *
 * فلو قيس على المفوتَر لصار الطبيب مدينًا بموادّ مريضٍ لم يدفع — وهو بالضبط ما
 * بُني حساب العمولة كلُّه ليتجنّبه.
 */
describe("أساس النسبة", () => {
  const invoice = (over: Partial<CommissionInvoice> = {}): CommissionInvoice => ({
    id: 1, netMinor: 100_000, createdAt: "2026-08-01T10:00:00Z",
    doctorShares: [{ doctorId: 7, amountMinor: 100_000, category: "ortho" }], ...over,
  });

  it("المحصَّل موزَّعٌ بالتخصّص، لا المفوتَر", () => {
    // نصفُ الفاتورة مدفوع، فنصفُ العمل هو ما يُقاس عليه الإهلاك.
    const result = commissionForPatient([invoice()], 50_000, new Map([[7, 40]]));
    expect(result.get(7)?.coveredByCategory.get("ortho")).toBe(50_000);
  });

  it("وفاتورةٌ بلا تحصيل لا إهلاكَ عليها", () => {
    const result = commissionForPatient([invoice()], 0, new Map([[7, 40]]));
    expect(result.get(7)?.coveredByCategory.get("ortho")).toBe(0);
  });

  it("وتخصّصان في فاتورةٍ واحدة يُفصلان", () => {
    const mixed = invoice({
      doctorShares: [
        { doctorId: 7, amountMinor: 60_000, category: "ortho" },
        { doctorId: 7, amountMinor: 40_000, category: "exam" },
      ],
    });
    const result = commissionForPatient([mixed], 100_000, new Map([[7, 40]]));
    expect(result.get(7)?.coveredByCategory.get("ortho")).toBe(60_000);
    expect(result.get(7)?.coveredByCategory.get("exam")).toBe(40_000);
  });
});
