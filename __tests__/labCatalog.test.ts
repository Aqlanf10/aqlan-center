import { describe, expect, it } from "vitest";
import {
  isLabCategory, overlaps, priceGap, priceOn, readService, type LabPrice,
} from "../lib/labCatalog";

const price = (over: Partial<LabPrice> & { id: number }): LabPrice => ({
  partyId: 1, serviceId: 1, costMinor: 20_000, currency: "YER",
  effectiveFrom: "2026-01-01", effectiveTo: null, ...over,
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * السعر بتاريخ سريانه
 *
 * فالمركز يتّفق مع مختبرٍ على تاجٍ بكذا، ثم يرفع المختبر سعره. وأمرٌ أُرسل قبل
 * الرفع سعرُه سعرُ يومه — ومراجعةُ فاتورة الشهر الماضي بسعر اليوم تُنتج خلافًا
 * مع المختبر لا حكم فيه.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("السعر الساري يوم العمل", () => {
  it("يُختار ما كان ساريًا يومها لا سعر اليوم", () => {
    const prices = [
      price({ id: 1, costMinor: 20_000, effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" }),
      price({ id: 2, costMinor: 26_000, effectiveFrom: "2026-06-01" }),
    ];
    expect(priceOn(prices, 1, 1, "2026-03-15")?.costMinor).toBe(20_000);
    expect(priceOn(prices, 1, 1, "2026-09-01")?.costMinor).toBe(26_000);
    // وعلى الحدّين تمامًا.
    expect(priceOn(prices, 1, 1, "2026-05-31")?.costMinor).toBe(20_000);
    expect(priceOn(prices, 1, 1, "2026-06-01")?.costMinor).toBe(26_000);
  });

  it("**ولا سعر يعني لا سعر — لا صفرًا**", () => {
    // صفرٌ يعني «مجّانًا» في الحساب، فيظهر عملُ مختبرٍ بلا تكلفة وتظهر العيادة
    // رابحة وهي مدينة.
    expect(priceOn([], 1, 1, "2026-09-01")).toBeNull();
    expect(priceOn([price({ id: 1, effectiveFrom: "2026-10-01" })], 1, 1, "2026-09-01")).toBeNull();
    expect(priceOn([price({ id: 1, effectiveTo: "2026-08-31" })], 1, 1, "2026-09-01")).toBeNull();
  });

  it("ولكلّ مختبرٍ سعرُه — ولا يُستعار سعر مختبرٍ لآخر", () => {
    const prices = [
      price({ id: 1, partyId: 1, costMinor: 20_000 }),
      price({ id: 2, partyId: 2, costMinor: 31_000 }),
    ];
    expect(priceOn(prices, 1, 1, "2026-09-01")?.costMinor).toBe(20_000);
    expect(priceOn(prices, 2, 1, "2026-09-01")?.costMinor).toBe(31_000);
    expect(priceOn(prices, 3, 1, "2026-09-01")).toBeNull();
  });

  it("ولكلّ خدمةٍ سعرُها عند المختبر الواحد", () => {
    const prices = [
      price({ id: 1, serviceId: 1, costMinor: 20_000 }),
      price({ id: 2, serviceId: 2, costMinor: 45_000 }),
    ];
    expect(priceOn(prices, 1, 2, "2026-09-01")?.costMinor).toBe(45_000);
  });

  it("وقاعدةٌ قديمة نُسي إغلاقها لا تغلب الأحدث", () => {
    const prices = [
      price({ id: 1, costMinor: 20_000, effectiveFrom: "2026-01-01" }),
      price({ id: 2, costMinor: 26_000, effectiveFrom: "2026-06-01" }),
    ];
    expect(priceOn(prices, 1, 1, "2026-09-01")?.costMinor).toBe(26_000);
  });

  it("وعند تساوي يوم السريان يُؤخذ الأحدث إدخالًا — تصحيحُ خطأ", () => {
    const prices = [
      price({ id: 1, costMinor: 20_000, effectiveFrom: "2026-06-01" }),
      price({ id: 2, costMinor: 22_000, effectiveFrom: "2026-06-01" }),
    ];
    expect(priceOn(prices, 1, 1, "2026-06-10")?.costMinor).toBe(22_000);
  });
});

describe("التداخل يُمنع عند الإدخال", () => {
  const open = price({ id: 1, effectiveFrom: "2026-01-01" });
  const closed = price({ id: 2, effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" });

  it("فلا مدّتان تشملان يومًا واحدًا", () => {
    const verdict = overlaps([open], { partyId: 1, serviceId: 1, effectiveFrom: "2026-06-01", effectiveTo: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("يتداخل");
  });

  it("والمتجاورتان تُقبلان — يومٌ ينتهي ويومٌ يبدأ", () => {
    expect(overlaps([closed], { partyId: 1, serviceId: 1, effectiveFrom: "2026-06-01", effectiveTo: null }).ok).toBe(true);
  });

  it("ونهايةٌ قبل بدايةٍ تُرفض", () => {
    const verdict = overlaps([], { partyId: 1, serviceId: 1, effectiveFrom: "2026-06-01", effectiveTo: "2026-05-01" });
    expect(verdict.ok).toBe(false);
  });

  it("ومختبرٌ آخر أو خدمةٌ أخرى لا تتداخل", () => {
    expect(overlaps([open], { partyId: 2, serviceId: 1, effectiveFrom: "2026-01-01", effectiveTo: null }).ok).toBe(true);
    expect(overlaps([open], { partyId: 1, serviceId: 2, effectiveFrom: "2026-01-01", effectiveTo: null }).ok).toBe(true);
  });

  it("وتعديلُ سعرٍ لا يتداخل مع نفسه", () => {
    expect(overlaps([open], { partyId: 1, serviceId: 1, effectiveFrom: "2026-01-01", effectiveTo: null, id: 1 }).ok).toBe(true);
  });
});

describe("الفرق بين المتّفق والمكتوب", () => {
  it("يُقال ولا يُمنع", () => {
    // فقد يتّفق الطبيب على سعرٍ خاصّ لحالة. وإنما فرقٌ يمرّ بلا أن يُرى مرّةً
    // يمرّ كلَّ مرّة، وآخرُ الشهر تأتي فاتورةٌ لا تشبه ما اتُّفق عليه.
    expect(priceGap(20_000, 26_000)).toEqual({ differs: true, deltaMinor: 6_000 });
    expect(priceGap(20_000, 14_000)).toEqual({ differs: true, deltaMinor: -6_000 });
    expect(priceGap(20_000, 20_000)).toEqual({ differs: false, deltaMinor: 0 });
  });

  it("ولا سعر متّفقًا يعني لا مقارنة — لا فرقًا يساوي التكلفة كلَّها", () => {
    expect(priceGap(null, 26_000).differs).toBe(false);
    expect(priceGap(20_000, null).differs).toBe(false);
  });
});

describe("قراءة الخدمة", () => {
  it("تحتاج اسمًا", () => {
    expect(readService({ name: "" }).ok).toBe(false);
    expect(readService({ name: "ت" }).ok).toBe(false);
    expect(readService({ name: "تاج زيركون" }).ok).toBe(true);
  });

  it("والمهلة بين يومٍ و120", () => {
    expect(readService({ name: "تاج", defaultDays: 0 }).ok).toBe(false);
    expect(readService({ name: "تاج", defaultDays: 200 }).ok).toBe(false);
    expect(readService({ name: "تاج", defaultDays: 1.5 }).ok).toBe(false);
    expect(readService({ name: "تاج", defaultDays: 10 }).ok).toBe(true);
  });

  it("وتصنيفٌ غير معروف يُرفض ولا يُبدَّل صامتًا", () => {
    expect(readService({ name: "تاج", category: "زرع" }).ok).toBe(false);
    const good = readService({ name: "تاج", category: "ortho" });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.category).toBe("ortho");
  });

  it("واللون مطلوبٌ افتراضًا ويُلغى صراحةً", () => {
    const on = readService({ name: "تاج" });
    expect(on.ok && on.value.requiresShade).toBe(true);
    const off = readService({ name: "جهاز تقويم", requiresShade: false });
    expect(off.ok && off.value.requiresShade).toBe(false);
  });

  it("والتصنيفات المعروفة وحدها", () => {
    expect(isLabCategory("prostho")).toBe(true);
    expect(isLabCategory("زرع")).toBe(false);
    expect(isLabCategory(null)).toBe(false);
  });
});
