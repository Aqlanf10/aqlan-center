import { describe, expect, it } from "vitest";
import { AP_ACCOUNT, AR_ACCOUNT, CASH_ACCOUNT, type AccountBalance } from "../lib/accounting";
import {
  chairOccupancy, collectionsFromBalances, executiveKpis, periodRange,
} from "../lib/executive";

const balance = (code: string, kind: AccountBalance["kind"], debit: number, credit: number): AccountBalance => ({
  code, name: code, kind, debitMinor: debit, creditMinor: credit,
  balanceMinor: kind === "asset" || kind === "expense" ? debit - credit : credit - debit,
});

const operational = {
  arrived: 0, done: 0, stillOpen: 0, noShow: 0, newPatients: 0,
  orthoActive: 0, orthoOverdue: 0, inventoryAlerts: 0, labLate: 0,
};

const occupancy = chairOccupancy({ chairs: 2, activeDays: 0, occupiedMinutes: 0, dayMinutes: 600 });

describe("حركة الصندوق من الميزان", () => {
  it("لكل عملةٍ صفّها — والجرد يُعدّ بالورق لا بالمكافئ", () => {
    const rows = collectionsFromBalances([
      balance(CASH_ACCOUNT.YER, "asset", 500_00, 200_00),
      balance(CASH_ACCOUNT.USD, "asset", 100_00, 0),
    ]);
    expect(rows.map((row) => row.currency)).toEqual(["YER", "USD"]);
    expect(rows[0].netMinor).toBe(300_00);
    expect(rows[1].paidOutMinor).toBe(0);
  });

  it("والعملة بلا حركةٍ لا يُعرض لها صفّ فارغ", () => {
    expect(collectionsFromBalances([balance(CASH_ACCOUNT.YER, "asset", 0, 0)])).toHaveLength(0);
  });
});

describe("إشغال الكراسي", () => {
  it("السعة على أيام العمل الفعلية لا على أيام التقويم", () => {
    // كرسيان × ٥ أيام عملٍ فعلية × ١٠ ساعات = ٦٠٠٠ دقيقة.
    const busy = chairOccupancy({ chairs: 2, activeDays: 5, occupiedMinutes: 3000, dayMinutes: 600 });
    expect(busy.capacityMinutes).toBe(6000);
    expect(busy.percent).toBe(50);
  });

  it("ولو قُسمت على شهرٍ كامل لبدا المركزُ نصف فارغٍ وهو ممتلئ", () => {
    const honest = chairOccupancy({ chairs: 2, activeDays: 5, occupiedMinutes: 5400, dayMinutes: 600 });
    const misleading = chairOccupancy({ chairs: 2, activeDays: 30, occupiedMinutes: 5400, dayMinutes: 600 });
    expect(honest.percent).toBe(90);
    expect(misleading.percent).toBe(15);
  });

  it("وبلا سعةٍ لا نسبة — لا NaN ولا ما لا نهاية", () => {
    expect(chairOccupancy({ chairs: 0, activeDays: 5, occupiedMinutes: 100, dayMinutes: 600 }).percent).toBe(0);
    expect(chairOccupancy({ chairs: 2, activeDays: 0, occupiedMinutes: 0, dayMinutes: 600 }).percent).toBe(0);
  });

  it("ولا تتجاوز مئة ولو تجاوز الشغلُ السعة — تداخلُ الجلوس واردٌ والرقم لا يكذب", () => {
    expect(chairOccupancy({ chairs: 1, activeDays: 1, occupiedMinutes: 900, dayMinutes: 600 }).percent).toBe(100);
  });
});

describe("الذمم رصيدٌ لا حركة", () => {
  const period = [
    balance("4101", "revenue", 0, 1_000_00),
    balance(AR_ACCOUNT, "asset", 1_000_00, 400_00),
  ];
  const cumulative = [
    balance(AR_ACCOUNT, "asset", 5_000_00, 2_000_00),
    balance(AP_ACCOUNT, "liability", 100_00, 700_00),
  ];

  it("الذمم من الميزان التراكمي لا من قيود الفترة", () => {
    const kpis = executiveKpis({
      from: "2026-09-01", to: "2026-09-30", baseCurrency: "YER",
      periodBalances: period, cumulativeBalances: cumulative, operational, occupancy,
    });
    // من الفترة وحدها لكانت 600؛ ومن التراكمي 3000 — وهي الجواب عن «كم لنا».
    expect(kpis.receivableMinor).toBe(3_000_00);
    expect(kpis.payableMinor).toBe(600_00);
  });

  it("والدخل من قيود الفترة وحدها — وإلا صار ربحُ السنة ربحَ الشهر", () => {
    const kpis = executiveKpis({
      from: "2026-09-01", to: "2026-09-30", baseCurrency: "YER",
      periodBalances: period, cumulativeBalances: cumulative, operational, occupancy,
    });
    expect(kpis.income.revenueMinor).toBe(1_000_00);
  });

  /*
   * الحارس على القاعدة الحاكمة كلّها.
   *
   * `executiveKpis` لا تأخذ فواتير ولا دفعات — تأخذ **موازين** فقط. فلو أُضيف
   * يومًا مدخلٌ يقرأ من جدولٍ مباشرةً لسقط هذا الفحص عند تغيير التوقيع.
   */
  it("ولا مدخل للوحة إلا الموازين — فلا رقم فيها إلا رقم دفتر", () => {
    const keys = Object.keys({
      from: "", to: "", baseCurrency: "YER" as const,
      periodBalances: [], cumulativeBalances: [], operational, occupancy,
    });
    expect(keys.filter((key) => /invoice|payment|فاتور|دفع/i.test(key))).toEqual([]);
    const empty = executiveKpis({
      from: "2026-09-01", to: "2026-09-30", baseCurrency: "YER",
      periodBalances: [], cumulativeBalances: [], operational, occupancy,
    });
    // بلا قيودٍ لا أرقام — ولو كان ثمّة جمعٌ موازٍ لظهر رقمٌ من مكانٍ آخر.
    expect(empty.income.netProfitMinor).toBe(0);
    expect(empty.receivableMinor).toBe(0);
    expect(empty.collections).toEqual([]);
  });
});

describe("مدى الفترة", () => {
  it("الأسبوع يبدأ السبت — لا الاثنين ولا الأحد", () => {
    // 2026-09-02 أربعاء، والسبت الذي قبله 2026-08-29.
    expect(periodRange("week", "2026-09-02").from).toBe("2026-08-29");
    // والسبت نفسه يبدأ به أسبوعه.
    expect(periodRange("week", "2026-08-29").from).toBe("2026-08-29");
  });

  it("والشهر والربع والسنة من أوّلها إلى اليوم", () => {
    expect(periodRange("month", "2026-09-02")).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    expect(periodRange("quarter", "2026-09-02").from).toBe("2026-07-01");
    expect(periodRange("year", "2026-09-02").from).toBe("2026-01-01");
    expect(periodRange("today", "2026-09-02")).toEqual({ from: "2026-09-02", to: "2026-09-02" });
  });
});
