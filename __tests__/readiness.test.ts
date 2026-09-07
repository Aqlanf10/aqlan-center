import { describe, expect, it } from "vitest";
import {
  BACKUP_STALE_DAYS, RATE_STALE_DAYS,
  readinessChecks, readinessVerdict, type ReadinessFacts,
} from "../lib/readiness";

const TODAY = "2026-09-03";

/** عيادةٌ مضبوطة تمامًا — ومنها تُشتقّ كل حالة نقص. */
const ready = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  clinicName: "مركز الدكتور عقلان الكامل",
  clinicPhone: "04-253028",
  baseCurrency: "YER",
  ratesUpdatedOn: { SAR: "2026-09-01", USD: "2026-09-01" },
  activeUsersByRole: { admin: 1, reception: 1, doctor: 2 },
  doctorCount: 2,
  doctorsWithoutPercent: 0,
  labPartyCount: 2,
  serviceCount: 30,
  servicesPriced: 30,
  servicesProvisional: 0,
  patientCount: 40,
  patientsWithoutPhone: 0,
  lastBackupOn: "2026-09-02",
  setupTokenLive: false,
  openShiftAgeDays: null,
  labOrdersWithoutDoctor: 0,
  today: TODAY,
  ...over,
});

const find = (facts: ReadinessFacts, key: string) =>
  readinessChecks(facts).find((one) => one.key === key)!;

describe("جاهزية النظام", () => {
  it("العيادة المضبوطة جاهزة بلا تحذيرات", () => {
    const verdict = readinessVerdict(readinessChecks(ready()));
    expect(verdict.ready).toBe(true);
    expect(verdict.blocked).toBe(0);
    expect(verdict.warnings).toBe(0);
    expect(verdict.message).toBe("النظام جاهز للعمل.");
  });

  it("ورمزُ التنصيب الباقي تحذيرٌ لا منع — ولا يُدَّعى عليه ما لا يفعل", () => {
    // `createFirstAdmin` يُدرج بشرط ألّا يكون في الجدول مستخدم. فما دام هناك
    // مستخدمون لا يُنشئ الرمزُ مديرًا، وحكمُ «يمنع البدء» عليه أشدّ من الواقع.
    const live = ready({ setupTokenLive: true });
    expect(find(live, "setup-token").level).toBe("warn");
    expect(readinessVerdict(readinessChecks(live)).ready).toBe(true);
  });

  it("ولا يُنبَّه عليه في نظامٍ بلا مستخدمين — فذاك وقتُه الذي أُنشئ له", () => {
    const fresh = ready({ setupTokenLive: true, activeUsersByRole: {} });
    expect(find(fresh, "setup-token").level).toBe("ok");
    // والحاجز حينها هو غياب المدير نفسه، لا الرمز.
    expect(find(fresh, "users").level).toBe("blocked");
  });

  it("ولا مدير يعني لا نظام", () => {
    expect(find(ready({ activeUsersByRole: {} }), "users").level).toBe("blocked");
  });

  it("وحسابٌ واحد تحذير — لا يمنع لكنه يُفرّغ الصلاحيات من معناها", () => {
    expect(find(ready({ activeUsersByRole: { admin: 1 } }), "users").level).toBe("warn");
  });

  it("**وأسعارٌ تخمينية تُنبَّه ولا تمنع** — تعمل، ومريضٌ يُحاسَب برقمٍ لم يُقرّ", () => {
    const item = find(ready({ servicesProvisional: 12 }), "services");
    expect(item.level).toBe("warn");
    expect(item.detail).toContain("تخمينيّ");
    // والسبب يقول لماذا: بندٌ أصفرُ بلا تفسيرٍ يُهمَل.
    expect(item.why).toContain("لم تُقرّها");
  });

  it("**ولا خدمات مسعّرة يمنع** — لا تُفوتر زيارة بلا خدمة", () => {
    expect(find(ready({ serviceCount: 0, servicesPriced: 0 }), "services").level).toBe("blocked");
  });

  it("**ودليلٌ مستورَد بلا أسعار ليس خدمات** — تسعون صفًّا ولا واحدةَ تُفوتَر", () => {
    // `importClinicCatalog` يُدرج الدليل كلَّه بـ`price_configured = FALSE`، ثم
    // يردّه `validateProcedures` عند أوّل زيارة. فعدُّ الصفوف كان يقول «تمام».
    const imported = find(ready({ serviceCount: 92, servicesPriced: 0 }), "services");
    expect(imported.level).toBe("blocked");
    // والتفصيل يقول الرقمين: أحدهما وحده يكذب.
    expect(imported.detail).toContain("92");
    expect(imported.detail).toContain("0");
  });

  it("وسعرٌ واحدٌ مضبوط يكفي للبدء، والتفصيل يقول كم بقي بلا سعر", () => {
    const partial = find(ready({ serviceCount: 92, servicesPriced: 5 }), "services");
    expect(partial.level).toBe("ok");
    expect(partial.detail).toContain("92");
    expect(partial.detail).toContain("5");
  });

  it("**ولا نسخة احتياطية يمنع** — عطلٌ واحد يُنهي تاريخ المركز", () => {
    expect(find(ready({ lastBackupOn: null }), "backup").level).toBe("blocked");
  });

  it("ونسخةٌ قديمة تحذير لا منع", () => {
    const old = "2026-08-01"; // أكثر من أسبوع
    expect(find(ready({ lastBackupOn: old }), "backup").level).toBe("warn");
    expect(BACKUP_STALE_DAYS).toBeGreaterThan(0);
  });

  it("وسعرُ صرفٍ قديم تحذير — كل دفعةٍ بالدولار تُقيَّد خطأً", () => {
    expect(find(ready({ ratesUpdatedOn: { SAR: "2026-08-01", USD: "2026-08-01" } }), "rates").level).toBe("warn");
    expect(find(ready({ ratesUpdatedOn: { SAR: null, USD: null } }), "rates").level).toBe("warn");
    expect(find(ready({ ratesUpdatedOn: { SAR: TODAY, USD: TODAY } }), "rates").level).toBe("ok");
    expect(RATE_STALE_DAYS).toBeGreaterThan(0);
  });

  it("**والسعرُ الأقدم هو الحكم** — تحديثُ الدولار اليوم لا يُبيّض سعرًا سعوديًّا عمرُه شهر", () => {
    // شاشة الإعدادات تحفظ الحقول المتغيّرة وحدها، فلكل سعرٍ تاريخُه. و`MAX` على
    // الاثنين كان يجعل الأحدثَ يستر الأقدم، فتُقيَّد دفعاتُ السعودي بسعرٍ بالٍ.
    const one = find(ready({ ratesUpdatedOn: { SAR: "2026-08-01", USD: TODAY } }), "rates");
    expect(one.level).toBe("warn");
    expect(one.detail).toContain("الريال السعودي");
    expect(one.detail).toContain("الدولار");
  });

  it("**والمفتاحُ الغائب ليس محايدًا** — قيمةٌ افتراضية لا قرارَ مالكٍ فيها", () => {
    const missing = find(ready({ ratesUpdatedOn: { SAR: TODAY, USD: null } }), "rates");
    expect(missing.level).toBe("warn");
    expect(missing.detail).toContain("لم يُحفظ قط");
  });

  it("وطبيبٌ بلا نسبةٍ يُنبَّه عليه — مستحقاته تظهر صفرًا وهو يعمل", () => {
    expect(find(ready({ doctorsWithoutPercent: 1 }), "doctors").level).toBe("warn");
  });

  it("وبنودُ ما لا يقع لا تُعرض أصلًا", () => {
    // فقائمةٌ فيها «صفر ورديات عالقة» ضجيجٌ يُخفي ما يهمّ.
    const keys = readinessChecks(ready()).map((one) => one.key);
    expect(keys).not.toContain("shifts");
    expect(keys).not.toContain("lab-orders-doctor");
    expect(readinessChecks(ready({ openShiftAgeDays: 2 })).map((one) => one.key)).toContain("shifts");
    // ووردية اليوم ليست عالقة — تُفتح صباحًا وتُغلق مساءً.
    expect(readinessChecks(ready({ openShiftAgeDays: 0 })).map((one) => one.key)).not.toContain("shifts");
    expect(readinessChecks(ready({ labOrdersWithoutDoctor: 5 })).map((one) => one.key))
      .toContain("lab-orders-doctor");
  });

  it("**والحاجز يتقدّم على التحذير** — يُرى ما يوقفك في أعلى الشاشة", () => {
    const checks = readinessChecks(ready({
      serviceCount: 0, servicesPriced: 0,
      ratesUpdatedOn: { SAR: null, USD: null }, lastBackupOn: null,
    }));
    const levels = checks.map((one) => one.level);
    const firstWarn = levels.indexOf("warn");
    const lastBlocked = levels.lastIndexOf("blocked");
    expect(lastBlocked).toBeLessThan(firstWarn);
  });

  it("ولكل بندٍ سببٌ يُقرأ — لا حالةٌ بلا تفسير", () => {
    for (const check of readinessChecks(ready({ setupTokenLive: true, openShiftAgeDays: 1 }))) {
      expect(check.why.length, check.key).toBeGreaterThan(20);
      expect(check.detail.length, check.key).toBeGreaterThan(0);
    }
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * بوّابة المرضى
 *
 * بُنيت وتعملُ وكان لا شيء في البرنامج يدلّ عليها. ووجودُها في هذه الشاشة نصفُ
 * الفائدة: هنا يُقرأ ما ينقص قبل التشغيل.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("بوّابة المرضى", () => {
  it("مرضى بجوالاتهم — البند تمام ويقول أين البوّابة", () => {
    const item = find(ready(), "portal");
    expect(item.level).toBe("ok");
    expect(item.why).toContain("/portal");
  });

  /*
   * **ومن لا جوالَ له لا يدخل مهما أُرسل إليه الرابط.**
   *
   * فالدخول رقمُ الملف والجوال. وسكوتُ الشاشة عن ذلك يجعل المالك يظنّ البوّابة
   * معطوبة وهي تعمل — ويبحث في البرنامج عن عطبٍ لا وجود له.
   */
  it("وبعضُهم بلا جوال — تحذير، ويقال كم هم", () => {
    const item = find(ready({ patientCount: 40, patientsWithoutPhone: 7 }), "portal");
    expect(item.level).toBe("warn");
    expect(item.detail).toContain("7");
    expect(item.why).toContain("لا يدخل");
  });

  it("وكلُّهم بلا جوال — البوّابة لا تعمل لأحد، فهو حجب", () => {
    expect(find(ready({ patientCount: 12, patientsWithoutPhone: 12 }), "portal").level).toBe("blocked");
  });

  /*
   * **ولا مرضى بعدُ ليس حجبًا.**
   *
   * فعيادةٌ لم تُسجّل مريضًا بعد ليست معطوبة — وحجبُ البدء بسبب ذلك يقول
   * «أصلِح شيئًا» ولا شيء يُصلَح. والفرق بين «صفر من صفر» و«صفر من أربعين»
   * هو الفرق بين بدايةٍ وعطب.
   */
  it("ولا مرضى بعدُ ليس حجبًا — عيادةٌ لم تبدأ ليست معطوبة", () => {
    const item = find(ready({ patientCount: 0, patientsWithoutPhone: 0 }), "portal");
    expect(item.level).toBe("ok");
    expect(item.detail).toContain("لا مرضى");
  });
});
