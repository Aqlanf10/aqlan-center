import { describe, expect, it } from "vitest";
import { dateLong, friendlyDate,
  friendlyDateLong, friendlyTime, reminderText, toWhatsAppNumber, whatsAppLink } from "../lib/reminders";
import type { Appointment } from "../lib/schedule";

const appointment: Appointment = {
  id: 1, patientId: 1, patientName: "عبدالله محمد", patientPhone: "770245745",
  scheduledDate: "2026-08-27", scheduledTime: "10:00", durationMinutes: 30,
  note: null, status: "booked",
};

describe("رقم واتساب اليمني", () => {
  it("يضيف مفتاح الدولة للرقم المحلي", () => {
    expect(toWhatsAppNumber("770245745")).toBe("967770245745");
    expect(toWhatsAppNumber("0770245745")).toBe("967770245745");
  });
  it("يقبل الرقم الدولي كما هو", () => {
    expect(toWhatsAppNumber("967770245745")).toBe("967770245745");
    expect(toWhatsAppNumber("+967 770 245 745")).toBe("967770245745");
  });
  it("يحوّل الأرقام العربية الهندية القادمة من لوحة مفاتيح الهاتف", () => {
    expect(toWhatsAppNumber("٧٧٠٢٤٥٧٤٥")).toBe("967770245745");
  });
  it("يرفض ما لا يصلح بدل فتح محادثة مع رقم خاطئ", () => {
    expect(toWhatsAppNumber("04253028")).toBeNull();  // أرضي
    expect(toWhatsAppNumber("12345")).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber("")).toBeNull();
  });
});

describe("صياغة الموعد للمريض", () => {
  it("يبدأ بيوم الأسبوع لأنه ما يتذكره المريض", () => {
    expect(friendlyDate("2026-08-27")).toContain("الخميس");
  });
  it("يكتب الوقت بصيغة يقرأها بلا حساب", () => {
    expect(friendlyTime("10:00")).toBe("10:00 صباحًا");
    expect(friendlyTime("16:30")).toBe("4:30 مساءً");
    expect(friendlyTime("12:15")).toBe("12:15 مساءً");
    expect(friendlyTime("00:30")).toBe("12:30 صباحًا");
  });
});

describe("نص الرسالة", () => {
  it("يذكر الاسم والموعد ويفتح باب التأجيل", () => {
    const text = reminderText(appointment, "upcoming");
    expect(text).toContain("عبدالله محمد");
    expect(text).toContain("الخميس");
    expect(text).toContain("10:00 صباحًا");
    // الجملة التي تحرّر الكرسي: من يستطيع التأجيل يعتذر بدل أن يتغيّب.
    expect(text).toContain("أخبرونا لنؤجله");
  });

  it("رسالة المتغيّب لا تلومه", () => {
    const text = reminderText(appointment, "missed");
    expect(text).toContain("افتقدناكم");
    expect(text).not.toContain("لم تحضر");
    expect(text).not.toContain("تخلفت");
  });
});

describe("الرابط", () => {
  it("يبني رابط واتساب صالحًا", () => {
    const link = whatsAppLink(appointment, "upcoming");
    expect(link).toContain("https://wa.me/967770245745?text=");
  });
  it("يعيد null بلا رقم صالح بدل رابط مكسور", () => {
    expect(whatsAppLink({ ...appointment, patientPhone: null }, "upcoming")).toBeNull();
    expect(whatsAppLink({ ...appointment, patientPhone: "04253028" }, "upcoming")).toBeNull();
  });
});

describe("تاريخ الملف", () => {
  it("يحمل السنة — ملف مريض تقويم فيه زيارات من سنتين", () => {
    expect(friendlyDateLong("2026-08-27")).toBe("الخميس 27/08/2026");
    expect(friendlyDateLong("2024-08-27")).toBe("الثلاثاء 27/08/2024");
  });
});

/*
 * التاريخ بلغة الورقة.
 *
 * وورقةٌ إنجليزية عليها يوم أسبوعٍ عربي ليست إنجليزية: تخرج إلى زميلٍ لا يقرأ
 * العربية — وهو أوّل من تُكتب له الورقة الإنجليزية أصلًا.
 */
describe("التاريخ الطويل بلغة الورقة", () => {
  it("عربيٌّ في العربية وإنجليزيٌّ في الإنجليزية", () => {
    expect(dateLong("2026-09-03", "ar")).toBe("الخميس 03/09/2026");
    expect(dateLong("2026-09-03", "en")).toBe("Thursday 03/09/2026");
  });

  it("ولا حرفَ عربيًّا في الإنجليزية", () => {
    // الحارس على المخرج نفسه لا على يومٍ بعينه: أيّ يومٍ يتسرّب يُمسك.
    for (let day = 1; day <= 28; day += 1) {
      const text = dateLong(`2026-02-${String(day).padStart(2, "0")}`, "en");
      expect(/[\u0600-\u06FF]/.test(text), text).toBe(false);
    }
  });

  it("والترقيم واحدٌ في اللغتين — يوم/شهر/سنة", () => {
    // وإلّا قُرئ ٠٣/٠٩ سبتمبرَ الثالثَ في ورقةٍ وآذارَ التاسعَ في أخرى.
    expect(dateLong("2026-09-03", "ar")).toContain("03/09/2026");
    expect(dateLong("2026-09-03", "en")).toContain("03/09/2026");
  });

  it("وتاريخٌ فاسد يُعاد كما هو في اللغتين", () => {
    expect(dateLong("ليس تاريخًا", "en")).toBe("ليس تاريخًا");
    expect(dateLong("", "ar")).toBe("");
  });

  it("والعربية هي `friendlyDateLong` نفسها — لا صيغةٌ ثانية تفترق عنها", () => {
    for (const date of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      expect(dateLong(date, "ar")).toBe(friendlyDateLong(date));
    }
  });
});
