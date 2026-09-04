import { describe, expect, it } from "vitest";
import { CARD_APPOINTMENTS, isUpcoming, upcomingAppointments } from "../lib/patientCard";
import type { Appointment, AppointmentStatus } from "../lib/schedule";

const TODAY = "2026-09-03";

const at = (
  scheduledDate: string,
  scheduledTime: string,
  status: AppointmentStatus = "booked",
  id = Number(scheduledDate.replaceAll("-", "") + scheduledTime.replace(":", "")),
): Appointment => ({
  id, patientId: 1, patientName: "مريض", patientPhone: null,
  scheduledDate, scheduledTime, durationMinutes: 30,
  note: null, status,
});

describe("بطاقة المريض — أيّ المواعيد تُطبع عليها", () => {
  it("موعد اليوم قادمٌ — المريض يحمل بطاقته وهو في الطريق", () => {
    expect(isUpcoming(at(TODAY, "10:00"), TODAY)).toBe(true);
  });

  it("وما مضى لا يُطبع", () => {
    expect(isUpcoming(at("2026-09-02", "10:00"), TODAY)).toBe(false);
  });

  it("**والملغى ومن لم يحضر لا يُطبعان** — بطاقةٌ تُرسل مريضًا إلى موعدٍ أُلغي", () => {
    expect(isUpcoming(at("2026-09-10", "10:00", "cancelled"), TODAY)).toBe(false);
    expect(isUpcoming(at("2026-09-10", "10:00", "no_show"), TODAY)).toBe(false);
  });

  it("والمنتهي لا يُطبع وإن كان تاريخه اليوم", () => {
    expect(isUpcoming(at(TODAY, "09:00", "done"), TODAY)).toBe(false);
  });

  it("ويُرتَّب بالأقرب أوّلًا — تاريخًا ثم ساعة", () => {
    const sorted = upcomingAppointments(
      [at("2026-09-20", "09:00"), at(TODAY, "16:00"), at(TODAY, "08:30")],
      TODAY,
    );
    expect(sorted.map((one) => `${one.scheduledDate} ${one.scheduledTime}`))
      .toEqual([`${TODAY} 08:30`, `${TODAY} 16:00`, "2026-09-20 09:00"]);
  });

  it("ولا يزيد عن ثلاثة — بطاقةٌ فيها عشرة مواعيد لا تُقرأ", () => {
    const many = ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"]
      .map((date) => at(date, "10:00"));
    expect(upcomingAppointments(many, TODAY)).toHaveLength(CARD_APPOINTMENTS);
    // والثلاثة هي الأقرب لا أيّ ثلاثة.
    expect(upcomingAppointments(many, TODAY)[0].scheduledDate).toBe("2026-09-05");
  });

  it("ومريضٌ بلا موعدٍ قادم يعطي قائمةً فارغة لا خطأً", () => {
    expect(upcomingAppointments([at("2026-08-01", "10:00")], TODAY)).toEqual([]);
    expect(upcomingAppointments([], TODAY)).toEqual([]);
  });

  it("والمقارنة نصّيّة على تاريخ العيادة — لا تمرّ بـDate ولا بمنطقةٍ زمنية", () => {
    // آخر لحظةٍ في السنة: تحويلٌ إلى UTC يقفز بالتاريخ يومًا كاملًا (اليمن +٣).
    const newYearEve = at("2026-12-31", "23:30");
    expect(isUpcoming(newYearEve, "2026-12-31")).toBe(true);
    expect(isUpcoming(newYearEve, "2027-01-01")).toBe(false);
  });
});
