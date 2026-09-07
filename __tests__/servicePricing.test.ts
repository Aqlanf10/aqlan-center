import { describe, expect, it } from "vitest";
import { readPriceBatch } from "../lib/servicePricing";

// وحدةٌ صغرى بلا كسور — كالريال اليمني (`MINOR_UNITS.YER = 1`).
const parse = (input: string) => {
  const value = Number(String(input).replace(/,/g, "").trim());
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
};
const nameOf = (id: number) => (id === 7 ? "حشوة ضوئية" : null);

describe("قراءة دفعة الأسعار", () => {
  it("تقرأ الدفعة السليمة كاملة", () => {
    const batch = readPriceBatch([{ id: 1, price: "5000" }, { id: 2, price: "12,500" }], parse, nameOf);
    expect(batch).toEqual({ ok: true, prices: [{ id: 1, priceMinor: 5000 }, { id: 2, priceMinor: 12500 }] });
  });

  it("**ورقمٌ خاطئ يردّ الدفعة كلَّها** — لا نصفَ دليلٍ مسعّرًا ونصفَه لا", () => {
    const batch = readPriceBatch(
      [{ id: 1, price: "5000" }, { id: 7, price: "غير رقم" }, { id: 2, price: "3000" }], parse, nameOf);
    expect(batch.ok).toBe(false);
    // والرسالة تسمّي صاحب الخطأ: «سطرٌ ما» في ٨٦ سطرًا لا يُبحث عنه.
    if (!batch.ok) expect(batch.message).toContain("حشوة ضوئية");
  });

  it("وصفرٌ ليس سعرًا — يُفوتر بلا مقابل ولا يُعرف أمجّانيٌّ هو أم منسيّ", () => {
    const batch = readPriceBatch([{ id: 7, price: "0" }], parse, nameOf);
    expect(batch.ok).toBe(false);
    if (!batch.ok) expect(batch.message).toContain("أكبر من صفر");
  });

  it("وخدمةٌ مرّتين بسعرين تُردّ ولا يُخمَّن أيّهما", () => {
    const batch = readPriceBatch([{ id: 7, price: "100" }, { id: 7, price: "200" }], parse, nameOf);
    expect(batch.ok).toBe(false);
    if (!batch.ok) expect(batch.message).toContain("مكرّرة");
  });

  it("ورقمُ خدمةٍ غير صالح يُردّ", () => {
    expect(readPriceBatch([{ id: 0, price: "10" }], parse, nameOf).ok).toBe(false);
    expect(readPriceBatch([{ id: -3, price: "10" }], parse, nameOf).ok).toBe(false);
    expect(readPriceBatch([{ price: "10" }], parse, nameOf).ok).toBe(false);
  });

  it("ودفعةٌ فارغة ليست نجاحًا صامتًا", () => {
    expect(readPriceBatch([], parse, nameOf).ok).toBe(false);
  });

  it("ودفعةٌ أكبر من الحدّ تُردّ بحدّها", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, price: "10" }));
    const batch = readPriceBatch(many, parse, nameOf, 5);
    expect(batch.ok).toBe(false);
    if (!batch.ok) expect(batch.message).toContain("5");
  });
});
