import { describe, expect, it } from "vitest";
import {
  PRINTABLE_DOCS, PRINT_AUDIENCE, PRINT_AUDIENCES, canPrintDoc, isPrintableDoc, type PrintableDoc,
} from "../lib/prints";

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * من يطبع ماذا
 *
 * وكان المسار يشترط صلاحية المال على كل الطبعات، وورقة السيفالو للطبيب والمدير
 * وحدهما — فالطبيب يفتحها ويضغط «اطبع» فيُردّ ٤٠٣، ولا تُسجَّل الطبعة، فلا تظهر
 * «نسخة معاد طباعتها» على الثانية أبدًا. والعلامة تفقد معناها بصمت: لا رسالة
 * خطأ يراها المستخدم على الورقة، ولا سجلّ يقول إنّ شيئًا سقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("صلاحية الطباعة تتبع المستند", () => {
  it("الطبيب يطبع السريري ولا يطبع المالي", () => {
    expect(canPrintDoc("doctor", "ceph")).toBe(true);
    expect(canPrintDoc("doctor", "ceph-compare")).toBe(true);
    expect(canPrintDoc("doctor", "receipt")).toBe(false);
    expect(canPrintDoc("doctor", "statement")).toBe(false);
  });

  it("والاستقبال يطبع المالي ولا يطبع السريري", () => {
    expect(canPrintDoc("reception", "receipt")).toBe(true);
    expect(canPrintDoc("reception", "invoice")).toBe(true);
    // التشخيص ليس من اختصاصه — والصفحة نفسها تمنعه، فالمسار يوافقها.
    expect(canPrintDoc("reception", "ceph")).toBe(false);
    expect(canPrintDoc("reception", "ceph-compare")).toBe(false);
  });

  it("والمدير يطبع الاثنين", () => {
    for (const doc of PRINTABLE_DOCS) expect(canPrintDoc("admin", doc), doc).toBe(true);
  });

  it("ودورٌ مجهول أو غائب لا يطبع شيئًا", () => {
    for (const doc of PRINTABLE_DOCS) {
      expect(canPrintDoc("nurse", doc), doc).toBe(false);
      expect(canPrintDoc(null, doc), doc).toBe(false);
      expect(canPrintDoc(undefined, doc), doc).toBe(false);
    }
  });

  it("ولكل نوعٍ مسجَّل جمهورٌ معلوم — فنوعٌ يُضاف بلا جمهور لا يمرّ", () => {
    // بلا هذا يصير النوع الجديد بلا صفّ في الخريطة، فيُقرأ `undefined` ويسقط
    // إلى فرع المال صامتًا — وهو بالضبط العطب الذي جاء هذا الملف ليمنعه.
    // والمجموعة تُقرأ من `PRINT_AUDIENCES` لا تُكتب هنا: جمهورٌ رابع يُضاف يومًا
    // ويُنسى في هذا السطر يجعل الحارس يرفض ما هو صحيح، فيُوسَّع بيدٍ حتى يقبل كل
    // شيء — فيموت الحارس ببطء بدل أن يُكسر مرّة.
    for (const doc of PRINTABLE_DOCS) {
      expect(PRINT_AUDIENCES, doc).toContain(PRINT_AUDIENCE[doc]);
    }
    expect(Object.keys(PRINT_AUDIENCE).sort()).toEqual([...PRINTABLE_DOCS].sort());
  });

  it("والتعرّف على النوع يرفض ما ليس منه", () => {
    expect(isPrintableDoc("ceph-compare")).toBe(true);
    expect(isPrintableDoc("ceph_compare")).toBe(false);
    expect(isPrintableDoc("")).toBe(false);
    expect(isPrintableDoc(null)).toBe(false);
    expect(isPrintableDoc(42)).toBe(false);
  });

  it("وورقة المقارنة مسجَّلةٌ — وإلّا طبعت بلا سجلّ إعادة", () => {
    expect(PRINTABLE_DOCS).toContain("ceph-compare" as PrintableDoc);
  });
});
