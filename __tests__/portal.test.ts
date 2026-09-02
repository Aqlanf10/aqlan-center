import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken } from "../lib/auth";
import {
  CONFIRM_WINDOW_DAYS,
  confirmVerdict,
  createPortalToken,
  portalCredentialsMatch,
  readPortalToken,
  toPortalAppointment,
  validatePortalLogin,
} from "../lib/portal";

beforeAll(() => {
  process.env.SESSION_SECRET = "portal-test-only-secret-not-for-production-2026";
});

const payload = (over: Partial<Parameters<typeof createPortalToken>[0]> = {}) => ({
  patientId: 7, patientNumber: "P-00042", fullName: "مريضة البوابة",
  expiresAt: Date.now() + 60_000, ...over,
});

describe("جلسة البوابة معزولة عن جلسة الطاقم", () => {
  it("التوكن الصحيح يُقرأ", () => {
    const read = readPortalToken(createPortalToken(payload()));
    expect(read?.patientId).toBe(7);
    expect(read?.patientNumber).toBe("P-00042");
  });

  /*
   * الحارس الذي يمنع أخطر ما في البوابة.
   *
   * السرّ واحد والمجال مختلف، فتوقيعُ جهةٍ لا يصحّ عند الأخرى. ولو وُحّد المجال
   * لصار توكن مريضٍ مقبولًا في مسار طاقم — ولا يظهر ذلك عطلًا يوم كتابته، بل يوم
   * يُسرَّب أحدهما.
   */
  it("وتوكن الطاقم لا يُقرأ في البوابة", () => {
    const staff = createSessionToken({
      userId: 1, username: "shots", role: "admin",
      expiresAt: Date.now() + 60_000, sessionVersion: 1,
    });
    expect(readPortalToken(staff)).toBeNull();
  });

  it("وتوكن البوابة لا يُقرأ في الطاقم", () => {
    expect(readSessionToken(createPortalToken(payload()))).toBeNull();
  });

  /*
   * الفحصان أعلاه يمرّان بالصدفة، وقد كتبتهما ظانًّا أنهما يحرسان العزل.
   *
   * توكن الطاقم يحمل `userId` ولا يحمل `patientId`، فتردّه البوابة على **شكل
   * الحمولة** قبل أن تنظر في التوقيع — ويمرّان لو وُحّد مجال التوقيع تمامًا. وفحصٌ
   * يمرّ بالصدفة أسوأ من لا فحص: يُطمئن على ما لم يُثبت.
   *
   * فهذا يفصل التوقيع عن الشكل: **حمولة بوابةٍ سليمة موقَّعة بسرّ الطاقم**. إن
   * قُبلت فالمجال واحد، ويكفي تسريبُ توكن طاقمٍ ليُصنع منه توكن مريض والعكس.
   */
  it("وحمولةُ بوابةٍ موقَّعة بسرّ الطاقم مرفوضة — العزل في التوقيع لا في الشكل", () => {
    const body = Buffer.from(JSON.stringify(payload())).toString("base64url");
    const staffSigned = createHmac("sha256", process.env.SESSION_SECRET as string)
      .update(body).digest("base64url");
    expect(readPortalToken(`${body}.${staffSigned}`)).toBeNull();
  });

  it("وحمولةُ طاقمٍ موقَّعة بسرّ البوابة مرفوضة كذلك", () => {
    const staffPayload = {
      userId: 1, username: "shots", role: "admin",
      expiresAt: Date.now() + 60_000, sessionVersion: 1,
    };
    const body = Buffer.from(JSON.stringify(staffPayload)).toString("base64url");
    const portalSigned = createHmac("sha256", `portal:${process.env.SESSION_SECRET}`)
      .update(body).digest("base64url");
    expect(readSessionToken(`${body}.${portalSigned}`)).toBeNull();
  });

  it("والمنتهي مرفوض ولو صحّ توقيعه", () => {
    expect(readPortalToken(createPortalToken(payload({ expiresAt: Date.now() - 1 })))).toBeNull();
  });

  it("والمعدَّل مرفوض — التوقيع هو ما يمنع التزوير", () => {
    const token = createPortalToken(payload());
    const [body, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload(), patientId: 8 }),
    ).toString("base64url");
    expect(readPortalToken(`${forged}.${signature}`)).toBeNull();
    expect(readPortalToken(`${body}.${signature}x`)).toBeNull();
    expect(readPortalToken(undefined)).toBeNull();
    expect(readPortalToken("لا نقطة فيه")).toBeNull();
  });
});

describe("عاملا الدخول", () => {
  it("الهاتف القصير ورقم الملف الفارغ مرفوضان بالعربية", () => {
    expect(validatePortalLogin({ phone: "77", patientNumber: "P-1" }).ok).toBe(false);
    expect(validatePortalLogin({ phone: "770123456", patientNumber: "" }).ok).toBe(false);
    expect(validatePortalLogin({ phone: "770123456", patientNumber: "P-00042" }).ok).toBe(true);
  });

  const patient = { patientNumber: "P-00042", phone: "770123456", altPhone: null };

  it("والمطابقة تلزم العاملين معًا", () => {
    expect(portalCredentialsMatch(patient, "770123456", "P-00042")).toBe(true);
    expect(portalCredentialsMatch(patient, "770123456", "P-00043")).toBe(false);
    expect(portalCredentialsMatch(patient, "770999999", "P-00042")).toBe(false);
  });

  it("والهاتف يُقارن كما يقارنه كاشف التكرار — لا نصًّا", () => {
    // نفس الرقم بصيغةٍ دولية: صاحب الملف لا يُمنع من ملفّه هو.
    expect(portalCredentialsMatch(patient, "+967770123456", "P-00042")).toBe(true);
    expect(portalCredentialsMatch(patient, "770 123 456", "p-00042")).toBe(true);
  });

  it("والهاتف البديل يفتح كذلك — المسجَّل في الملف كلاهما", () => {
    expect(portalCredentialsMatch(
      { ...patient, altPhone: "711222333" }, "711222333", "P-00042")).toBe(true);
  });
});

describe("تأكيد الحضور", () => {
  const today = "2026-09-01";

  it("الموعد القائم القريب يُؤكَّد", () => {
    expect(confirmVerdict({ status: "booked", scheduledDate: "2026-09-05" }, today).ok).toBe(true);
    expect(confirmVerdict({ status: "booked", scheduledDate: today }, today).ok).toBe(true);
  });

  it("والماضي لا يُؤكَّد — تأكيدُه يُوهم المريض أن له مكانًا", () => {
    const verdict = confirmVerdict({ status: "booked", scheduledDate: "2026-08-31" }, today);
    expect(verdict).toEqual({ ok: false, reason: "past" });
  });

  it("وما ألغته الاستقبال لا يُؤكَّد", () => {
    expect(confirmVerdict({ status: "cancelled", scheduledDate: "2026-09-05" }, today))
      .toEqual({ ok: false, reason: "not_booked" });
  });

  it("وما بعد الشهر تأكيدُه بلا معنى", () => {
    expect(confirmVerdict({ status: "booked", scheduledDate: "2026-10-05" }, today))
      .toEqual({ ok: false, reason: "too_far" });
    // آخر يومٍ داخل النافذة مقبول — الحدّ ليس ما دونه.
    expect(confirmVerdict({ status: "booked", scheduledDate: "2026-10-01" }, today).ok).toBe(true);
    expect(CONFIRM_WINDOW_DAYS).toBe(30);
  });

  it("والمؤكَّد سلفًا لا يُعرض له زرٌّ ثانٍ", () => {
    const one = {
      id: 1, scheduledDate: "2026-09-05", scheduledTime: "10:00", durationMinutes: 30,
      appointmentType: null, note: null, status: "booked",
    };
    expect(toPortalAppointment(one, null, today).confirmable).toBe(true);
    expect(toPortalAppointment(one, "2026-09-01T08:00:00.000Z", today).confirmable).toBe(false);
  });
});
