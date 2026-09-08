import { describe, expect, it } from "vitest";
import { expectedArrivals, isLate } from "../lib/arrivals";
import { clinicTimeString, toMinutes, type Appointment } from "../lib/schedule";

const appointment = (over: Partial<Appointment> & { id: number }): Appointment => ({
  patientId: 100 + over.id,
  patientName: `مريض ${over.id}`,
  patientPhone: "770111222",
  scheduledDate: "2026-09-08",
  scheduledTime: "10:00",
  durationMinutes: 30,
  note: null,
  status: "booked",
  ...over,
});

describe("ساعة العيادة", () => {
  /*
   * **وهذا الحدّ هو الفخّ الذي يتكرّر في هذا المشروع.**
   *
   * التاسعة والنصف مساءً بغرينتش هي الثانية عشرة والنصف بعد منتصف الليل في تعز.
   * وحسابُ التأخّر بساعة الخادم يقول عن مريضٍ في موعده إنّه تأخّر ثلاث ساعات.
   */
  it("تقرأ ساعة تعز لا ساعة الخادم", () => {
    const moment = new Date("2026-09-08T21:30:00Z");
    expect(clinicTimeString(moment, "Asia/Aden")).toBe("00:30");
    expect(clinicTimeString(moment, "UTC")).toBe("21:30");
  });

  /*
   * ونظامُ ٢٤ ساعة صراحةً.
   *
   * فبنظام ١٢ ساعة تخرج «09:00» للتاسعة صباحًا ومساءً معًا، فيبدو موعدُ السابعة
   * مساءً ماضيًا منذ الصباح — ويُتَّهم مريضٌ بالتأخّر قبل أن يحين وقته.
   */
  it("وبنظام أربعٍ وعشرين ساعة — لا تلتبس التاسعة مساءً بالتاسعة صباحًا", () => {
    expect(clinicTimeString(new Date("2026-09-08T16:00:00Z"), "Asia/Aden")).toBe("19:00");
  });

  /* وقراءةُ الدقائق تستعمل `toMinutes` القائمة — لا نسخةً ثانية تنحرف عنها. */
  it("والدقائق تُقرأ بالدالّة القائمة، وما ليس وقتًا يُردّ", () => {
    expect(toMinutes("09:45")).toBe(585);
    expect(toMinutes("00:00")).toBe(0);
    for (const bad of ["24:00", "10:60", "", "غدًا"]) {
      expect(toMinutes(bad), bad).toBeNull();
    }
  });
});

describe("مُنتظَرو اليوم", () => {
  /*
   * **ومن وصل يسقط من القائمة وحده.**
   *
   * فحالةُ موعده تنقلب إلى `arrived` عند تسجيل الوصول، والقائمة مشتقّة منها.
   * ولو بقي معروضًا لضغطت الاستقبال «حضر» على من هو جالسٌ على الكرسي.
   */
  it("لا يُنتظَر إلّا المحجوز — لا الواصل ولا الملغى ولا من لم يحضر", () => {
    const list = expectedArrivals([
      appointment({ id: 1, status: "booked" }),
      appointment({ id: 2, status: "arrived" }),
      appointment({ id: 3, status: "done" }),
      appointment({ id: 4, status: "cancelled" }),
      appointment({ id: 5, status: "no_show" }),
    ], "10:00");
    expect(list.map((one) => one.appointmentId)).toEqual([1]);
  });

  it("والترتيب بالساعة لا برقم الحجز", () => {
    const list = expectedArrivals([
      appointment({ id: 9, scheduledTime: "09:00" }),
      appointment({ id: 2, scheduledTime: "11:30" }),
      appointment({ id: 5, scheduledTime: "10:15" }),
    ], "09:00");
    expect(list.map((one) => one.scheduledTime)).toEqual(["09:00", "10:15", "11:30"]);
  });

  it("والتأخّر فرقٌ بالدقائق عن ساعة العيادة", () => {
    const [row] = expectedArrivals([appointment({ id: 1, scheduledTime: "09:30" })], "10:05");
    expect(row.lateMinutes).toBe(35);
    expect(isLate(row)).toBe(true);
  });

  /*
   * **ولا تأخّرَ بالسالب.**
   *
   * فموعدُ الرابعة عصرًا ليس «متأخّرًا سالبَ ثلاث مئة دقيقة» في العاشرة صباحًا،
   * ورقمٌ سالب في الشاشة يُقرأ عددًا كبيرًا ويقفز المريض إلى رأس القائمة.
   */
  it("ومن لم يحن وقته ليس متأخّرًا", () => {
    const [row] = expectedArrivals([appointment({ id: 1, scheduledTime: "16:00" })], "10:00");
    expect(row.lateMinutes).toBe(0);
    expect(isLate(row)).toBe(false);
  });

  it("ووقتٌ فاسد لا يُنتج تأخّرًا مخترَعًا", () => {
    const [row] = expectedArrivals([appointment({ id: 1, scheduledTime: "لا وقت" })], "10:00");
    expect(row.lateMinutes).toBe(0);
  });

  it("وتأكيدُ المريض من البوّابة يُعرض ولا يُسقطه من الانتظار", () => {
    // فالتأكيد وعدٌ بالحضور لا حضور، وتسجيلُ الوصول بيد الاستقبال.
    const [row] = expectedArrivals(
      [appointment({ id: 1, patientConfirmedAt: "2026-09-08T06:00:00Z" })], "09:00");
    expect(row.confirmed).toBe(true);
    expect(row.appointmentId).toBe(1);
  });
});
