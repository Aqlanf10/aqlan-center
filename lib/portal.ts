import { createHmac, timingSafeEqual } from "node:crypto";
import { samePhone } from "./duplicates";
import { addDays } from "./schedule";

/**
 * بوابة المريض — المنطق الخالص وجلستها المعزولة.
 *
 * وهي تخدم مشكلتَي المركز الأولَيين معًا: **الزحمة** — سؤالٌ عن رصيدٍ أو موعدٍ لا
 * يشغل الاستقبال بين مريضين — و**تراكم المواعيد**: من يؤكّد حضوره لا يغيب، ومن لا
 * يؤكّد يُتّصل به قبل أن يضيع الكرسي.
 *
 * وقاعدتان تحكمان بناءها:
 *
 * ١) **عزلٌ تامّ عن جلسة الطاقم.** كوكي باسم آخر، وتوقيع بمجال منفصل — فتوكن
 *    المريض لا يفتح مسار طاقمٍ ولو صحّ توقيعه، وتوكن الطاقم لا يفتح البوابة.
 *    والخلط بينهما لا يظهر عطلًا يوم كتابته؛ يظهر يوم يُسرَّب أحدهما.
 * ٢) **مصدر الحقيقة واحد.** كشف الحساب في البوابة يستدعي `patientLedger()` نفسها
 *    التي تخدم شاشة المركز — فلا يُبنى استعلامٌ موازٍ يقول للمريض رقمًا ويقول
 *    للصندوق آخر، ثم يُقال له إنه مخطئ وهو يقرأ ما أعطيناه.
 *
 * **ولماذا بلا كلمة مرور؟** مريض عيادةٍ في تعز لا يملك حسابًا يُدار ولا بريدًا
 * يُوثَّق، وكلمةُ مرورٍ تُنسى تعني اتصالًا بالاستقبال — أي عودة الزحمة من بابها.
 * والعاملان اللذان يملكهما المريض الحقيقي وحده تقريبًا: **رقم هاتفه ورقم ملفه**
 * الذي أعطته إياه العيادة. ومزاوجتُهما مع حدٍّ لمحاولات الدخول تكفي لبوابةٍ
 * **تُقرأ ولا تدفع ولا تُعدّل**.
 */

export const PORTAL_COOKIE = "aqlan_portal_session";

/**
 * أسبوع: يغطي ما بين زيارتين، وما يُفقد بانتهائه صفر — يعيد المريض الدخول
 * بعاملين يحفظهما. وشهرٌ كان يعني نافذةً مفتوحة على حسابه لمن ظفر بجهازه.
 */
export const PORTAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export interface PortalPayload {
  patientId: number;
  patientNumber: string;
  fullName: string;
  expiresAt: number;
}

function portalSecret(): string {
  const value = process.env.SESSION_SECRET;
  // نفس قاعدة جلسة الطاقم: بلا سرٍّ لا توقيع، والانهيار هنا مقصود.
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET مفقود أو قصير — يجب ألا يقل عن 32 حرفًا.");
  }
  // البادئة هي العزل: السرّ واحد والمجال مختلف، فتوقيعُ جهةٍ لا يصحّ عند الأخرى.
  return `portal:${value}`;
}

function portalSign(body: string): string {
  return createHmac("sha256", portalSecret()).update(body).digest("base64url");
}

export function createPortalToken(payload: PortalPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${portalSign(body)}`;
}

export function readPortalToken(token: string | undefined): PortalPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = portalSign(body);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as PortalPayload;
    if (typeof payload.expiresAt !== "number" || payload.expiresAt <= Date.now()) return null;
    if (!Number.isSafeInteger(payload.patientId) || payload.patientId <= 0) return null;
    if (typeof payload.patientNumber !== "string" || !payload.patientNumber) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ── الدخول ───────────────────────────────────────────────────────────────── */

export interface PortalLoginInput {
  phone: string;
  patientNumber: string;
}

export type PortalLoginValidation =
  | { ok: true; value: PortalLoginInput }
  | { ok: false; message: string };

/** أقلّ ما يُعدّ هاتفًا — والهاتف أوّل عاملَي المطابقة. */
const MIN_PHONE_DIGITS = 9;

export function validatePortalLogin(raw: unknown): PortalLoginValidation {
  const source = (raw ?? {}) as Record<string, unknown>;
  const phone = typeof source.phone === "string" ? source.phone.trim() : "";
  const patientNumber = typeof source.patientNumber === "string" ? source.patientNumber.trim() : "";
  if (phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) {
    return { ok: false, message: "أدخل رقم جوالك كما هو مسجَّل في المركز." };
  }
  if (!patientNumber || patientNumber.length > 20) {
    return { ok: false, message: "أدخل رقم ملفك كما أُعطي لك." };
  }
  return { ok: true, value: { phone, patientNumber } };
}

/**
 * مطابقة الزوج على مريض.
 *
 * ويُقارَن الهاتف بـ`samePhone` نفسها التي يكشف بها البرنامجُ الملفَّ المكرَّر —
 * فما يُعدّ «نفس الرقم» عند إنشاء الملف هو نفسه عند فتح البوابة. ومقارنةٌ نصّية
 * هنا كانت تمنع صاحب الملف من الدخول برقمه هو مكتوبًا بصيغةٍ أخرى.
 */
export function portalCredentialsMatch(
  patient: { patientNumber: string; phone: string | null; altPhone: string | null },
  phone: string,
  patientNumber: string,
): boolean {
  if (patientNumber.trim().toUpperCase() !== patient.patientNumber.trim().toUpperCase()) return false;
  return samePhone(patient.phone, phone) || samePhone(patient.altPhone, phone);
}

/* ── تأكيد الحضور ─────────────────────────────────────────────────────────── */

/** ما بعد ثلاثين يومًا تأكيدُه بلا معنى — الموعد بعيد والظروف تتغيّر. */
export const CONFIRM_WINDOW_DAYS = 30;

export type ConfirmVerdict =
  | { ok: true }
  | { ok: false; reason: "not_booked" | "past" | "too_far" };

export const CONFIRM_REFUSAL: Record<"not_booked" | "past" | "too_far", string> = {
  not_booked: "هذا الموعد لم يعد قائمًا. اتّصل بالمركز لحجز موعدٍ جديد.",
  past: "هذا الموعد مضى. اتّصل بالمركز لحجز موعدٍ جديد.",
  too_far: "الموعد أبعد من أن يُؤكَّد الآن — أكّده قبله بشهر.",
};

export function confirmVerdict(
  appointment: { status: string; scheduledDate: string },
  today: string,
): ConfirmVerdict {
  if (appointment.status !== "booked") return { ok: false, reason: "not_booked" };
  if (appointment.scheduledDate < today) return { ok: false, reason: "past" };
  if (appointment.scheduledDate > addDays(today, CONFIRM_WINDOW_DAYS)) {
    return { ok: false, reason: "too_far" };
  }
  return { ok: true };
}

export interface PortalAppointmentView {
  id: number;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  appointmentType: string | null;
  note: string | null;
  confirmedAt: string | null;
  confirmable: boolean;
}

export function toPortalAppointment(
  appointment: {
    id: number;
    scheduledDate: string;
    scheduledTime: string;
    durationMinutes: number;
    appointmentType: string | null;
    note: string | null;
    status: string;
  },
  confirmedAt: string | null,
  today: string,
): PortalAppointmentView {
  return {
    id: appointment.id,
    scheduledDate: appointment.scheduledDate,
    scheduledTime: appointment.scheduledTime,
    durationMinutes: appointment.durationMinutes,
    appointmentType: appointment.appointmentType ?? null,
    note: appointment.note ?? null,
    confirmedAt,
    // المؤكَّد سلفًا لا يُعرض له زرٌّ ثانٍ: زرٌّ يُضغط مرّتين يُشكّك صاحبه في الأولى.
    confirmable: !confirmedAt && confirmVerdict(appointment, today).ok,
  };
}
