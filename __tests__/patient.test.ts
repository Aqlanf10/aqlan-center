import { describe, expect, it } from "vitest";
import { ageFromBirthYear, ageText, validatePatient } from "../lib/patient";

const TODAY = "2026-08-27";

describe("العمر", () => {
  it("يُحسب من سنة الميلاد ويُنطق بصيغ العربية", () => {
    expect(ageFromBirthYear(1992, TODAY)).toBe(34);
    expect(ageText(ageFromBirthYear(1992, TODAY))).toBe("34 سنة");
    expect(ageText(ageFromBirthYear(2024, TODAY))).toBe("سنتان");
    expect(ageText(ageFromBirthYear(2020, TODAY))).toBe("6 سنوات");
    expect(ageText(null)).toBe("العمر غير مسجّل");
  });
});

describe("التحقق من بيانات المريض", () => {
  it("يقبل الحد الأدنى: اسم وحده", () => {
    const result = validatePatient({ fullName: "  عبدالله   محمد " }, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fullName).toBe("عبدالله محمد");
    expect(result.value.gender).toBe("unknown");
    expect(result.value.phone).toBeNull();
  });

  it("يسمّي الحقل الخاطئ — النموذج فيه ثمانية حقول", () => {
    const noName = validatePatient({ fullName: "" }, TODAY);
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.field).toBe("fullName");

    const badYear = validatePatient({ fullName: "عبدالله", birthYear: "1092" }, TODAY);
    expect(badYear.ok).toBe(false);
    if (!badYear.ok) expect(badYear.field).toBe("birthYear");
  });

  it("يرفض سنة ميلاد في المستقبل", () => {
    expect(validatePatient({ fullName: "عبدالله", birthYear: "2030" }, TODAY).ok).toBe(false);
  });

  it("يقرأ الأرقام العربية الهندية في سنة الميلاد", () => {
    const result = validatePatient({ fullName: "عبدالله", birthYear: "١٩٩٢" }, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.birthYear).toBe(1992);
  });

  it("يرفض اسمًا بلا حروف", () => {
    expect(validatePatient({ fullName: "12345" }, TODAY).ok).toBe(false);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * دالّةٌ واحدة للعمر
 *
 * وكانت اثنتين: هذه، وأخرى في محرّك السيفالو تُحجب بها معايير البالغين عن وجهٍ
 * ينمو. واتّفقتا على المُدخل السليم واختلفتا عند الحدّ — فتقول الورقة عمرًا
 * ويحجب التحليل حكمه بعمرٍ غيره، ولا يُعرف أيّهما الصحيح إلّا بعد أن يُبنى على
 * الخطأ. فبقيت واحدةٌ هنا، حيث بيانات المريض.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("العمر من سنة الميلاد — حدودُه", () => {
  it("يُحسب بفارق السنتين", () => {
    expect(ageFromBirthYear(2008, "2026-09-03")).toBe(18);
    expect(ageFromBirthYear(2017, "2026-01-01")).toBe(9);
  });

  it("ويُردّ لا شيء حين لا يُعرف أو يستحيل", () => {
    expect(ageFromBirthYear(null, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(undefined, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(2008, null)).toBeNull();
    expect(ageFromBirthYear(2008, "")).toBeNull();
  });

  it("ورقمٌ فاسد أسوأ من لا رقم", () => {
    // سنةُ ميلادٍ بعد التاريخ المسؤول عنه — بيانٌ خطأ، لا عمرٌ سالب.
    expect(ageFromBirthYear(2030, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(1800, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(2008.5, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(2008, "سنة")).toBeNull();
  });

  it("والمئةُ والثلاثون مقبولة وما فوقها لا", () => {
    expect(ageFromBirthYear(1900, "2030-01-01")).toBe(130);
    expect(ageFromBirthYear(1900, "2031-01-01")).toBeNull();
  });
});
