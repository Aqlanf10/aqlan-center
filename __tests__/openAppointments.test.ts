import { describe, expect, it } from "vitest";
import { daysBetween, openAppointments } from "../lib/openAppointments";
import type { Appointment } from "../lib/schedule";

const TODAY = "2026-09-08";

const appointment = (over: Partial<Appointment> & { id: number }): Appointment => ({
  patientId: 200 + over.id,
  patientName: `مريض ${over.id}`,
  patientPhone: "770111222",
  scheduledDate: "2026-09-01",
  scheduledTime: "10:00",
  durationMinutes: 30,
  note: null,
  status: "booked",
  ...over,
});

describe("فرق الأيام", () => {
  it("يُحسب تقويميًّا", () => {
    expect(daysBetween("2026-09-01", "2026-09-08")).toBe(7);
    expect(daysBetween("2026-09-08", "2026-09-08")).toBe(0);
  });

  /*
   * وعبر حدود الشهر والسنة — والحساب بـ`Date.UTC` لا بتاريخٍ محلي.
   *
   * فالجمع المحلي عبر حدود التوقيت الصيفي يعيد اليوم نفسه أو يقفز يومين، وعددُ
   * أيام الغياب يُبنى عليه ترتيبُ من يُتَّصل به أوّلًا.
   */
  it("وعبر حدود الشهر والسنة", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toBe(3);
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
  });
});

describe("مواعيد لم تُغلَق", () => {
  /*
   * **وهذه هي الثغرة بعينها.**
   *
   * موعدٌ مضى ولم يُسجَّل وصولُ صاحبه ولا غيابُه يبقى `booked` أبدًا: لا في
   * قائمة اليوم (تاريخُه مضى)، ولا في المتابعة (تختار `no_show` وحدها).
   */
  it("المحجوز الذي مضى يومُه يظهر", () => {
    const list = openAppointments([appointment({ id: 1, scheduledDate: "2026-09-01" })], TODAY);
    expect(list.map((one) => one.appointmentId)).toEqual([1]);
    expect(list[0].daysAgo).toBe(7);
  });

  /*
   * **ومواعيدُ اليوم ليست منها.**
   *
   * يومُها لم ينتهِ وصاحبُها قد يصل بعد ساعة، وإغلاقُها الآن يشطب مريضًا في
   * الطريق. وهي معروضةٌ في «مُنتظَرون اليوم» على شاشة العمليات أصلًا.
   */
  it("ولا موعدُ اليوم — صاحبُه قد يصل بعد ساعة", () => {
    expect(openAppointments([appointment({ id: 1, scheduledDate: TODAY })], TODAY)).toEqual([]);
  });

  it("ولا موعدُ الغد", () => {
    expect(openAppointments([appointment({ id: 1, scheduledDate: "2026-09-20" })], TODAY)).toEqual([]);
  });

  /* وما فُصل فيه ليس معلّقًا — القرار اتُّخذ، صوابًا كان أو خطأً. */
  it("وما فُصل فيه لا يُطلب فيه قرارٌ ثانٍ", () => {
    const list = openAppointments([
      appointment({ id: 1, status: "booked" }),
      appointment({ id: 2, status: "arrived" }),
      appointment({ id: 3, status: "done" }),
      appointment({ id: 4, status: "cancelled" }),
      appointment({ id: 5, status: "no_show" }),
    ], TODAY);
    expect(list.map((one) => one.appointmentId)).toEqual([1]);
  });

  it("والأقدم أوّلًا — من غاب منذ أسبوعين أولى بمكالمة", () => {
    const list = openAppointments([
      appointment({ id: 1, scheduledDate: "2026-09-05" }),
      appointment({ id: 2, scheduledDate: "2026-08-25" }),
      appointment({ id: 3, scheduledDate: "2026-09-01" }),
    ], TODAY);
    expect(list.map((one) => one.scheduledDate))
      .toEqual(["2026-08-25", "2026-09-01", "2026-09-05"]);
  });

  it("ويوماهما واحدٌ فيُرتَّبان بالساعة", () => {
    const list = openAppointments([
      appointment({ id: 1, scheduledDate: "2026-09-01", scheduledTime: "14:00" }),
      appointment({ id: 2, scheduledDate: "2026-09-01", scheduledTime: "09:30" }),
    ], TODAY);
    expect(list.map((one) => one.appointmentId)).toEqual([2, 1]);
  });
});
