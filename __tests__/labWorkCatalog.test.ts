import { describe, expect, it } from "vitest";
import { LAB_CATEGORIES, readService } from "../lib/labCatalog";
import { importPlan, LAB_WORK_CATALOG, workKey } from "../lib/labWorkCatalog";

/*
 * كتالوج أعمال المعامل — قائمةٌ معروفةٌ في المهنة **بلا أسعار**.
 *
 * وحُرّاسه ليست عن صحّة المهلة — معملٌ في تعز غير معملٍ يُشحن إليه — بل عن
 * ألّا تدخل القائمةُ القاعدةَ بشكلٍ يُفسد ما بُنيت له: توحيدَ التسمية.
 */
describe("كتالوج أعمال المعامل", () => {
  it("ليس فارغًا، وفيه من كل تصنيفٍ عمل", () => {
    expect(LAB_WORK_CATALOG.length).toBeGreaterThan(20);
    for (const category of LAB_CATEGORIES) {
      expect(LAB_WORK_CATALOG.some((one) => one.category === category), category).toBe(true);
    }
  });

  /*
   * **ولا اسمَ مكرّرًا — ولو باختلاف حالةِ حرفٍ أو فراغٍ طرفيّ.**
   *
   * ففهرس القاعدة فريدٌ على الاسم المُطبَّع، فالمكرّر يسقط عند الإدراج ويُقال
   * «أُدخل ٤٣» عن ٤٢. والأسوأ أنّ الكتالوج بُني ليمنع «زيركون» و«زركون» أن
   * يصيرا عملين — فقائمةٌ تحمل هي نفسها مكرّرًا تنقض سبب وجودها.
   */
  it("لا اسمَ مكرّرًا بمقياس فهرس القاعدة", () => {
    const keys = LAB_WORK_CATALOG.map((one) => workKey(one.name));
    expect(keys.length - new Set(keys).size).toBe(0);
  });

  /*
   * وكلُّ صفٍّ يعبر `readService` — وهو الحارس الذي يعبره ما يُكتب باليد.
   *
   * فلو خالف صفٌّ حدوده (اسمٌ أقصر من حرفين، مهلةٌ فوق ١٢٠ يومًا) لسقط عند
   * الإدراج وحده، ولظهر النقص بعد الاستيراد لا قبله.
   */
  it("وكلُّ صفٍّ يعبر حارسَ الإدخال نفسه", () => {
    const refused = LAB_WORK_CATALOG.filter((one) => !readService(one).ok).map((one) => one.name);
    expect(refused).toEqual([]);
  });

  it("ولا سعرَ في القائمة — السعر اتفاقُ المركز مع معمله", () => {
    // حارسٌ على الحدّ الذي رسمه المالك: «انا بحدد الاسعار تبعه».
    const priced = LAB_WORK_CATALOG.filter(
      (one) => Object.keys(one).some((key) => /cost|price|سعر/i.test(key)));
    expect(priced).toEqual([]);
  });

  /*
   * والوحدة سنٌّ لا حالة.
   *
   * فالجسر ثلاث وحداتٍ أو خمس، وسعرُ «جسرٍ» واحدٍ لا معنى له — وهكذا تُسعّر
   * المعامل فعلًا.
   */
  it("والجسور تُسعَّر بالوحدة لا بالجسر", () => {
    const bridges = LAB_WORK_CATALOG.filter((one) => one.name.includes("جسر"));
    expect(bridges.length).toBeGreaterThan(0);
    expect(bridges.filter((one) => one.name.startsWith("جسر") && !one.name.includes("ماريلاند")))
      .toEqual([]);
  });

  it("وأجهزة التقويم لا تُسأل عن لون سنّ", () => {
    // حقلٌ لا معنى له يُملأ عبثًا كلَّ مرّة، وعملٌ بلونٍ أُرسل بلا لونٍ يعود ليُعاد.
    const ortho = LAB_WORK_CATALOG.filter((one) => one.category === "ortho");
    expect(ortho.filter((one) => one.requiresShade)).toEqual([]);
  });
});

describe("خطّة الاستيراد", () => {
  it("على قاعدةٍ فارغة تُدخل القائمة كلَّها", () => {
    const plan = importPlan([]);
    expect(plan.missing.length).toBe(LAB_WORK_CATALOG.length);
    expect(plan.presentCount).toBe(0);
  });

  /*
   * **وما هو مسجَّلٌ لا يُمسّ.**
   *
   * فقد يكون المالك عدّل مهلته أو صنّفه، وإعادةُ الاستيراد فوقه تمحو تعديله.
   */
  it("وتشغيلُها مرّتين لا يُدخل شيئًا في الثانية", () => {
    const plan = importPlan(LAB_WORK_CATALOG.map((one) => one.name));
    expect(plan.missing).toEqual([]);
    expect(plan.presentCount).toBe(LAB_WORK_CATALOG.length);
  });

  /*
   * والمقارنة بالاسم المُطبَّع لا بالخام — كفهرس القاعدة.
   *
   * فلو قورن بالخام لبدا «تاج زيركون » ناقصًا، ثم سقط إدراجه عند الفهرس:
   * تُوعد الشاشة بإدخالٍ لا يقع.
   */
  it("و«تاج زيركون » بفراغٍ طرفيّ هو «تاج زيركون» نفسه", () => {
    const plan = importPlan(["  تاج زيركون  "]);
    expect(plan.presentCount).toBe(1);
    expect(plan.missing.some((one) => one.name === "تاج زيركون")).toBe(false);
  });

  it("وعملٌ من عند المالك ليس في القائمة لا يُنقص شيئًا منها", () => {
    const plan = importPlan(["عملٌ خاصّ بمركزنا"]);
    expect(plan.missing.length).toBe(LAB_WORK_CATALOG.length);
    expect(plan.presentCount).toBe(0);
  });
});
