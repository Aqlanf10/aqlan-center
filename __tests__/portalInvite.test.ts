import { describe, expect, it } from "vitest";
import { portalInvite, portalUrl, portalUrlFromHeaders } from "../lib/portalInvite";

/*
 * دعوةُ المريض إلى بوّابته.
 *
 * والبوّابة بُنيت وتعمل ولا شيء في البرنامج يدلّ عليها. وحُرّاسُ هذه الوحدة عن
 * أمرين: **ألّا يُرسل رابطٌ مكسور** — فمريضٌ يفتح صفحة خطأ يظنّ برنامج المركز
 * معطوبًا — **وألّا يُسلَّم نصفُ مفتاحٍ لمن ليس صاحبه**.
 */
describe("عنوان البوّابة", () => {
  it("يُبنى من عنوان البرنامج", () => {
    expect(portalUrl("https://clinic.example.com")).toBe("https://clinic.example.com/portal");
  });

  it("وشرطةٌ زائدة في آخره لا تُكرَّر", () => {
    expect(portalUrl("https://clinic.example.com/")).toBe("https://clinic.example.com/portal");
  });

  /*
   * **ولا يُبنى رابطٌ من عنوانٍ ناقص.**
   *
   * فـ`window.location.origin` غيرُ موجودٍ أثناء التصيير على الخادم، ويصل
   * `null`. و«null/portal» يُرسل إلى المريض فيفتح صفحة خطأ.
   */
  it("وعنوانٌ ناقص لا يُنتج رابطًا", () => {
    for (const bad of [null, undefined, "", "  ", "clinic.example.com", "ftp://x", "https://"]) {
      expect(portalUrl(bad), String(bad)).toBeNull();
    }
  });

  /*
   * و`x-forwarded-proto` تُقرأ قبل الافتراض.
   *
   * فخلف Vercel يصل الطلب إلى العملية بـ`http` وإن كان المتصفّح على `https`،
   * فرابطٌ بـ`http` يُنبّه متصفّحَ المريض أنّ الصفحة غير آمنة.
   */
  it("والترويسات تُقرأ كما تصل خلف الوسيط", () => {
    const headers = new Map([["x-forwarded-host", "clinic.example.com"], ["x-forwarded-proto", "https"]]);
    expect(portalUrlFromHeaders((name) => headers.get(name) ?? null))
      .toBe("https://clinic.example.com/portal");
  });

  it("وسلسلةُ وسطاء تُؤخذ أوّلُها لا نصُّها كلُّه", () => {
    const headers = new Map([["host", "a.example.com, b.example.com"], ["x-forwarded-proto", "https, http"]]);
    expect(portalUrlFromHeaders((name) => headers.get(name) ?? null))
      .toBe("https://a.example.com/portal");
  });

  it("وبلا مضيفٍ لا رابط", () => {
    expect(portalUrlFromHeaders(() => null)).toBeNull();
  });
});

describe("نصّ الدعوة", () => {
  const invite = (over: Partial<Parameters<typeof portalInvite>[0]> = {}) => portalInvite({
    origin: "https://clinic.example.com", clinicName: "مركز الاختبار", patientNumber: "P-00042", ...over,
  });

  it("يحمل العنوان ورقم الملف", () => {
    const made = invite();
    expect(made?.text).toContain("https://clinic.example.com/portal");
    expect(made?.text).toContain("P-00042");
  });

  /*
   * **ولا يحمل كلمة سرّ، لأنّه لا كلمة سرّ.**
   *
   * والدخول رقمُ الملف والجوال. والرسالة تصل إلى الجوال نفسه، فذكرُه فيها حشو —
   * ولو أُرسلت خطأً إلى رقمٍ آخر لكان ذكرُه تسليمَ نصفِ المفتاح الثاني.
   */
  it("ولا يحمل جوّالَ المريض — الرسالة تصل إليه أصلًا", () => {
    const made = portalInvite({
      origin: "https://clinic.example.com", clinicName: "مركز الاختبار", patientNumber: "P-00042",
    });
    expect(made?.text).not.toMatch(/7[0-9]{8}/);
  });

  it("وبلا عنوانٍ لا دعوة — ولا يُرسل رابطٌ مكسور", () => {
    expect(invite({ origin: null })).toBeNull();
  });

  it("وبلا رقم ملفٍ لا دعوة — الرقم نصفُ ما يدخل به", () => {
    expect(invite({ patientNumber: "   " })).toBeNull();
  });

  it("واسمُ المركز يُقرأ من الإعدادات ولا يُكتب في الكود", () => {
    expect(invite({ clinicName: "مركز آخر" })?.text.startsWith("مركز آخر")).toBe(true);
  });
});
