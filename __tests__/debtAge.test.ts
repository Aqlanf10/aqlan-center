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
