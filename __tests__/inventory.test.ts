import { describe, expect, it } from "vitest";
import {
  deriveBalance, expiryState, filterItems, formatQty, inventorySummary,
  isItemCategory, isMovementKind, nearestExpiry, needsAttention, netMaterials,
  outstandingReturn, signedQty, sortByNeed, stockStatus, validateMovement,
} from "../lib/inventory";

describe("أثر الحركة على الرصيد", () => {
  it("الإدخال يزيد والصرف ينقص", () => {
    expect(signedQty("in", 10)).toBe(10);
    expect(signedQty("out", 4)).toBe(-4);
  });

  it("والصرف ينقص ولو أُرسل سالبًا — فلا يُزاد بصرفٍ مقلوب", () => {
    // موظفٌ يكتب «‎-3» في خانة الصرف يقصد النقص لا الزيادة.
    expect(signedQty("out", -3)).toBe(-3);
    expect(signedQty("in", -3)).toBe(3);
  });

  it("والتسوية تحمل إشارتها — وهي وحدها التي تنقص وتزيد", () => {
    expect(signedQty("adjust", -2.5)).toBe(-2.5);
    expect(signedQty("adjust", 2.5)).toBe(2.5);
  });

  it("والرصيد مجموعُها لا عمودٌ يُحدَّث", () => {
    expect(deriveBalance([
      { kind: "in", qty: 12 }, { kind: "out", qty: 5 },
      { kind: "adjust", qty: -1 }, { kind: "in", qty: 3 },
    ])).toBe(9);
  });

  it("ورصيدٌ بلا حركاتٍ صفر", () => {
    expect(deriveBalance([])).toBe(0);
  });
});

describe("فحص الحركة قبل كتابتها", () => {
  it("لا صرفَ فوق الرصيد", () => {
    const check = validateMovement("out", 5, null, 3);
    expect(check.ok).toBe(false);
    expect(check.message).toContain("لا يكفي");
  });

  it("والصرف بالرصيد كلّه مقبول — الحدّ ليس ما دونه", () => {
    expect(validateMovement("out", 3, null, 3).ok).toBe(true);
  });

  it("ولا كميةَ صفر ولا سالبة في الإدخال والصرف", () => {
    expect(validateMovement("in", 0, null, 10).ok).toBe(false);
    expect(validateMovement("out", -2, null, 10).ok).toBe(false);
  });

  it("والتسوية بلا سببٍ مرفوضة — وهي البابُ الوحيد الذي يُغيّر الرصيد بلا مستند", () => {
    expect(validateMovement("adjust", -4, null, 10).ok).toBe(false);
    expect(validateMovement("adjust", -4, "   ", 10).ok).toBe(false);
    expect(validateMovement("adjust", -4, "جردٌ شهري: نقص أربع علب", 10).ok).toBe(true);
  });

  it("والتسوية الصفرية مرفوضة — إن وافق الجرد السجلّ فلا حركة", () => {
    expect(validateMovement("adjust", 0, "جرد", 10).ok).toBe(false);
  });

  it("والتسوية تُنقص تحت الصفر إن كان ذلك واقع الجرد", () => {
    // النقص المسجَّل حقيقةٌ تُوثَّق لا تُخفى: صرفٌ بلا إدخالٍ يجب أن يظهر.
    expect(validateMovement("adjust", -20, "جرد: البند مفقود", 5).ok).toBe(true);
  });

  it("وكميةٌ غير رقمية مرفوضة", () => {
    expect(validateMovement("in", Number.NaN, null, 0).ok).toBe(false);
  });
});

describe("موضع البند من حدّ الطلب", () => {
  it("الصفر وما دونه منتهٍ", () => {
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(-3, 5)).toBe("out");
  });

  it("ودون الحدّ تحت الطلب، وعنده متوفّر", () => {
    expect(stockStatus(4, 5)).toBe("low");
    expect(stockStatus(5, 5)).toBe("ok");
  });

  it("وبلا حدٍّ مضبوط لا يُقال «تحت الطلب» لبندٍ موجود", () => {
    expect(stockStatus(1, 0)).toBe("ok");
  });
});

describe("الصلاحية — باليوم المُمرَّر لا بساعة الخادم", () => {
  const today = "2026-09-01";

  it("اليوم نفسه منتهية — لا تُصرف مادّةٌ تنتهي اليوم", () => {
    expect(expiryState("2026-09-01", today)).toBe("expired");
    expect(expiryState("2026-08-20", today)).toBe("expired");
  });

  it("وشهرٌ فأقلّ قريبة", () => {
    expect(expiryState("2026-09-20", today)).toBe("soon");
    expect(expiryState("2026-10-01", today)).toBe("soon");
  });

  it("وما بعده سارية", () => {
    expect(expiryState("2026-10-02", today)).toBe("ok");
  });
});

describe("العرض والتحقق", () => {
  it("الكمية بلا أصفارٍ زائدة", () => {
    expect(formatQty(2.5)).toBe("2.5");
    expect(formatQty(3)).toBe("3");
  });

  it("والأنواع تُرفض إن لم تُعرف", () => {
    expect(isMovementKind("out")).toBe(true);
    expect(isMovementKind("delete")).toBe(false);
    expect(isItemCategory("ortho")).toBe(true);
    expect(isItemCategory("gold")).toBe(false);
  });
});

describe("أقرب صلاحيةٍ باقية — لا أقرب صلاحيةٍ دخلت", () => {
  it("بلا صرفٍ تُعاد أقرب دفعة", () => {
    expect(nearestExpiry([
      { id: 1, kind: "in", qty: 5, expiryDate: "2026-12-01" },
      { id: 2, kind: "in", qty: 5, expiryDate: "2026-06-01" },
    ])).toBe("2026-06-01");
  });

  it("ودفعةٌ صُرفت كلّها لا تُنبَّه — وهذا هو الفرق بين تنبيهٍ يُصدَّق وآخر يُتجاهَل", () => {
    expect(nearestExpiry([
      { id: 1, kind: "in", qty: 5, expiryDate: "2026-06-01" },
      { id: 2, kind: "in", qty: 5, expiryDate: "2026-12-01" },
      { id: 3, kind: "out", qty: 5 },
    ])).toBe("2026-12-01");
  });

  it("وبقيّةُ دفعةٍ تُنبَّه — الصرف الجزئي لا يُسقطها", () => {
    expect(nearestExpiry([
      { id: 1, kind: "in", qty: 5, expiryDate: "2026-06-01" },
      { id: 2, kind: "in", qty: 5, expiryDate: "2026-12-01" },
      { id: 3, kind: "out", qty: 4 },
    ])).toBe("2026-06-01");
  });

  it("والتسوية السالبة تستهلك كالصرف، والموجبة لا تُنشئ دفعة", () => {
    expect(nearestExpiry([
      { id: 1, kind: "in", qty: 3, expiryDate: "2026-06-01" },
      { id: 2, kind: "in", qty: 3, expiryDate: "2026-12-01" },
      { id: 3, kind: "adjust", qty: -3 },
    ])).toBe("2026-12-01");
    expect(nearestExpiry([
      { id: 1, kind: "in", qty: 3, expiryDate: "2026-06-01" },
      { id: 2, kind: "adjust", qty: 10 },
    ])).toBe("2026-06-01");
  });

  it("وحركاتٌ بلا صلاحيةٍ مسجّلة لا صلاحية لها", () => {
    expect(nearestExpiry([{ id: 1, kind: "in", qty: 4 }, { id: 2, kind: "out", qty: 1 }])).toBeNull();
  });

  it("وصُرف كل ما دخل — فلا دفعةَ باقية تُنبَّه بها", () => {
    expect(nearestExpiry([
      { id: 1, kind: "in", qty: 2, expiryDate: "2026-06-01" },
      { id: 2, kind: "out", qty: 2 },
    ])).toBeNull();
  });
});

describe("ما تعرضه الشاشة", () => {
  const today = "2026-06-01";
  const item = (over: Partial<Parameters<typeof needsAttention>[0]> & { name: string }) => ({
    status: "ok" as const, isActive: true, nearestExpiry: null, ...over,
  });

  const items = [
    item({ name: "قفازات", status: "out" }),
    item({ name: "بنج", status: "low" }),
    item({ name: "أسلاك", nearestExpiry: "2026-06-20" }),
    item({ name: "حشوات" }),
    item({ name: "قديم", isActive: false, status: "out" }),
  ];

  it("«يحتاج تصرّفًا» يجمع النافد والمقارب وقريب الانتهاء ولا شيء غيرها", () => {
    expect(filterItems(items, "attention", today).map((one) => one.name))
      .toEqual(["قفازات", "بنج", "أسلاك"]);
  });

  it("و«الكل» تستثني الموقوفة، و«الموقوفة» لا تعرض غيرها", () => {
    expect(filterItems(items, "all", today).map((one) => one.name))
      .toEqual(["قفازات", "بنج", "أسلاك", "حشوات"]);
    expect(filterItems(items, "inactive", today).map((one) => one.name)).toEqual(["قديم"]);
  });

  it("وبندٌ موقوف لا يحتاج تصرّفًا مهما كان رصيده — لا يُصرف منه أصلًا", () => {
    expect(needsAttention(items[4], today)).toBe(false);
  });

  it("والترتيب بالحاجة لا بالحرف — النافد أولًا", () => {
    expect(sortByNeed(items, today).map((one) => one.name)[0]).toBe("قفازات");
    expect(sortByNeed(items, today).map((one) => one.name).at(-1)).toBe("قديم");
  });

  it("والأرقام تُحسب من البنود نفسها ولا تعدّ الموقوفة", () => {
    expect(inventorySummary(items, today)).toEqual({ out: 1, low: 1, expiring: 1 });
  });
});

describe("صافي مواد الزيارة", () => {
  const material = (over: Partial<Parameters<typeof netMaterials>[0][number]>) => ({
    itemId: 1, itemName: "قفازات", unit: "علبة", kind: "out" as const, qty: 1, ...over,
  });

  it("المصروف يُجمع لبندٍ بندٍ", () => {
    expect(netMaterials([material({ qty: 2 }), material({ qty: 3 })]))
      .toEqual([{ itemId: 1, name: "قفازات", unit: "علبة", used: 5 }]);
  });

  it("والمردود يُطرح من الصافي — ولا تُحذف حركته", () => {
    expect(netMaterials([
      material({ qty: 2 }), material({ kind: "in", qty: 1, isReturn: true }),
    ])[0].used).toBe(1);
  });

  it("وبندٌ رُدّ كلّه يبقى بصفرٍ لا يختفي — صرفٌ رُدّ واقعةٌ حدثت", () => {
    const totals = netMaterials([
      material({ qty: 2 }), material({ kind: "in", qty: 2, isReturn: true }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].used).toBe(0);
  });

  it("والبنود تُفصل بعضها عن بعض", () => {
    const totals = netMaterials([
      material({ itemId: 1, qty: 2 }),
      material({ itemId: 2, itemName: "بنج", unit: "أمبولة", qty: 1 }),
    ]);
    expect(totals.map((one) => [one.itemId, one.used])).toEqual([[1, 2], [2, 1]]);
  });

  it("والتسوية لا تُحسب استهلاكًا — هي تصحيح جردٍ لا صرفٌ على مريض", () => {
    expect(netMaterials([material({ qty: 2 }), material({ kind: "adjust", qty: -5 })])[0].used).toBe(2);
  });

  it("وزيارةٌ بلا مواد صافيها فارغ", () => {
    expect(netMaterials([])).toEqual([]);
  });
});

describe("الردّ ليس إدخالًا", () => {
  it("الردّ يُعيد الدفعة إلى مكانها من الطابور بصلاحيتها", () => {
    // صُرفت الدفعة القريبة كلّها ثم رُدّت: التنبيه يجب أن يعود، فالمادّة على الرفّ.
    const movements = [
      { id: 1, kind: "in" as const, qty: 5, expiryDate: "2026-06-01" },
      { id: 2, kind: "in" as const, qty: 5, expiryDate: "2026-12-01" },
      { id: 3, kind: "out" as const, qty: 5 },
      { id: 4, kind: "in" as const, qty: 5, isReturn: true },
    ];
    expect(nearestExpiry(movements)).toBe("2026-06-01");
  });

  it("بينما إدخالٌ حقيقي بلا صلاحية يترك الدفعة مستهلكة", () => {
    const movements = [
      { id: 1, kind: "in" as const, qty: 5, expiryDate: "2026-06-01" },
      { id: 2, kind: "in" as const, qty: 5, expiryDate: "2026-12-01" },
      { id: 3, kind: "out" as const, qty: 5 },
      { id: 4, kind: "in" as const, qty: 5 },
    ];
    expect(nearestExpiry(movements)).toBe("2026-12-01");
  });

  it("والردّ يزيد الرصيد كالإدخال — الخلاف في الصلاحية لا في الكمية", () => {
    expect(deriveBalance([
      { kind: "in", qty: 5 }, { kind: "out", qty: 5 }, { kind: "in", qty: 5, isReturn: true },
    ])).toBe(5);
  });
});

describe("لا يُردّ أكثر مما صُرف", () => {
  const material = (over: Partial<Parameters<typeof outstandingReturn>[0][number]>) => ({
    itemId: 1, itemName: "قفازات", unit: "علبة", kind: "out" as const, qty: 1, ...over,
  });

  it("الباقي هو المصروف ناقص المردود", () => {
    expect(outstandingReturn([material({ qty: 3 }), material({ kind: "in", qty: 1, isReturn: true })], 1)).toBe(2);
  });

  it("وبعد ردّ الكلّ لا يبقى شيء — فلا يُضغط الزرّ ثانيةً فيُصنع مخزون", () => {
    expect(outstandingReturn([material({ qty: 3 }), material({ kind: "in", qty: 3, isReturn: true })], 1)).toBe(0);
  });

  it("وإدخالٌ ليس ردًّا لا يُنقص الباقي — وإلا صار الإدخال بابًا لردٍّ ثانٍ", () => {
    expect(outstandingReturn([material({ qty: 3 }), material({ kind: "in", qty: 3 })], 1)).toBe(3);
  });

  it("وبندٌ آخر لا يُخصم من باقي هذا", () => {
    expect(outstandingReturn([
      material({ qty: 3 }),
      material({ itemId: 2, kind: "in", qty: 3, isReturn: true }),
    ], 1)).toBe(3);
  });

  it("والصافي يتبع الردّ الموسوم وحده", () => {
    expect(netMaterials([material({ qty: 3 }), material({ kind: "in", qty: 3, isReturn: true })])[0].used).toBe(0);
    expect(netMaterials([material({ qty: 3 }), material({ kind: "in", qty: 3 })])[0].used).toBe(3);
  });
});
