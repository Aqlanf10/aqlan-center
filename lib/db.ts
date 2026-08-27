import { Pool } from "pg";
import type { Visit, VisitStatus } from "./flow";

/**
 * قاعدة بيانات مستقلة عن النظام الأساسي — قرار المالك.
 *
 * الأداة لا تكتب في قاعدة النظام الأساسي إطلاقًا. قواعد المال ومسار الزيارة والأقفال
 * كلها في واجهة النظام الأساسي، وأي كتابة مباشرة من برنامج ثانٍ كانت ستُفسد أرقامه
 * بصمت. الثمن المقبول — وقد قرره المالك صراحة — أن بيانات هذه الأداة تُرحَّل لاحقًا
 * حين يدخل النظام الأساسي الخدمة.
 */

/**
 * يقرر تشفير الاتصال من الرابط نفسه بدل افتراضه.
 *
 * فرض SSL دائمًا بدا الخيار الآمن، وكان خطأً: خادم Postgres بلا TLS يرفض الاتصال من
 * أصله برسالة «does not support SSL»، فتفتح اللوحة على «تعذّر تحميل قائمة اليوم» ولا
 * يعرف أحد لماذا. ظهر هذا عند أول تشغيل حقيقي، لا في البناء.
 *
 * القاعدة: المزوّدون المُدارون (Neon / Railway / Supabase) يفرضون TLS بشهادة وسيطة،
 * فيُفعَّل التشفير ويُعطَّل التحقق من سلسلة الشهادة لهم وحدهم؛ أما `localhost` أو
 * `sslmode=disable` صراحةً فبلا تشفير — وهو الصحيح لقاعدة على الجهاز نفسه.
 */
function sslFor(connectionString: string): { rejectUnauthorized: boolean } | false {
  const lowered = connectionString.toLowerCase();
  if (lowered.includes("sslmode=disable")) return false;
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(lowered)) return false;
  return { rejectUnauthorized: false };
}

let pool: Pool | null = null;

/**
 * أسماء رابط الاتصال التي قد يضبطها المزوّد.
 *
 * تكامل Neon مع Vercel يضبط `DATABASE_URL`، وتكاملات أخرى تضبط `POSTGRES_URL` أو
 * `POSTGRES_PRISMA_URL`. القراءة من اسم واحد كانت تعني أن يربط المالك القاعدة بنجاح
 * ثم تبقى اللوحة معطّلة بلا سبب ظاهر — فتُقرأ الأسماء المعروفة كلها بالترتيب.
 */
const CONNECTION_ENV_NAMES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

export function connectionStringFromEnv(): string | null {
  for (const name of CONNECTION_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = connectionStringFromEnv();
  if (!connectionString) {
    throw new Error("رابط قاعدة البيانات غير مضبوط — أضف DATABASE_URL في إعدادات النشر.");
  }
  pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 3 });
  return pool;
}

let schemaReady: Promise<void> | null = null;

/**
 * ينشئ الجدول عند أول طلب.
 *
 * أداة الطوارئ بلا نظام هجرات عمدًا: إضافة أداة هجرات هنا تعني خطوة نشر إضافية قبل أن
 * تعمل الشاشة، والهدف أن تعمل صباح الغد. الجدول واحد، وإنشاؤه IF NOT EXISTS آمن للتكرار.
 */
export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS visits (
        id            SERIAL PRIMARY KEY,
        patient_name  TEXT        NOT NULL,
        patient_phone TEXT,
        note          TEXT,
        status        TEXT        NOT NULL DEFAULT 'waiting',
        chair         INTEGER,
        arrived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        seated_at     TIMESTAMPTZ,
        finished_at   TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS visits_arrived_at_idx ON visits (arrived_at);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;

      -- المرضى والمواعيد بأسماء حقول تحاكي النظام الأساسي عمدًا، ليكون الترحيل لاحقًا
      -- نسخًا مباشرًا لا إعادة كتابة. حالات الموعد هي نفس مفردات AppointmentStatus هناك.
      CREATE TABLE IF NOT EXISTS patients (
        id             SERIAL PRIMARY KEY,
        patient_number TEXT        NOT NULL UNIQUE,
        full_name      TEXT        NOT NULL,
        phone          TEXT,
        note           TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (full_name);

      CREATE TABLE IF NOT EXISTS appointments (
        id               SERIAL PRIMARY KEY,
        patient_id       INTEGER     NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        scheduled_date   DATE        NOT NULL,
        scheduled_time   TIME        NOT NULL,
        duration_minutes INTEGER     NOT NULL DEFAULT 30,
        appointment_type TEXT,
        note             TEXT,
        status           TEXT        NOT NULL DEFAULT 'booked',
        arrived_at       TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments (scheduled_date);
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

      -- الزيارة تعرف موعدها ومريضها حين يأتي من حجز، وتبقى مستقلة للمريض المشي.
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id);

      -- طلبات الحجز من المرضى. جدول منفصل عن المواعيد عمدًا: الطلب ليس موعدًا حتى
      -- تؤكّده الاستقبال، وخلطهما كان يعني يومًا ممتلئًا بأسماء غير مؤكّدة.
      CREATE TABLE IF NOT EXISTS booking_requests (
        id               SERIAL PRIMARY KEY,
        full_name        TEXT        NOT NULL,
        phone            TEXT        NOT NULL,
        reason           TEXT,
        preferred_date   DATE,
        preferred_period TEXT        NOT NULL DEFAULT 'any',
        status           TEXT        NOT NULL DEFAULT 'new',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        handled_at       TIMESTAMPTZ,
        appointment_id   INTEGER REFERENCES appointments(id),
        -- بصمة مصدر الطلب لا عنوانه: تكفي لإيقاف من يرسل مئة طلب، ولا تُبقي عنوان
        -- مريض مخزّنًا في قاعدة عيادة.
        source_hash      TEXT
      );
      CREATE INDEX IF NOT EXISTS booking_requests_status_idx ON booking_requests (status, created_at);
      CREATE INDEX IF NOT EXISTS booking_requests_phone_idx ON booking_requests (phone, created_at);

      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT        NOT NULL UNIQUE,
        display_name  TEXT        NOT NULL,
        password_hash TEXT        NOT NULL,
        role          TEXT        NOT NULL DEFAULT 'staff',
        is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  })().catch((error) => {
    // لا نحتفظ بوعد فاشل، وإلا بقيت الأداة معطّلة إلى إعادة التشغيل بعد عطل شبكة عابر.
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

interface VisitRow {
  id: number;
  patient_name: string;
  patient_phone: string | null;
  note: string | null;
  status: string;
  chair: number | null;
  arrived_at: Date;
  seated_at: Date | null;
  called_at: Date | null;
  finished_at: Date | null;
}

function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    patientName: row.patient_name,
    patientPhone: row.patient_phone,
    note: row.note,
    status: row.status as VisitStatus,
    chair: row.chair,
    arrivedAt: row.arrived_at.toISOString(),
    seatedAt: row.seated_at ? row.seated_at.toISOString() : null,
    calledAt: row.called_at ? row.called_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

/**
 * زيارات اليوم بتوقيت العيادة.
 *
 * «اليوم» يُحسب داخل Postgres بالمنطقة الزمنية للعيادة لا بـ UTC. الخادم يعمل بـ UTC،
 * وبعد التاسعة مساءً بتوقيت غرينتش يكون التاريخ في تعز قد انتقل لليوم التالي — فلو
 * قِيس اليوم بـ UTC لاختفت زيارات المساء من اللوحة أمام الاستقبال وهي جالسة معهم.
 */
export async function listTodayVisits(): Promise<Visit[]> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `SELECT * FROM visits
      WHERE (arrived_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
      ORDER BY arrived_at ASC`,
    [CLINIC_TIME_ZONE],
  );
  return rows.map(toVisit);
}

export const CLINIC_TIME_ZONE = process.env.CLINIC_TIME_ZONE || "Asia/Aden";

export async function addVisit(input: {
  patientName: string;
  patientPhone: string | null;
  note: string | null;
}): Promise<Visit> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `INSERT INTO visits (patient_name, patient_phone, note)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.patientName, input.patientPhone, input.note],
  );
  return toVisit(rows[0]);
}

/**
 * يُجلس المريض على كرسي، ويرفض إن كان الكرسي مشغولًا.
 *
 * الشرط `NOT EXISTS` داخل الاستعلام نفسه لا في الكود: الاستقبال قد تكون على شاشة
 * والطبيب على هاتفه، وضغطهما معًا على نفس الكرسي في نفس اللحظة كان سيُجلس مريضين
 * على كرسي واحد. الفحص هنا ذرّي، فيفوز واحد ويُخبَر الثاني.
 */
export async function seatVisit(id: number, chair: number): Promise<Visit | null> {
  // الحراسة محدودة بيوم العيادة عمدًا: زيارة أمس لم يضغط أحد «انتهى» عليها تبقى
  // `in_chair` في الجدول، وهي غير ظاهرة في لوحة اليوم — فلو شملها الفحص لظلّ الكرسي
  // مرفوضًا كل صباح برسالة «الكرسي شُغل للتو» بلا أحد عليه وبلا طريقة لتحريره.
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `UPDATE visits
        SET status = 'in_chair', chair = $2, seated_at = NOW()
      WHERE id = $1
        AND status IN ('waiting', 'called')
        AND NOT EXISTS (
          SELECT 1 FROM visits busy
           WHERE busy.status = 'in_chair' AND busy.chair = $2
             AND (busy.arrived_at AT TIME ZONE $3)::date = (NOW() AT TIME ZONE $3)::date
        )
      RETURNING *`,
    [id, chair, CLINIC_TIME_ZONE],
  );
  return rows[0] ? toVisit(rows[0]) : null;
}

export async function finishVisit(id: number): Promise<Visit | null> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `UPDATE visits SET status = 'done', finished_at = NOW(), chair = NULL
      WHERE id = $1 AND status <> 'done' RETURNING *`,
    [id],
  );
  return rows[0] ? toVisit(rows[0]) : null;
}


export interface StaffUser {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  is_active: boolean;
}

function toUser(row: UserRow): StaffUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: row.is_active,
  };
}

/**
 * يبحث عن المستخدم باسم دخول غير حسّاس لحالة الأحرف.
 *
 * موظفة الاستقبال ستكتب `Reception` أو `reception` حسب ما تفعله لوحة المفاتيح، ورفض
 * الدخول لهذا السبب يعني اتصالًا بك في أول صباح.
 */
export async function findUserByUsername(username: string): Promise<StaffUser | null> {
  await ensureSchema();
  const { rows } = await getPool().query<UserRow>(
    `SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_active LIMIT 1`,
    [username],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function countUsers(): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query<{ c: string }>(`SELECT count(*)::int AS c FROM users`);
  return Number(rows[0].c);
}

/**
 * ينشئ أول مدير، ويرفض إن وُجد مستخدم واحد سلفًا.
 *
 * الشرط `WHERE NOT EXISTS` داخل جملة `INSERT` نفسها لا في الكود: فحصٌ ثم إدراج في
 * خطوتين يترك نافذة يستطيع فيها طلبان متزامنان إنشاء مديرين اثنين، وأحدهما ليس أنت.
 */
export async function createFirstAdmin(input: {
  username: string;
  displayName: string;
  passwordHash: string;
}): Promise<StaffUser | null> {
  await ensureSchema();
  const { rows } = await getPool().query<UserRow>(
    `INSERT INTO users (username, display_name, password_hash, role)
     SELECT $1, $2, $3, 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM users)
     RETURNING *`,
    [input.username, input.displayName, input.passwordHash],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function createStaffUser(input: {
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
}): Promise<StaffUser> {
  await ensureSchema();
  const { rows } = await getPool().query<UserRow>(
    `INSERT INTO users (username, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.username, input.displayName, input.passwordHash, input.role],
  );
  return toUser(rows[0]);
}

// ─── المرضى والمواعيد ────────────────────────────────────────────────────────

import type { Appointment, AppointmentStatus } from "./schedule";

export interface Patient {
  id: number;
  patientNumber: string;
  fullName: string;
  phone: string | null;
}

interface PatientRow {
  id: number;
  patient_number: string;
  full_name: string;
  phone: string | null;
}

const toPatient = (row: PatientRow): Patient => ({
  id: row.id,
  patientNumber: row.patient_number,
  fullName: row.full_name,
  phone: row.phone,
});

/**
 * يبحث بالاسم أو الهاتف.
 *
 * البحث بالجزء لا بالبداية: الاستقبال تتذكر «محمد» من «عبدالله محمد سالم»، والبحث
 * بالبداية وحده كان سيعيد لا شيء فتُنشئ سجلًا مكررًا لمريض موجود.
 */
export async function searchPatients(term: string, limit = 8): Promise<Patient[]> {
  await ensureSchema();
  const trimmed = term.trim();
  if (!trimmed) return [];
  const { rows } = await getPool().query<PatientRow>(
    `SELECT id, patient_number, full_name, phone FROM patients
      WHERE full_name ILIKE $1 OR phone ILIKE $1
      ORDER BY full_name LIMIT $2`,
    [`%${trimmed}%`, limit],
  );
  return rows.map(toPatient);
}

/**
 * ينشئ مريضًا برقم متسلسل.
 *
 * الرقم يُولَّد داخل الاستعلام من أكبر رقم موجود، لا من عدّ السجلات: العدّ يعيد استخدام
 * رقم مريض محذوف فيصير لمريضين الرقم نفسه في سجلات مطبوعة قديمة.
 */
export async function createPatient(input: {
  fullName: string;
  phone: string | null;
  note: string | null;
}): Promise<Patient> {
  await ensureSchema();
  const { rows } = await getPool().query<PatientRow>(
    `INSERT INTO patients (patient_number, full_name, phone, note)
     VALUES (
       'P-' || LPAD((COALESCE((SELECT MAX(NULLIF(regexp_replace(patient_number, '\\D', '', 'g'), '')::int) FROM patients), 0) + 1)::text, 5, '0'),
       $1, $2, $3)
     RETURNING id, patient_number, full_name, phone`,
    [input.fullName, input.phone, input.note],
  );
  return toPatient(rows[0]);
}

interface AppointmentRow {
  id: number;
  patient_id: number;
  full_name: string;
  phone: string | null;
  scheduled_date: Date;
  scheduled_time: string;
  duration_minutes: number;
  appointment_type: string | null;
  note: string | null;
  status: string;
  reminder_sent_at: Date | null;
}

function toAppointment(row: AppointmentRow): Appointment {
  const date = row.scheduled_date;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.full_name,
    patientPhone: row.phone,
    // التاريخ يُنسّق من مكوّناته المحلية لا بـ toISOString: الأخيرة تحوّل إلى UTC فتُرجع
    // اليوم السابق لكل موعد مسائي — وهو نفس الفخ الذي أسقط لوحة اليوم لولا الانتباه.
    scheduledDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    scheduledTime: String(row.scheduled_time).slice(0, 5),
    durationMinutes: row.duration_minutes,
    note: row.note,
    status: row.status as AppointmentStatus,
    reminderSentAt: row.reminder_sent_at ? row.reminder_sent_at.toISOString() : null,
  };
}

const APPOINTMENT_SELECT = `
  SELECT a.id, a.patient_id, p.full_name, p.phone, a.scheduled_date, a.scheduled_time,
         a.duration_minutes, a.appointment_type, a.note, a.status, a.reminder_sent_at
    FROM appointments a JOIN patients p ON p.id = a.patient_id`;

export async function listAppointmentsByDate(date: string): Promise<Appointment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<AppointmentRow>(
    `${APPOINTMENT_SELECT} WHERE a.scheduled_date = $1 ORDER BY a.scheduled_time`,
    [date],
  );
  return rows.map(toAppointment);
}

export async function createAppointment(input: {
  patientId: number;
  date: string;
  time: string;
  durationMinutes: number;
  note: string | null;
}): Promise<Appointment | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO appointments (patient_id, scheduled_date, scheduled_time, duration_minutes, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.patientId, input.date, input.time, input.durationMinutes, input.note],
  );
  const { rows: full } = await getPool().query<AppointmentRow>(
    `${APPOINTMENT_SELECT} WHERE a.id = $1`, [rows[0].id],
  );
  return full[0] ? toAppointment(full[0]) : null;
}

export async function setAppointmentStatus(
  id: number,
  status: AppointmentStatus,
): Promise<Appointment | null> {
  await ensureSchema();
  await getPool().query(
    `UPDATE appointments SET status = $2,
            arrived_at = CASE WHEN $2 = 'arrived' THEN NOW() ELSE arrived_at END
      WHERE id = $1`,
    [id, status],
  );
  const { rows } = await getPool().query<AppointmentRow>(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [id]);
  return rows[0] ? toAppointment(rows[0]) : null;
}

/**
 * وصول مريض محجوز: يصير الموعد «وصل» وتُفتح له زيارة في قائمة الانتظار — في معاملة
 * واحدة، فلا يبقى موعد معلّم كواصل بلا صفٍّ في اللوحة إن انقطع الاتصال بينهما.
 */
export async function arriveAppointment(id: number): Promise<boolean> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ patient_id: number; full_name: string; phone: string | null }>(
      `UPDATE appointments a SET status = 'arrived', arrived_at = NOW()
         FROM patients p
        WHERE a.id = $1 AND p.id = a.patient_id AND a.status = 'booked'
       RETURNING a.patient_id, p.full_name, p.phone`,
      [id],
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `INSERT INTO visits (patient_name, patient_phone, patient_id, appointment_id)
       VALUES ($1, $2, $3, $4)`,
      [rows[0].full_name, rows[0].phone, rows[0].patient_id, id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** يسجّل أن التذكير أُرسل — حتى لا يُذكَّر مريض مرتين ويُنسى آخر. */
export async function markReminderSent(id: number): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE appointments SET reminder_sent_at = NOW() WHERE id = $1`, [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * يعيد مريضًا نُودي عليه إلى الانتظار.
 *
 * المريض لا يسمع النداء دائمًا: خرج إلى الصيدلية، أو لم ينتبه للشاشة. بلا هذا الإجراء
 * يبقى الكرسي محجوزًا له إلى آخر اليوم ولا سبيل لتحريره من الشاشة — وهو بالضبط نوع
 * «الميزة الناقصة» التي تجعل الاستقبال تترك النظام وتعود إلى الورقة.
 */
export async function returnVisitToWaiting(id: number): Promise<Visit | null> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `UPDATE visits SET status = 'waiting', chair = NULL, called_at = NULL
      WHERE id = $1 AND status = 'called' RETURNING *`,
    [id],
  );
  return rows[0] ? toVisit(rows[0]) : null;
}

/**
 * ينادي مريضًا إلى كرسي.
 *
 * نفس الحراسة الذرّية التي يستخدمها الإجلاس: الكرسي لا يُنادى إليه مريضان. الفرق أن
 * النداء يحجز الكرسي قبل أن يصل المريض إليه فعلًا — وهو المقصود: بين النداء والجلوس
 * دقيقة يمشي فيها المريض، ولو لم يُحجز الكرسي لنودي عليه مريض آخر في تلك الدقيقة.
 */
export async function callVisit(id: number, chair: number): Promise<Visit | null> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `UPDATE visits
        SET status = 'called', chair = $2, called_at = NOW()
      WHERE id = $1
        AND status = 'waiting'
        AND NOT EXISTS (
          SELECT 1 FROM visits busy
           WHERE busy.status IN ('called', 'in_chair') AND busy.chair = $2
             AND (busy.arrived_at AT TIME ZONE $3)::date = (NOW() AT TIME ZONE $3)::date
        )
      RETURNING *`,
    [id, chair, CLINIC_TIME_ZONE],
  );
  return rows[0] ? toVisit(rows[0]) : null;
}

// ─── طلبات الحجز ─────────────────────────────────────────────────────────────

import type { BookingRequest, BookingRequestInput, BookingRequestStatus, PreferredPeriod } from "./booking";

interface BookingRequestRow {
  id: number;
  full_name: string;
  phone: string;
  reason: string | null;
  preferred_date: Date | null;
  preferred_period: string;
  status: string;
  created_at: Date;
  handled_at: Date | null;
  appointment_id: number | null;
}

function toBookingRequest(row: BookingRequestRow): BookingRequest {
  const date = row.preferred_date;
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    reason: row.reason,
    // من مكوّنات التاريخ المحلية لا بـ toISOString — نفس فخ اليوم السابق.
    preferredDate: date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : null,
    preferredPeriod: row.preferred_period as PreferredPeriod,
    status: row.status as BookingRequestStatus,
    createdAt: row.created_at.toISOString(),
    handledAt: row.handled_at ? row.handled_at.toISOString() : null,
    appointmentId: row.appointment_id,
  };
}

/**
 * كم طلبًا أرسله هذا الرقم أو هذا المصدر في آخر أربع وعشرين ساعة.
 *
 * الصفحة عامة بلا تسجيل دخول، وبلا هذا العدّ يستطيع أي أحد أن يملأ قائمة الاستقبال
 * بألف طلب في دقيقة فتصير القائمة بلا فائدة. الحدّ يُطبَّق على الخادم لا في الواجهة:
 * الواجهة يمكن تجاوزها بطلب مباشر.
 */
export async function countRecentRequests(phone: string, sourceHash: string | null): Promise<{ byPhone: number; bySource: number }> {
  await ensureSchema();
  const { rows } = await getPool().query<{ by_phone: string; by_source: string }>(
    // النوع مُصرّح على المعامل (`$2::text`): بلا التصريح يرفض Postgres الاستعلام حين
    // تصل البصمة فارغة — «could not determine data type» — فيتحوّل طلب مريض سليم إلى
    // 503 لا سبب ظاهر له. ظهر في أول تشغيل حقيقي لا في البناء.
    `SELECT
       count(*) FILTER (WHERE phone = $1)::int AS by_phone,
       count(*) FILTER (WHERE $2::text IS NOT NULL AND source_hash = $2::text)::int AS by_source
       FROM booking_requests
      WHERE created_at > NOW() - INTERVAL '24 hours'`,
    [phone, sourceHash],
  );
  return { byPhone: Number(rows[0].by_phone), bySource: Number(rows[0].by_source) };
}

export async function createBookingRequest(
  input: BookingRequestInput,
  sourceHash: string | null,
): Promise<BookingRequest> {
  await ensureSchema();
  const { rows } = await getPool().query<BookingRequestRow>(
    `INSERT INTO booking_requests (full_name, phone, reason, preferred_date, preferred_period, source_hash)
     VALUES ($1, $2, $3::text, $4::date, $5, $6::text) RETURNING *`,
    [input.fullName, input.phone, input.reason, input.preferredDate, input.preferredPeriod, sourceHash],
  );
  return toBookingRequest(rows[0]);
}

export async function listBookingRequests(status: BookingRequestStatus): Promise<BookingRequest[]> {
  await ensureSchema();
  const { rows } = await getPool().query<BookingRequestRow>(
    // الأقدم أولًا: الطلب الذي مضى عليه يومان هو من ينتظر رده، لا الذي وصل قبل دقيقة.
    `SELECT * FROM booking_requests WHERE status = $1 ORDER BY created_at ASC LIMIT 200`,
    [status],
  );
  return rows.map(toBookingRequest);
}

export async function rejectBookingRequest(id: number): Promise<BookingRequest | null> {
  await ensureSchema();
  const { rows } = await getPool().query<BookingRequestRow>(
    `UPDATE booking_requests SET status = 'rejected', handled_at = NOW()
      WHERE id = $1 AND status = 'new' RETURNING *`,
    [id],
  );
  return rows[0] ? toBookingRequest(rows[0]) : null;
}

/**
 * يحوّل طلبًا إلى موعد مؤكّد في معاملة واحدة.
 *
 * ثلاث كتابات مرتبطة: مريض (إن كان جديدًا)، وموعد، وإغلاق الطلب. تنفيذها متتابعة بلا
 * معاملة يترك — عند انقطاع بين الثانية والثالثة — موعدًا محجوزًا وطلبًا ما زال يبدو
 * معلّقًا، فتؤكّده الاستقبال مرة ثانية ويصير للمريض موعدان.
 *
 * البحث عن المريض بالرقم لا بالاسم: «عبدالله محمد» و«عبد الله محمد» شخص واحد بسجلّين،
 * والرقم هو المُعرّف الوحيد الذي يكتبه المريض بنفسه.
 */
export async function confirmBookingRequest(input: {
  id: number;
  date: string;
  time: string;
  durationMinutes: number;
}): Promise<{ appointmentId: number; patientId: number } | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: requests } = await client.query<{ full_name: string; phone: string; reason: string | null }>(
      `SELECT full_name, phone, reason FROM booking_requests
        WHERE id = $1 AND status = 'new' FOR UPDATE`,
      [input.id],
    );
    if (!requests[0]) { await client.query("ROLLBACK"); return null; }
    const request = requests[0];

    const { rows: existing } = await client.query<{ id: number }>(
      `SELECT id FROM patients WHERE phone = $1 ORDER BY id LIMIT 1`,
      [request.phone],
    );
    let patientId = existing[0]?.id;
    if (!patientId) {
      const { rows: created } = await client.query<{ id: number }>(
        `INSERT INTO patients (patient_number, full_name, phone)
         VALUES (
           'P-' || LPAD((COALESCE((SELECT MAX(NULLIF(regexp_replace(patient_number, '\\D', '', 'g'), '')::int) FROM patients), 0) + 1)::text, 5, '0'),
           $1, $2)
         RETURNING id`,
        [request.full_name, request.phone],
      );
      patientId = created[0].id;
    }

    const { rows: appointments } = await client.query<{ id: number }>(
      `INSERT INTO appointments (patient_id, scheduled_date, scheduled_time, duration_minutes, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [patientId, input.date, input.time, input.durationMinutes, request.reason],
    );

    await client.query(
      `UPDATE booking_requests SET status = 'confirmed', handled_at = NOW(), appointment_id = $2
        WHERE id = $1`,
      [input.id, appointments[0].id],
    );
    await client.query("COMMIT");
    return { appointmentId: appointments[0].id, patientId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
