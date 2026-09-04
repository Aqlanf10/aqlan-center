import { describe, expect, it } from "vitest";
import {
  daysBetween, debtAge, debtsInOrder, outstanding, paidUpTo, type DebtHistory,
} from "../lib/debtAge";

const TODAY = "2026-09-03";

const history = (over: Partial<DebtHistory> = {}): DebtHistory => ({
  opening: null, invoices: [], payments: [], ...over,
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * عمر الدين من أقدم ما لم يُسدَّد
 *
 * وكان يُحسب من أقدم فاتورةٍ للمريض بلا نظرٍ إلى ما دفع. فمن عالجناه قبل سنةٍ
 * وسدّد، ثم جاء الأسبوع الماضي لفاتورةٍ جديدة، يظهر «منذ ٤٠٠ يومًا» ويُصنَّف
 * دَينًا ميتًا — فيُطارَد بمكالماتٍ يستحقّها غيره، أو يُشطب دينُه وهو حاضرٌ يدفع.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("عمر الدين", () => {
  it("**من سدّد القديم وبقيت عليه فاتورةُ الأسبوع عمرُ دينه أسبوع**", () => {
    const patient = history({
      invoices: [
        { date: "2025-07-30", minor: 100_000 },  // قبل أكثر من سنة
        { date: "2026-08-27", minor: 40_000 },   // الأسبوع الماضي
      ],
      payments: [{ date: "2025-08-15", minor: 100_000, isRefund: false }],
    });
    const age = debtAge(patient, TODAY);
    expect(age.since).toBe("2026-08-27");
    expect(age.ageDays).toBe(7);
    // والباقي عليه فاتورةُ الأسبوع وحدها.
    expect(outstanding(patient, TODAY)).toBe(40_000);
  });

  it("ومن لم يسدّد شيئًا عمرُ دينه من أقدم فاتورة", () => {
    const patient = history({
      invoices: [
        { date: "2026-06-05", minor: 30_000 },
        { date: "2026-08-27", minor: 40_000 },
      ],
    });
    expect(debtAge(patient, TODAY).since).toBe("2026-06-05");
  });

  it("ومن سدّد كلَّ شيءٍ فلا عمر لدَينه", () => {
    const patient = history({
      invoices: [{ date: "2026-06-05", minor: 30_000 }],
      payments: [{ date: "2026-06-06", minor: 30_000, isRefund: false }],
    });
    expect(debtAge(patient, TODAY)).toEqual({ since: null, ageDays: 0 });
    expect(outstanding(patient, TODAY)).toBe(0);
  });

  it("وسدادٌ جزئيّ يُبقي العمر على أقدم ما لم يُغطَّ", () => {
    const patient = history({
      invoices: [
        { date: "2026-01-10", minor: 50_000 },
        { date: "2026-05-10", minor: 50_000 },
      ],
      payments: [{ date: "2026-06-01", minor: 30_000, isRefund: false }],
    });
    // ٣٠ ألفًا لا تغطّي الخمسين الأولى، فالعمر من كانون الثاني.
    expect(debtAge(patient, TODAY).since).toBe("2026-01-10");
  });

  it("وحين يغطّي المدفوعُ الأولى بالتمام ينتقل العمر إلى التالية", () => {
    const patient = history({
      invoices: [
        { date: "2026-01-10", minor: 50_000 },
        { date: "2026-05-10", minor: 50_000 },
      ],
      payments: [{ date: "2026-06-01", minor: 50_000, isRefund: false }],
    });
    expect(debtAge(patient, TODAY).since).toBe("2026-05-10");
  });

  it("**والرصيد الافتتاحي أقدم من كل فاتورة**", () => {
    // فعملُه تمّ قبل النظام، وعدُّه أحدثَ يجعل دينًا عمرُه سنتان يبدو ابن شهر.
    const patient = history({
      opening: { date: "2026-01-01", minor: 20_000 },
      invoices: [{ date: "2026-01-01", minor: 10_000 }],
    });
    expect(debtsInOrder(patient, TODAY)[0].minor).toBe(20_000);
    expect(debtAge(patient, TODAY).since).toBe("2026-01-01");
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * رصيدٌ افتتاحيّ أُدخل **اليوم** وفواتيرُ أقدم منه تاريخًا
   *
   * حقلُ التاريخ في شاشة الرصيد الافتتاحي اختياري، ومن تركه فارغًا وضع المسارُ
   * تاريخ اليوم (`app/api/opening-balances/route.ts`). فيقع هذا كلَّ مرةٍ يُدخِل
   * فيها المديرُ رصيدًا قديمًا على مريضٍ له فواتيرُ في النظام.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it("**ورصيدٌ افتتاحيٌّ أُدخل اليوم يتقدّم على فاتورةٍ أقدم منه تاريخًا**", () => {
    const patient = history({
      // أُدخل اليوم لأن حقل التاريخ تُرك فارغًا — وعملُه سابقٌ للنظام كلِّه.
      opening: { date: TODAY, minor: 20_000 },
      invoices: [{ date: "2025-06-10", minor: 20_000 }],
      payments: [{ date: TODAY, minor: 20_000, isRefund: false }],
    });
    // الافتتاحيُّ أوّلًا فتغطّيه الدفعة، وتبقى فاتورةُ ٢٠٢٥ هي غيرَ المسدَّدة.
    expect(debtsInOrder(patient, TODAY)[0].date).toBe("2025-06-10");
    expect(debtsInOrder(patient, TODAY).map((debt) => debt.minor)).toEqual([20_000, 20_000]);
    const age = debtAge(patient, TODAY);
    // وكان يقول «منذ صفر يومًا» فيُصنَّف دَينًا طازجًا لا يُطارَد.
    expect(age.since).toBe("2025-06-10");
    expect(age.ageDays).toBe(450);
    expect(outstanding(patient, TODAY)).toBe(20_000);
  });

  it("ومن لم يدفع شيئًا لا يصير دينُه ابنَ يومه لأن الافتتاحيّ أُدخل اليوم", () => {
    // تقديمُ الافتتاحيّ بتاريخ إدخاله وحده يقلب العمر من ٦٥٢ يومًا إلى صفر.
    const patient = history({
      opening: { date: TODAY, minor: 20_000 },
      invoices: [{ date: "2024-11-20", minor: 50_000 }],
    });
    const age = debtAge(patient, TODAY);
    expect(age.since).toBe("2024-11-20");
    expect(age.ageDays).toBe(652);
  });

  it("وتاريخٌ افتتاحيٌّ كتبه المدير بيده يبقى على حاله — لا يُقدَّم ولا يُؤخَّر", () => {
    const patient = history({
      opening: { date: "2024-01-15", minor: 100_000 },
      invoices: [{ date: "2026-08-27", minor: 40_000 }],
    });
    expect(debtsInOrder(patient, TODAY)[0].date).toBe("2024-01-15");
    expect(debtAge(patient, TODAY).since).toBe("2024-01-15");
  });

  it("ومن سدّد افتتاحيَّه كاملًا يبقى عليه عمرُ فاتورة اليوم وحدها", () => {
    const patient = history({
      opening: { date: "2024-01-15", minor: 100_000 },
      invoices: [{ date: TODAY, minor: 40_000 }],
      payments: [{ date: TODAY, minor: 100_000, isRefund: false }],
    });
    const age = debtAge(patient, TODAY);
    expect(age.since).toBe(TODAY);
    expect(age.ageDays).toBe(0);
    expect(outstanding(patient, TODAY)).toBe(40_000);
  });

  it("والترتيب لا يمسّ سجلَّ المريض — قراءةٌ لا تُعيد كتابة ما قرأت", () => {
    const invoices = [
      { date: "2026-08-27", minor: 40_000 },
      { date: "2025-06-10", minor: 20_000 },
    ];
    const patient = history({ opening: { date: TODAY, minor: 20_000 }, invoices });
    debtsInOrder(patient, TODAY);
    expect(invoices[0].date).toBe("2026-08-27");
    // وتاريخُ الافتتاحيّ المسجَّل يبقى كما كُتب في القاعدة.
    expect(patient.opening?.date).toBe(TODAY);
  });

  it("والاسترداد يزيد الدين لا ينقصه", () => {
    const patient = history({
      invoices: [{ date: "2026-06-05", minor: 30_000 }],
      payments: [
        { date: "2026-06-06", minor: 30_000, isRefund: false },
        { date: "2026-07-01", minor: 10_000, isRefund: true },
      ],
    });
    expect(paidUpTo(patient, TODAY)).toBe(20_000);
    expect(outstanding(patient, TODAY)).toBe(10_000);
    expect(debtAge(patient, TODAY).since).toBe("2026-06-05");
  });

  it("وما بعد تاريخ السؤال لا يدخل الحساب", () => {
    const patient = history({
      invoices: [
        { date: "2026-06-05", minor: 30_000 },
        { date: "2026-12-01", minor: 90_000 },
      ],
      payments: [{ date: "2026-12-02", minor: 30_000, isRefund: false }],
    });
    // بتاريخ اليوم: الفاتورة الثانية ودفعتُها لم تقعا بعد.
    expect(outstanding(patient, TODAY)).toBe(30_000);
    expect(debtAge(patient, TODAY).since).toBe("2026-06-05");
  });

  it("وفاتورةٌ ملغاة بصفرٍ أو سالبة لا تُنشئ دَينًا", () => {
    const patient = history({ invoices: [{ date: "2026-01-01", minor: 0 }] });
    expect(debtAge(patient, TODAY).since).toBeNull();
  });

  it("والأيام تُحسب من مكوّنات التاريخ لا من طابعٍ بتوقيت آخر", () => {
    // اليمن على ‎+٣‎: حسابٌ بطوابع محلّية يعطي يومًا زائدًا أو ناقصًا.
    expect(daysBetween("2026-08-27", "2026-09-03")).toBe(7);
    expect(daysBetween("2026-09-03", "2026-09-03")).toBe(0);
    expect(daysBetween("2026-09-04", "2026-09-03")).toBe(0);
    expect(daysBetween("سنة", "2026-09-03")).toBe(0);
  });
});
