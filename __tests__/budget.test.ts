import { describe, expect, it } from "vitest";
import {
  NEAR_PERCENT, budgetFor, budgetLines, budgetStatus, isBudgetMonth, monthOf,
  type BudgetRow,
} from "../lib/budget";
import { EXPENSE_CATEGORIES } from "../lib/expenses";

const row = (id: number, category: BudgetRow["category"], amountMinor: number, effectiveFrom: string): BudgetRow =>
  ({ id, category, amountMinor, effectiveFrom, note: null });

describe("سقفُ البند في شهره", () => {
  const rows = [
    row(1, "materials", 200_000, "2026-01"),
    row(2, "materials", 300_000, "2026-06"),
    row(3, "salary", 900_000, "2026-01"),
  ];

  it("يسري من شهره فصاعدًا حتى يُكتب أحدث", () => {
    expect(budgetFor(rows, "materials", "2026-03")?.amountMinor).toBe(200_000);
    expect(budgetFor(rows, "materials", "2026-06")?.amountMinor).toBe(300_000);
    expect(budgetFor(rows, "materials", "2026-12")?.amountMinor).toBe(300_000);
  });

  it("**وشهرٌ قبل أوّل سقفٍ بلا سقف** — لا يُسحب السقف إلى الوراء", () => {
    expect(budgetFor(rows, "materials", "2025-12")).toBeNull();
  });

  it("ولا يخلط بندًا ببند", () => {
    expect(budgetFor(rows, "rent", "2026-06")).toBeNull();
    expect(budgetFor(rows, "salary", "2026-06")?.amountMinor).toBe(900_000);
  });

  it("وسقفان لشهرٍ واحد: الأحدث إدراجًا هو رأي المالك الأخير", () => {
    const edited = [...rows, row(9, "materials", 250_000, "2026-06")];
    expect(budgetFor(edited, "materials", "2026-07")?.amountMinor).toBe(250_000);
  });

  it("والشهر يُشتقّ من تاريخ العيادة", () => {
    expect(monthOf("2026-09-04")).toBe("2026-09");
    expect(isBudgetMonth("2026-09")).toBe(true);
    expect(isBudgetMonth("2026-13")).toBe(false);
    expect(isBudgetMonth("2026-9")).toBe(false);
    expect(isBudgetMonth("2026-09-04")).toBe(false);
  });
});

describe("حالُ البند من سقفه", () => {
  it("**بلا سقفٍ لا حكم** — لا يُعرض أخضرَ كأنّه في حدوده", () => {
    const status = budgetStatus(500_000, null);
    expect(status.level).toBe("none");
    expect(status.percent).toBeNull();
    expect(status.remainingMinor).toBeNull();
  });

  it("ودون التنبيه تمام، وعنده تنبيه، وفوقه تجاوز", () => {
    expect(budgetStatus(100_000, 200_000).level).toBe("ok");
    expect(budgetStatus(160_000, 200_000).level).toBe("near");
    expect(budgetStatus(200_001, 200_000).level).toBe("over");
    expect(NEAR_PERCENT).toBe(80);
  });

  it("والمساوي للسقف ليس تجاوزًا — السقف مسموحٌ لا ممنوع", () => {
    const status = budgetStatus(200_000, 200_000);
    expect(status.level).toBe("near");
    expect(status.remainingMinor).toBe(0);
  });

  it("**وسقفُ صفرٍ ليس غياب سقف**: قرارٌ بألّا يُصرف، فأيّ مصروفٍ تجاوز", () => {
    expect(budgetStatus(0, 0).level).toBe("ok");
    expect(budgetStatus(1, 0).level).toBe("over");
    // ولا قسمةَ على صفر.
    expect(budgetStatus(1, 0).percent).toBeNull();
    expect(Number.isFinite(budgetStatus(1, 0).remainingMinor!)).toBe(true);
  });

  it("والمتبقّي سالبٌ عند التجاوز — يقول كم جُووز لا أنّه جُووز", () => {
    expect(budgetStatus(250_000, 200_000).remainingMinor).toBe(-50_000);
  });

  it("والنسبة تُقرَّب لا تُقصّ", () => {
    expect(budgetStatus(1_995, 10_000).percent).toBe(20);
  });
});

describe("سطور الشهر", () => {
  const rows = [row(1, "materials", 200_000, "2026-01")];

  it("**تُعرض البنود كلُّها** — والغائب من القائمة يُقرأ صفرًا وقد يكون منسيًّا", () => {
    const lines = budgetLines(rows, { materials: 50_000 }, "2026-03");
    expect(lines).toHaveLength(EXPENSE_CATEGORIES.length);
    expect(lines.map((one) => one.category)).toEqual(EXPENSE_CATEGORIES);
  });

  it("وما لا سقف له يُعرض «بلا سقف» لا أخضر", () => {
    const lines = budgetLines(rows, { materials: 50_000, rent: 900_000 }, "2026-03");
    expect(lines.find((one) => one.category === "rent")!.status.level).toBe("none");
    expect(lines.find((one) => one.category === "materials")!.status.level).toBe("ok");
  });

  it("ومصروفٌ سالب لا يُقلب سقفًا — يُعامَل صفرًا", () => {
    const lines = budgetLines(rows, { materials: -5_000 }, "2026-03");
    expect(lines.find((one) => one.category === "materials")!.spentMinor).toBe(0);
  });
});
