import { describe, expect, it } from "vitest";
import { CLINIC_SERVICES } from "../lib/clinicCatalog";
import { PROVISIONAL_PRICES, provisionalFills, provisionalPriceOf } from "../lib/provisionalPrices";

/*
 * الأسعار التخمينية — قائمةٌ للتجربة تُوسَم، لا قائمةُ المركز.
 *
 * وخطرُها أنّها تعمل: تُفوتَر بها زيارةُ مريضٍ حقيقيّ. فحُرّاسُها ليست عن صحّة
 * الرقم — لا أحد يستطيع إثبات أنّ الكشف ثلاثة آلاف — بل عن ألّا يتسلّل التخمين
 * إلى موضعٍ لا يُرى فيه أنّه تخمين، وألّا يمحو قرارًا اتّخذه المالك.
 */
describe("الأسعار التخمينية", () => {
  /*
   * كلُّ عملٍ في الدليل له تقدير.
   *
   * وهذا الحارس **عن المستقبل لا عن الحاضر**: من يضيف عملًا إلى `clinicCatalog`
   * ولا يقدّر له سعرًا يترك خدمةً بلا سعر بعد «ملء الباقي» — والشاشة تقول
   * حينها إنّ الملء تمّ، والخدمة تُردّ عند أوّل فاتورة.
   */
  it("لا عملَ في دليل المركز بلا تقدير", () => {
    const missing = CLINIC_SERVICES.filter((one) => provisionalPriceOf(one.code) === null);
    expect(missing.map((one) => one.code)).toEqual([]);
  });

  it("ولا تقديرَ لرمزٍ ليس في الدليل — القائمتان لا تتباعدان", () => {
    const codes = new Set(CLINIC_SERVICES.map((one) => one.code));
    expect(Object.keys(PROVISIONAL_PRICES).filter((code) => !codes.has(code))).toEqual([]);
  });

  it("وكلُّ تقديرٍ موجب — وصفرٌ ليس سعرًا", () => {
    expect(Object.entries(PROVISIONAL_PRICES).filter(([, price]) => !(price > 0))).toEqual([]);
  });

  /*
   * الترتيب النسبيّ هو ما يُدّعى صوابه، لا القيم المطلقة.
   *
   * فقيمةٌ مفردة لا تُختبر — لا مرجع لها. أمّا أن يكون الكشف أرخص من الحشوة
   * والحشوة أرخص من العصب والعصب أرخص من التاج والزراعة أعلاها، فهو ما يجعل
   * القائمة صالحةً للتجربة أصلًا: لو انقلب الترتيب لصارت تجربةً على أرقامٍ عبثية.
   */
  it("والترتيب بينها معقول: كشف < حشوة < عصب < تاج < زراعة", () => {
    const price = (code: string) => provisionalPriceOf(code) as number;
    expect(price("exam")).toBeLessThan(price("composite"));
    expect(price("composite")).toBeLessThan(price("rct"));
    expect(price("rct")).toBeLessThan(price("zirconia"));
    expect(price("zirconia")).toBeLessThan(price("implant"));
  });

  const service = (over: Partial<Parameters<typeof provisionalFills>[0][number]> = {}) => ({
    id: 1, catalogCode: "exam", priceConfigured: false, isActive: true, ...over,
  });

  it("تُملأ الخدمة الفعّالة غير المسعّرة", () => {
    expect(provisionalFills([service()])).toEqual([{ id: 1, priceMinor: PROVISIONAL_PRICES.exam }]);
  });

  /* ومن سعّر بيده قرّر — والتخمين لا يُكتب فوق قرار. */
  it("وما سُعّر لا يُمسّ", () => {
    expect(provisionalFills([service({ priceConfigured: true })])).toEqual([]);
  });

  it("والمعطّلة لا تُسعَّر — لا تُفوتر أصلًا", () => {
    expect(provisionalFills([service({ isActive: false })])).toEqual([]);
  });

  /*
   * وخدمةٌ بلا رمزٍ لا تُقدَّر.
   *
   * أضافها المالك بيده باسمٍ من عنده، ولا يُعرف ما هي: تقديرُها بسعرٍ اختاره
   * النظام لعملٍ آخر ليس تخمينًا بل خطأ.
   */
  it("وخدمةٌ بلا رمزٍ في الدليل تبقى بلا سعر", () => {
    expect(provisionalFills([service({ catalogCode: null })])).toEqual([]);
    expect(provisionalFills([service({ catalogCode: "لا وجود له" })])).toEqual([]);
  });
});
