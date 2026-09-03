import { describe, expect, it } from "vitest";
import {
  MAX_ITEMS, MIN_VOID_REASON,
  checkVoid, isInstructionsLang, isVoided, readDraft,
  hasLatin, sanitizeRxItem, sanitizeRxItems, showsInstructions,
} from "../lib/prescription";

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * الوصفة وثيقة
 *
 * يحملها المريض إلى صيدليٍّ يصرف بها دواءً. فما يُطبع منها يجب أن يكون محفوظًا
 * كما طُبع، ومنسوبًا إلى من أصدره — ولا يُختلق منه شيء.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("قراءة مسوّدة الوصفة", () => {
  const item = { name: "Amoxicillin", dose: "500mg", frequency: "every 8 hours" };

  it("تُقبل بمريضٍ ودواءٍ واحد على الأقل", () => {
    const draft = readDraft({ patientId: 7, items: [item] });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.value.patientId).toBe(7);
    expect(draft.value.items).toHaveLength(1);
    expect(draft.value.instructionsLang).toBe("both");
  });

  it("**ووصفةٌ بلا دواء تُرفض** — ورقةٌ بترويسةٍ وتوقيعٍ ولا شيء فيها", () => {
    for (const items of [[], undefined, "دواء", [{ dose: "500mg" }], [{ name: "   " }]]) {
      const draft = readDraft({ patientId: 7, items });
      expect(draft.ok, JSON.stringify(items)).toBe(false);
      if (!draft.ok) expect(draft.message).toContain("دواء");
    }
  });

  it("وبلا مريضٍ تُرفض — ولا تُكتب وصفةٌ في الهواء", () => {
    for (const patientId of [0, -1, null, undefined, "سبعة", 1.5]) {
      expect(readDraft({ patientId, items: [item] }).ok, String(patientId)).toBe(false);
    }
  });

  it("ورسائل الرفض عربيةٌ تقول ما يُفعل", () => {
    const draft = readDraft({ patientId: 7, items: [] });
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(/[؀-ۿ]/.test(draft.message)).toBe(true);
    expect(draft.message).not.toBe("طلب غير صالح.");
  });

  it("والزيارة اختيارية، ورقمُها الفاسد يُرفض ولا يُتجاهل", () => {
    expect(readDraft({ patientId: 7, items: [item], visitId: null }).ok).toBe(true);
    expect(readDraft({ patientId: 7, items: [item], visitId: "" }).ok).toBe(true);
    expect(readDraft({ patientId: 7, items: [item], visitId: 0 }).ok).toBe(false);
    expect(readDraft({ patientId: 7, items: [item], visitId: "س" }).ok).toBe(false);
  });

  it("ولغةُ تعليماتٍ غير معروفة تُرفض ولا تُبدَّل صامتةً", () => {
    // بلا هذا يُرسل «fr» فيُحفظ «both»، فتخرج تعليماتٌ لم يخترها الطبيب.
    expect(readDraft({ patientId: 7, items: [item], instructionsLang: "fr" }).ok).toBe(false);
    for (const lang of ["ar", "en", "both"]) {
      const draft = readDraft({ patientId: 7, items: [item], instructionsLang: lang });
      expect(draft.ok, lang).toBe(true);
      if (draft.ok) expect(draft.value.instructionsLang).toBe(lang);
    }
  });
});

describe("تنقية الأدوية", () => {
  it("سطرٌ بلا اسمٍ ليس دواءً ناقصًا بل سطرٌ فارغ", () => {
    expect(sanitizeRxItem({ dose: "500mg", frequency: "8h" })).toBeNull();
    expect(sanitizeRxItem({ name: "" })).toBeNull();
    expect(sanitizeRxItem(null)).toBeNull();
    expect(sanitizeRxItem("Amoxicillin")).toBeNull();
  });

  it("والحقول الغائبة تصير نصًّا فارغًا لا undefined", () => {
    const item = sanitizeRxItem({ name: "  Brufen  " });
    expect(item).not.toBeNull();
    expect(item!.name).toBe("Brufen");
    expect(item!.dose).toBe("");
    expect(item!.instructionsEn).toBe("");
  });

  it("والأسطر الفارغة تُطرح ولا تُوقف الباقي", () => {
    const items = sanitizeRxItems([{ name: "A" }, { dose: "x" }, { name: "B" }]);
    expect(items.map((one) => one.name)).toEqual(["A", "B"]);
  });

  it("وعددُ الأدوية محدود — فلا يبتلع حقلٌ واحد الوثيقة", () => {
    const many = Array.from({ length: MAX_ITEMS + 10 }, (_, index) => ({ name: `Drug ${index}` }));
    expect(sanitizeRxItems(many)).toHaveLength(MAX_ITEMS);
  });

  it("والنصّ الطويل يُقصّ ولا يُرفض", () => {
    const item = sanitizeRxItem({ name: "A".repeat(5000) });
    expect(item!.name.length).toBeLessThanOrEqual(200);
  });
});

describe("الإبطال", () => {
  const live = { voidedAt: null };
  const dead = { voidedAt: "2026-09-03T00:00:00.000Z" };

  it("يحتاج سببًا يُقرأ بعد سنة", () => {
    expect(checkVoid(live, "خطأ").ok).toBe(false);
    expect(checkVoid(live, "").ok).toBe(false);
    expect(checkVoid(live, undefined).ok).toBe(false);
    expect(checkVoid(live, "ح".repeat(MIN_VOID_REASON)).ok).toBe(true);
  });

  it("والمُبطَلة لا تُبطَل مرّتين", () => {
    const again = checkVoid(dead, "سببٌ كافٍ جدًّا");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toContain("مُبطَلة");
  });

  it("وسؤال «أمُبطَلة؟» له جوابٌ واحد", () => {
    expect(isVoided(live)).toBe(false);
    expect(isVoided(dead)).toBe(true);
  });
});

describe("لغة التعليمات", () => {
  it("«كلتاهما» تُظهر الاثنتين، وكلُّ لغةٍ تُظهر نفسها وحدها", () => {
    expect(showsInstructions("both", "ar")).toBe(true);
    expect(showsInstructions("both", "en")).toBe(true);
    expect(showsInstructions("ar", "ar")).toBe(true);
    expect(showsInstructions("ar", "en")).toBe(false);
    expect(showsInstructions("en", "ar")).toBe(false);
    expect(showsInstructions("en", "en")).toBe(true);
  });

  it("والتعرّف يرفض ما ليس لغةً معروفة", () => {
    expect(isInstructionsLang("both")).toBe(true);
    expect(isInstructionsLang("fr")).toBe(false);
    expect(isInstructionsLang(null)).toBe(false);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * اسم الدواء يُكتب كما على العلبة
 *
 * فالصيدليّ يبحث عن `Amoxicillin` لا عن «أموكسيسيلين» — والمكتوب بالعربية
 * وحدها لا يجده في رفّه ولا في نظامه، والوصفة تُكتب لتُصرف.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("اسم الدواء لاتينيّ", () => {
  it("فالعربيّ وحده يُردّ", () => {
    expect(sanitizeRxItem({ name: "أموكسيسيلين" })).toBeNull();
    expect(sanitizeRxItem({ name: "بنادول ٥٠٠" })).toBeNull();
  });

  it("واللاتينيّ يُقبل ولو حمل أرقامًا ورموزًا ونِسبًا", () => {
    for (const name of [
      "Amoxicillin", "Chlorhexidine 0.12%", "Augmentin 1g",
      "Ibuprofen (Brufen)", "Amoxicillin + Clavulanic acid",
    ]) {
      expect(sanitizeRxItem({ name })?.name, name).toBe(name);
    }
  });

  it("والمختلط يُقبل — فيه ما يبحث به الصيدليّ", () => {
    expect(sanitizeRxItem({ name: "Amoxicillin أموكسيسيلين" })).not.toBeNull();
  });

  it("**والرسالة تفرّق بين «لا دواء» و«اسمٌ بلا لاتينية»**", () => {
    // من كتب «أموكسيسيلين» يظنّ أنّه كتب دواءً، فقولُ «الوصفة بلا دواء» يحيّره.
    const arabicOnly = readDraft({ patientId: 7, items: [{ name: "أموكسيسيلين" }] });
    expect(arabicOnly.ok).toBe(false);
    if (!arabicOnly.ok) expect(arabicOnly.message).toContain("بالإنجليزية");

    const nothing = readDraft({ patientId: 7, items: [] });
    expect(nothing.ok).toBe(false);
    if (!nothing.ok) expect(nothing.message).toContain("بلا دواء");
  });

  it("والدالّة تُختبر وحدها", () => {
    expect(hasLatin("Amoxicillin")).toBe(true);
    expect(hasLatin("0.12%")).toBe(false);
    expect(hasLatin("أموكسيسيلين")).toBe(false);
    expect(hasLatin("")).toBe(false);
  });
});
