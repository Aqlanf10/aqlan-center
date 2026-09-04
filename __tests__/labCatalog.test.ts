import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isLabCategory, overlaps, planReplacement, priceGap, priceOn, readService,
  serviceForWorkType, type LabPrice,
} from "../lib/labCatalog";
import { WORK_TYPES } from "../lib/lab";

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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * استبدال السعر النافذ في يومه
 *
 * وهو **أشيع سير عملٍ في الوحدة**: يرفع المختبر سعره فيُسجَّل اليوم. والحدود
 * شاملة في الطرفين، فإغلاق القديم اليوم وبدء الجديد اليوم يجعلان يومًا واحدًا
 * له سعران — فيُردّ المالك «يتداخل» في أكثر ما يفعل، ولا سبيل في الشاشة لإغلاق
 * القديم أمس.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("استبدال سعرٍ نافذٍ اليوم", () => {
  const live = price({ id: 1, costMinor: 20_000, effectiveFrom: "2026-01-01", effectiveTo: null });

  it("يُغلق القديم في اليوم السابق — فلا يومَ له سعران", () => {
    const plan = planReplacement([live], {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-04", effectiveTo: null,
    });
    expect(plan.closeIds).toEqual([1]);
    expect(plan.closeOn).toBe("2026-09-03");
    expect(plan.blocking).toBeNull();
    // وما بقي بعد الإغلاق يقبل الجديد — وهذا هو الفحص كلُّه.
    expect(overlaps(plan.remaining, {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-04", effectiveTo: null,
    }).ok).toBe(true);
  });

  it("**وبلا استبدالٍ يُردّ — وهو العطب بعينه**", () => {
    // القديم أُغلق اليوم والجديد يبدأ اليوم: يومٌ واحد بسعرين.
    const closedToday = price({ id: 1, effectiveFrom: "2026-01-01", effectiveTo: "2026-09-04" });
    expect(overlaps([closedToday], {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-04", effectiveTo: null,
    }).ok).toBe(false);
  });

  it("ولا يضيع تاريخ القديم — يبقى صفُّه ببدايته وتنتهي مدّته", () => {
    const plan = planReplacement([live], {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-04", effectiveTo: null,
    });
    const old = plan.remaining.find((one) => one.id === 1);
    expect(old?.effectiveFrom).toBe("2026-01-01");
    expect(old?.effectiveTo).toBe("2026-09-03");
    expect(old?.costMinor).toBe(20_000);
  });

  it("ويعبر أوّل الشهر وأوّل السنة", () => {
    expect(planReplacement([live], {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-01", effectiveTo: null,
    }).closeOn).toBe("2026-08-31");
    expect(planReplacement([live], {
      partyId: 1, serviceId: 1, effectiveFrom: "2027-01-01", effectiveTo: null,
    }).closeOn).toBe("2026-12-31");
  });

  it("ولا يمسّ ما لا يتداخل — لا مختبرًا آخر ولا مدّةً منتهية", () => {
    const other = price({ id: 2, partyId: 2 });
    const past = price({ id: 3, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" });
    const plan = planReplacement([live, other, past], {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-04", effectiveTo: null,
    });
    expect(plan.closeIds).toEqual([1]);
    expect(plan.remaining.find((one) => one.id === 3)?.effectiveTo).toBe("2025-12-31");
  });

  it("**وسعرٌ يبدأ في اليوم نفسه لا يُغلق أمس — نهايةٌ قبل بداية**", () => {
    // والقيد في القاعدة يمنعها، فيُقال أيُّ سعرٍ منع لا «تعذّر الحفظ».
    const sameDay = price({ id: 4, effectiveFrom: "2026-09-04" });
    const plan = planReplacement([sameDay], {
      partyId: 1, serviceId: 1, effectiveFrom: "2026-09-04", effectiveTo: null,
    });
    expect(plan.closeIds).toEqual([]);
    expect(plan.blocking?.id).toBe(4);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * الخدمة المعروضة هي المرسَلة
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("الخيار المعروض في قائمة نوع العمل", () => {
  const services = [
    { id: 7, name: WORK_TYPES[0], defaultDays: 10 },
    { id: 8, name: "تاج زيركون", defaultDays: 12 },
  ];

  it("**قبولُ المعروض دون لمسه يُرسل رقم الخدمة**", () => {
    /*
     * والقائمة تعرض الكتالوج أوّلًا وتُسقط من القديم ما يساويه اسمًا. فحين يحمل
     * الكتالوج «تاج» — وهي القيمة الابتدائية — يحلّ خيارُ الكتالوج محلّ القديم
     * بالقيمة نفسها، فلا يقع `onChange` ولا يُملأ رقمٌ محفوظ على حدة.
     */
    expect(serviceForWorkType(services, WORK_TYPES[0])?.id).toBe(7);
  });

  it("ونوعٌ قديم ليس في الكتالوج يبقى نصًّا حرًّا — لا رقمًا مخترعًا", () => {
    expect(serviceForWorkType(services, "جسر")).toBeNull();
    expect(serviceForWorkType([], WORK_TYPES[0])).toBeNull();
  });
});

/*
 * وحارسٌ على الشاشة نفسها: المنطق أعلاه لا ينفع إن احتفظت الشاشة برقمٍ في حالةٍ
 * تُملأ عند التغيير وحده — وذاك كان العطب. والفحص على المصدر لأنّ لا DOM هنا.
 */
describe("شاشة المختبر تشتقّ الرقم ولا تحفظه", () => {
  const page = readFileSync(new URL("../app/lab/page.tsx", import.meta.url), "utf8");

  it("لا حالةَ `serviceId` تُملأ عند التغيير وحده", () => {
    expect(page).not.toMatch(/useState[^\n]*\bserviceId\b/);
    expect(page).not.toMatch(/setServiceId/);
  });

  it("والمرسَل مشتقٌّ من المعروض", () => {
    expect(page).toContain("serviceForWorkType(services, workType)");
    expect(page).toMatch(/serviceId: chosenService/);
  });
});
