import { describe, expect, it } from "vitest";
import {
  canComplete,
  caseProgress,
  daysBetween,
  findWire,
  isElasticClass,
  dueState,
  filterFollowUp,
  followUpSummary,
  isOverdueForAdjustment,
  latenessDays,
  nextAdjustmentDate,
  nextAdjustmentDue,
  sortByLateness,
  nextWire,
  usesArchwires,
  wiresFor,
} from "../lib/ortho";

describe("الأسلاك", () => {
  it("التسلسل يمشي من الأمرن إلى الأصلب", () => {
    const wires = wiresFor("022");
    expect(wires[0].code).toBe("012 NiTi");
    expect(wires[0].round).toBe(true);
    // آخر السلسلة مستطيل — والمستدير لا يتحكّم في ميل الجذور.
    expect(wires[wires.length - 1].round).toBe(false);
    // الفولاذي لا يسبق المرن.
    const firstSteel = wires.findIndex((wire) => wire.material === "SS");
    const lastNiTi = wires.map((wire) => wire.material).lastIndexOf("NiTi");
    expect(firstSteel).toBeGreaterThan(0);
    expect(firstSteel).toBeGreaterThan(wires.findIndex((wire) => wire.material === "NiTi"));
    expect(lastNiTi).toBeLessThan(wires.length);
  });

  it("يقترح التالي، ويقف عند آخر السلسلة", () => {
    expect(nextWire("022", null)?.code).toBe("012 NiTi");
    expect(nextWire("022", "014 NiTi")?.code).toBe("016 NiTi");
    const wires = wiresFor("022");
    expect(nextWire("022", wires[wires.length - 1].code)).toBeNull();
  });

  it("سلكٌ خارج التسلسل لا يُقترح له تالٍ — القرار للطبيب", () => {
    expect(nextWire("022", "سلك خاص")).toBeNull();
    expect(findWire("022", "سلك خاص")).toBeNull();
    expect(findWire("022", "019×025 SS")?.material).toBe("SS");
  });

  it("الشقّان مختلفان", () => {
    expect(wiresFor("018").some((wire) => wire.code === "019×025 SS")).toBe(false);
    expect(wiresFor("022").some((wire) => wire.code === "019×025 SS")).toBe(true);
  });

  it("الأسلاك للثابت وحده", () => {
    expect(usesArchwires("fixed_metal")).toBe(true);
    expect(usesArchwires("fixed_ceramic")).toBe(true);
    expect(usesArchwires("aligners")).toBe(false);
    expect(usesArchwires("removable")).toBe(false);
  });
});

describe("التقدّم", () => {
  it("يحسب ما مضى وما بقي", () => {
    const progress = caseProgress({
      startDate: "2026-01-01", plannedMonths: 18, adjustments: 6,
      lastAdjustmentDate: "2026-06-01", today: "2026-07-01",
    });
    expect(progress.monthsElapsed).toBeCloseTo(6, 0);
    expect(progress.monthsRemaining).toBeCloseTo(12, 0);
    expect(progress.overdue).toBe(false);
    expect(progress.daysSinceLast).toBe(30);
  });

  it("يعلّم تجاوز المدة بلا أن يعتبره خطأ", () => {
    const progress = caseProgress({
      startDate: "2024-01-01", plannedMonths: 18, adjustments: 20,
      lastAdjustmentDate: null, today: "2026-07-01",
    });
    expect(progress.overdue).toBe(true);
    expect(progress.monthsRemaining).toBe(0);
    expect(progress.percent).toBe(100);
    expect(progress.daysSinceLast).toBeNull();
  });

  it("فرق الأيام بلا انزياح منطقة زمنية", () => {
    expect(daysBetween("2026-08-28", "2026-08-29")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });
});

describe("موعد الشدّ", () => {
  it("أربعة أسابيع افتراضًا", () => {
    expect(nextAdjustmentDate("2026-08-01")).toBe("2026-08-29");
    expect(nextAdjustmentDate("2026-08-01", 6)).toBe("2026-09-12");
  });

  it("التأخّر يُحسب من آخر شدّ، ومن البداية إن لم يكن هناك شدّ", () => {
    // آخر شدّ ١ أغسطس، فالموعد ٢٩ أغسطس. ومهلةُ أسبوعٍ بعده قبل أن يُعدّ متأخرًا:
    // مريضٌ تأخّر ثلاثة أيام ليس منقطعًا، وتنبيهٌ عليه يجعل القائمة تُتجاهل.
    expect(isOverdueForAdjustment({
      lastAdjustmentDate: "2026-08-01", startDate: "2026-01-01", today: "2026-09-01",
    })).toBe(false);
    expect(isOverdueForAdjustment({
      lastAdjustmentDate: "2026-08-01", startDate: "2026-01-01", today: "2026-09-10",
    })).toBe(true);
    // بلا شدٍّ بعدُ: يُحسب من تاريخ التركيب.
    expect(isOverdueForAdjustment({
      lastAdjustmentDate: null, startDate: "2026-08-25", today: "2026-09-01",
    })).toBe(false);
    expect(isOverdueForAdjustment({
      lastAdjustmentDate: null, startDate: "2026-06-01", today: "2026-09-01",
    })).toBe(true);
  });
});

describe("الإغلاق", () => {
  it("لا إغلاق بلا مثبّت — الارتداد يُضيع النتيجة", () => {
    const blocked = canComplete({ status: "active", retainer: null });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toContain("المثبّت");
  });

  it("و«لم يُسلَّم» قرارٌ صريح يُقبل", () => {
    expect(canComplete({ status: "active", retainer: "none" }).ok).toBe(true);
    expect(canComplete({ status: "retention", retainer: "bonded" }).ok).toBe(true);
  });

  it("ولا إغلاق لمكتملة أو متوقّفة", () => {
    expect(canComplete({ status: "completed", retainer: "hawley" }).ok).toBe(false);
    expect(canComplete({ status: "discontinued", retainer: "hawley" }).ok).toBe(false);
  });

  it("صنف المطاطات قائمة مغلقة", () => {
    expect(isElasticClass("class_ii")).toBe(true);
    expect(isElasticClass("صنف ثانٍ")).toBe(false);
  });
});

describe("متابعة الشدّ — من انقطع عن موعده", () => {
  it("الموعد من مهلة آخر شدّة كما حدّدها الطبيب", () => {
    expect(nextAdjustmentDue({
      startDate: "2026-01-01", lastAdjustment: "2026-08-01",
      lastNextWeeks: 6, defaultWeeks: 4,
    })).toBe("2026-09-12");
  });

  it("وإن لم يحدّدها رُجع إلى الافتراضي من الإعدادات — لا إلى رقمٍ في الشيفرة", () => {
    expect(nextAdjustmentDue({
      startDate: "2026-01-01", lastAdjustment: "2026-08-01",
      lastNextWeeks: null, defaultWeeks: 3,
    })).toBe("2026-08-22");
  });

  it("ومن لم يُشدّ قطّ يُحسب من تركيب جهازه — وهو أولى من يُتابَع لا من يُستثنى", () => {
    expect(nextAdjustmentDue({
      startDate: "2026-08-01", lastAdjustment: null,
      lastNextWeeks: null, defaultWeeks: 4,
    })).toBe("2026-08-29");
  });

  it("ومهلةُ أسبوعٍ قبل «تأخّر»: ثلاثة أيام ليست انقطاعًا", () => {
    expect(dueState("2026-08-29", "2026-08-20")).toBe("later");
    expect(dueState("2026-08-29", "2026-08-25")).toBe("soon");
    expect(dueState("2026-08-29", "2026-08-29")).toBe("due");
    expect(dueState("2026-08-29", "2026-09-01")).toBe("due");
    expect(dueState("2026-08-29", "2026-09-06")).toBe("overdue");
  });

  it("وأيام التأخّر تُحسب بعد المهلة لا من الموعد", () => {
    expect(latenessDays("2026-08-29", "2026-09-01")).toBe(0);
    expect(latenessDays("2026-08-29", "2026-09-10")).toBe(5);
  });

  /*
   * الحارس الذي يمنع افتراق القاعدتين.
   *
   * `isOverdueForAdjustment` يستعملها ملفّ المريض، و`dueState` تستعملها شاشة
   * المتابعة. ولو افترقتا لقال الملفُّ «في موعده» وقالت القائمة «تأخّر» — ولا
   * يُعرف أيّهما يُصدَّق، فيُترك الاثنان.
   */
  it("و«تأخّر» في القائمة هي «تأخّر» في ملفّ المريض — يومًا بيوم", () => {
    const start = "2026-01-01";
    const last = "2026-08-01";
    const due = nextAdjustmentDue({
      startDate: start, lastAdjustment: last, lastNextWeeks: 4, defaultWeeks: 4,
    });
    for (let day = 20; day <= 60; day += 1) {
      const today = day <= 31
        ? `2026-08-${String(day).padStart(2, "0")}`
        : `2026-09-${String(day - 31).padStart(2, "0")}`;
      expect(dueState(due, today) === "overdue").toBe(isOverdueForAdjustment({
        lastAdjustmentDate: last, startDate: start, today,
      }));
    }
  });
});

describe("ترتيب المتابعة وتصفيتها", () => {
  const one = (over: Partial<Parameters<typeof sortByLateness>[0][number]>) => ({
    id: 1, patientName: "أ", status: "active" as const,
    dueOn: "2026-08-29", due: "later" as const, lateDays: 0, ...over,
  });

  const cases = [
    one({ id: 1, patientName: "سالم", due: "overdue", lateDays: 40, dueOn: "2026-07-01" }),
    one({ id: 2, patientName: "هدى", due: "overdue", lateDays: 5, dueOn: "2026-08-20" }),
    one({ id: 3, patientName: "ريم", due: "due", dueOn: "2026-08-29" }),
    one({ id: 4, patientName: "بشرى", due: "later", dueOn: "2026-10-01" }),
    one({ id: 5, patientName: "منى", status: "retention", due: "overdue", lateDays: 90 }),
  ];

  it("الأطول انقطاعًا أولًا — لا بالاسم ولا بتاريخ البدء", () => {
    expect(sortByLateness(cases).map((c) => c.id)).toEqual([5, 1, 2, 3, 4]);
  });

  it("و«تأخّرت» تعرض النشطة المتأخّرة وحدها", () => {
    expect(filterFollowUp(cases, "overdue").map((c) => c.id)).toEqual([1, 2]);
  });

  it("و«هذا الأسبوع» تضمّ المتأخّر والمستحقّ والقريب لا البعيد", () => {
    expect(filterFollowUp(cases, "week").map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("والتثبيت قائمةٌ على حدة — مراجعةُ مثبّتٍ ليست شدّةً موقوفة", () => {
    expect(filterFollowUp(cases, "retention").map((c) => c.id)).toEqual([5]);
    expect(filterFollowUp(cases, "active").map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });

  it("والأرقام تفصل النشط عن التثبيت — وإلا أخفى عشرون مثبّتًا حالةً توقّفت", () => {
    expect(followUpSummary(cases)).toEqual({ overdue: 2, dueThisWeek: 3, retentionDue: 1 });
  });
});
