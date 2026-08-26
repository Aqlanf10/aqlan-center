import { describe, expect, it } from "vitest";
import {
  checkSlot, dayLoad, nextFreeTime, overlappingCount, toMinutes, toTime,
  type Appointment,
} from "../lib/schedule";

const DATE = "2026-08-27";

function appt(over: Partial<Appointment> & { id: number }): Appointment {
  return {
    patientId: over.id, patientName: `مريض ${over.id}`, patientPhone: null,
    scheduledDate: DATE, scheduledTime: "10:00", durationMinutes: 30,
    note: null, status: "booked", ...over,
  };
}

describe("الوقت", () => {
  it("يحوّل بين النص والدقائق", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toTime(570)).toBe("09:30");
  });
  it("يرفض الوقت غير الصالح بدل تفسيره", () => {
    expect(toMinutes("25:00")).toBeNull();
    expect(toMinutes("10:70")).toBeNull();
    expect(toMinutes("صباحًا")).toBeNull();
  });
});

describe("التقاطع", () => {
  it("يكشف تقاطعًا جزئيًا لا تطابقًا فقط", () => {
    // 10:00 لستين دقيقة يصطدم بـ10:30 — والفحص بالتطابق وحده كان سيسمح بهما.
    const list = [appt({ id: 1, scheduledTime: "10:30", durationMinutes: 30 })];
    expect(overlappingCount(list, DATE, "10:00", 60)).toBe(1);
  });

  it("لا يعدّ الحجز المتتالي تعارضًا", () => {
    // ينتهي 10:00 ويبدأ 10:00 — هذا الحجز الصحيح المتلاصق لا تعارض.
    const list = [appt({ id: 1, scheduledTime: "09:30", durationMinutes: 30 })];
    expect(overlappingCount(list, DATE, "10:00", 30)).toBe(0);
  });

  it("يتجاهل الملغى ومن لم يحضر لأنهما لا يشغلان كرسيًا", () => {
    const list = [
      appt({ id: 1, status: "cancelled" }),
      appt({ id: 2, status: "no_show" }),
      appt({ id: 3, status: "done" }),
    ];
    expect(overlappingCount(list, DATE, "10:00", 30)).toBe(0);
  });

  it("يتجاهل مواعيد يوم آخر", () => {
    const list = [appt({ id: 1, scheduledDate: "2026-08-28" })];
    expect(overlappingCount(list, DATE, "10:00", 30)).toBe(0);
  });
});

describe("حارس الكراسي", () => {
  it("يسمح بمريضين على كرسيين ويرفض الثالث", () => {
    const two = [appt({ id: 1 }), appt({ id: 2 })];
    expect(checkSlot([appt({ id: 1 })], DATE, "10:00", 30, 2).allowed).toBe(true);
    const blocked = checkSlot(two, DATE, "10:00", 30, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.conflicting).toBe(2);
    // الرسالة تذكر العدد: «غير متاح» وحدها تدفع الاستقبال للتخمين.
    expect(blocked.reason).toContain("2 من 2");
  });

  it("يرفض المدة غير المنطقية", () => {
    expect(checkSlot([], DATE, "10:00", 0, 2).allowed).toBe(false);
    expect(checkSlot([], DATE, "10:00", 600, 2).allowed).toBe(false);
  });

  it("يستثني الموعد نفسه عند تعديله فلا يصطدم بذاته", () => {
    const list = [appt({ id: 7 }), appt({ id: 8 })];
    expect(checkSlot(list, DATE, "10:00", 30, 2, 7).allowed).toBe(true);
  });
});

describe("أقرب وقت فارغ", () => {
  it("يقترح بديلًا محددًا حين يمتلئ الوقت المطلوب", () => {
    const full = [
      appt({ id: 1, scheduledTime: "10:00", durationMinutes: 30 }),
      appt({ id: 2, scheduledTime: "10:00", durationMinutes: 30 }),
    ];
    expect(nextFreeTime(full, DATE, "10:00", 30, 2)).toBe("10:30");
  });

  it("يعيد null حين لا يتسع اليوم", () => {
    expect(nextFreeTime([], DATE, "20:45", 60, 2, "21:00")).toBeNull();
  });
});

describe("حِمل اليوم", () => {
  it("يقيس المحجوز مقابل الطاقة الحقيقية للكرسيين", () => {
    // 09:00–21:00 = 720 دقيقة × كرسيين = 1440
    const load = dayLoad([appt({ id: 1, durationMinutes: 60 }), appt({ id: 2, durationMinutes: 60 })], DATE, 2);
    expect(load.capacityMinutes).toBe(1440);
    expect(load.bookedMinutes).toBe(120);
    expect(load.booked).toBe(2);
    expect(load.percent).toBe(8);
  });
});
