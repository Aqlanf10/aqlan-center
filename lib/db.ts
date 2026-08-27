import { Pool } from "pg";
import { toWhatsAppNumber } from "./reminders";
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

      -- أعمال المختبر. المقياس الوحيد هنا تاريخ الاستحقاق: عملٌ بلا تاريخ يُنتظر إلى
      -- ما لا نهاية ولا يعرف أحد أنه تأخّر إلا حين يسأل المريض وهو على الكرسي.
      -- أثر المتابعة. القاعدة: لا يُتصل بأحد مرتين، ولا يُنسى أحد — وكلاهما مستحيل
      -- بلا تسجيل. المريض يعود إلى قائمة الاستدعاء إن بقي منقطعًا بعد مدة.
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS lab_orders (
        id           SERIAL PRIMARY KEY,
        patient_id   INTEGER     NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        lab_name     TEXT        NOT NULL,
        lab_phone    TEXT,
        work_type    TEXT        NOT NULL,
        details      TEXT,
        sent_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
        due_date     DATE        NOT NULL,
        status       TEXT        NOT NULL DEFAULT 'sent',
        received_at  TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        note         TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS lab_orders_status_idx ON lab_orders (status, due_date);
      CREATE INDEX IF NOT EXISTS lab_orders_patient_idx ON lab_orders (patient_id);

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
  patient_id: number | null;
  appointment_id: number | null;
}

function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    patientId: row.patient_id,
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

/**
 * زيارات يوم بعينه بتوقيت العيادة — للتقرير.
 *
 * نفس حساب اليوم الذي تستخدمه اللوحة: `AT TIME ZONE` لا مقارنة UTC. تقريرٌ يُحسب
 * بتوقيت الخادم كان سيُسقط زيارات المساء من تقرير اليوم ويضيفها إلى تقرير الغد،
 * فتظهر أيام «هادئة» ليست هادئة.
 */
export async function listVisitsByDate(date: string): Promise<Visit[]> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `SELECT * FROM visits
      WHERE (arrived_at AT TIME ZONE $1)::date = $2::date
      ORDER BY arrived_at ASC`,
    [CLINIC_TIME_ZONE, date],
  );
  return rows.map(toVisit);
}

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

/**
 * ينهي الزيارة، ويغلق معها موعدها إن جاءت من حجز.
 *
 * قبل هذا كان الموعد يبقى «وصل» إلى الأبد: لا شيء في النظام ينقله إلى «تم». فيفتح
 * الطبيب جدول الأمس فيرى مرضى يبدون كأنهم ما زالوا في العيادة، وتصير أرقام اليوم
 * السابق بلا معنى — وسجلٌّ لا يُصدَّق يُهجَر، وهو ما حدث للنظام الأساسي بالضبط.
 *
 * الاثنان في معاملة واحدة: زيارة منتهية وموعدها ما زال مفتوحًا حالةٌ لا يستطيع أحد
 * تصحيحها من الشاشة.
 */
export async function finishVisit(id: number): Promise<Visit | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<VisitRow>(
      `UPDATE visits SET status = 'done', finished_at = NOW(), chair = NULL
        WHERE id = $1 AND status <> 'done' RETURNING *`,
      [id],
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return null; }
    if (rows[0].appointment_id) {
      await client.query(
        `UPDATE appointments SET status = 'done'
          WHERE id = $1 AND status IN ('booked', 'arrived')`,
        [rows[0].appointment_id],
      );
    }
    await client.query("COMMIT");
    return toVisit(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * يحجز جلسة قادمة للمريض الذي انتهت زيارته للتو.
 *
 * هذه هي اللحظة الوحيدة التي يكون فيها المريض واقفًا أمام الاستقبال ومعه قراره. تأجيلها
 * إلى «سنتصل بك» يعني — في عيادة تقويم تحتاج زيارة كل ثلاثة أو أربعة أسابيع — مريضًا
 * يختفي شهرين ثم يعود وقد تأخّر علاجه، ثم يشكو أن العيادة لم تتابعه.
 *
 * المريض يُحلّ من الزيارة: سجلّه إن كانت مرتبطة به، وإلا بحث بالرقم، وإلا سجلّ جديد.
 * البحث بالرقم لا بالاسم لأن «عبدالله محمد» و«عبد الله محمد» شخص واحد بسجلّين.
 * ويُثبَّت المريض في الزيارة بعدها، فلا تتكرر العملية إن حُجزت جلسة أخرى.
 */
export async function createNextSession(input: {
  visitId: number;
  date: string;
  time: string;
  durationMinutes: number;
  phone: string | null;
  note: string | null;
}): Promise<{ appointmentId: number; patientId: number; patientName: string; phone: string | null } | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: visits } = await client.query<{
      id: number; patient_name: string; patient_phone: string | null; patient_id: number | null;
    }>(
      `SELECT id, patient_name, patient_phone, patient_id FROM visits WHERE id = $1 FOR UPDATE`,
      [input.visitId],
    );
    if (!visits[0]) { await client.query("ROLLBACK"); return null; }
    const visit = visits[0];
    // الرقم يُوحَّد قبل أن يُكتب في سجل المريض: المريض المشي يكتب رقمه محليًا،
    // ولو حُفظ كما هو لصار له سجلّ ثانٍ حين يحجز يومًا من صفحة الحجز بنفس الرقم.
    const phone = normalizePatientPhone(input.phone ?? visit.patient_phone);

    let patientId = visit.patient_id;
    if (!patientId && phone) {
      const { rows } = await client.query<{ id: number }>(
        `SELECT id FROM patients WHERE phone = ANY($1::text[]) ORDER BY id LIMIT 1`,
        [phoneLookupForms(input.phone ?? visit.patient_phone)],
      );
      patientId = rows[0]?.id ?? null;
    }
    if (!patientId) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO patients (patient_number, full_name, phone)
         VALUES (
           'P-' || LPAD((COALESCE((SELECT MAX(NULLIF(regexp_replace(patient_number, '\\D', '', 'g'), '')::int) FROM patients), 0) + 1)::text, 5, '0'),
           $1, $2)
         RETURNING id`,
        [visit.patient_name, phone],
      );
      patientId = rows[0].id;
    } else if (phone) {
      // رقم وصل مع الحجز ولم يكن في السجل: يُملأ ولا يُستبدل رقمٌ قائم.
      await client.query(
        `UPDATE patients SET phone = $2 WHERE id = $1 AND (phone IS NULL OR phone = '')`,
        [patientId, phone],
      );
    }

    const { rows: created } = await client.query<{ id: number }>(
      `INSERT INTO appointments (patient_id, scheduled_date, scheduled_time, duration_minutes, note)
       VALUES ($1, $2, $3, $4, $5::text) RETURNING id`,
      [patientId, input.date, input.time, input.durationMinutes, input.note],
    );

    await client.query(
      `UPDATE visits SET patient_id = $2 WHERE id = $1 AND patient_id IS NULL`,
      [input.visitId, patientId],
    );

    await client.query("COMMIT");
    return {
      appointmentId: created[0].id,
      patientId,
      patientName: visit.patient_name,
      phone,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
 * صيغة موحّدة لرقم المريض في سجلّه.
 *
 * الرقم هو المُعرّف الوحيد الذي يكتبه المريض بنفسه، وعليه يعتمد منع تكرار السجلات.
 * ولأنه يصل من ثلاثة أبواب — طلب حجز من المريض، ومريض مشي تكتبه الاستقبال، وحجز
 * جلسة قادمة — كان يُخزَّن `770245745` من باب و`967770245745` من آخر، فيصير للشخص
 * الواحد سجلّان لا يعرف أحدهما الآخر. الصيغة الدولية هي المخزَّنة لأنها القاطعة.
 *
 * وما لا يصلح للجوال — رقم أرضي مثلًا — يُحفظ كما كُتب لا يُرمى: رقم أرضي يُتصل به.
 */
function normalizePatientPhone(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  return toWhatsAppNumber(trimmed) ?? trimmed;
}

/**
 * الصيغ التي قد يكون الرقم مخزّنًا بها.
 *
 * السجلات التي أُنشئت قبل توحيد الصيغة تحمل الرقم المحلي، والبحث بالصيغة الدولية
 * وحدها كان سيعتبرها مرضى جددًا وينشئ لهم سجلات ثانية.
 */
function phoneLookupForms(raw: string | null | undefined): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  const normalized = toWhatsAppNumber(trimmed);
  return normalized && normalized !== trimmed ? [normalized, trimmed] : [trimmed];
}

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
    [input.fullName, normalizePatientPhone(input.phone), input.note],
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
      `SELECT id FROM patients WHERE phone = ANY($1::text[]) ORDER BY id LIMIT 1`,
      [phoneLookupForms(request.phone)],
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

// ─── ملف المريض ──────────────────────────────────────────────────────────────

export interface PatientFile {
  patient: Patient & { note: string | null; createdAt: string };
  visits: Visit[];
  appointments: Appointment[];
}

/**
 * ملف المريض: بياناته وتاريخه في استعلام واحد لكل جزء.
 *
 * الاستقبال تُسأل عشر مرات في اليوم «متى كانت آخر زيارة له؟» و«هل عنده موعد؟»،
 * وبلا هذه الصفحة تُجاب من الذاكرة أو لا تُجاب. وهي أيضًا ما يجعل بقية الوحدات
 * ذات معنى: موعد بلا تاريخ مريض هو سطر في جدول، لا متابعة علاج.
 *
 * التاريخ محدود بعدد معقول لكل جزء: ملف مريض تقويم بعد عامين فيه عشرات الزيارات،
 * وتحميلها كلها في هاتف الاستقبال يبطئ الصفحة بلا أن يقرأها أحد.
 */
export async function getPatientFile(id: number): Promise<PatientFile | null> {
  await ensureSchema();
  const pool = getPool();
  const { rows: patients } = await pool.query<PatientRow & { note: string | null; created_at: Date }>(
    `SELECT id, patient_number, full_name, phone, note, created_at FROM patients WHERE id = $1`,
    [id],
  );
  if (!patients[0]) return null;

  const [{ rows: visitRows }, { rows: appointmentRows }] = await Promise.all([
    pool.query<VisitRow>(
      `SELECT * FROM visits WHERE patient_id = $1 ORDER BY arrived_at DESC LIMIT 50`,
      [id],
    ),
    pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT} WHERE a.patient_id = $1
        ORDER BY a.scheduled_date DESC, a.scheduled_time DESC LIMIT 50`,
      [id],
    ),
  ]);

  return {
    patient: {
      ...toPatient(patients[0]),
      note: patients[0].note,
      createdAt: patients[0].created_at.toISOString(),
    },
    visits: visitRows.map(toVisit),
    appointments: appointmentRows.map(toAppointment),
  };
}

/**
 * يحدّث بيانات المريض القابلة للتصحيح.
 *
 * الاسم والرقم يُكتبان على عجل في يوم مزدحم، وبلا تصحيح يبقى الخطأ إلى الأبد ويُنشأ
 * سجل ثانٍ بدلًا منه. الرقم يُوحَّد كما في كل مكان آخر يكتب سجل مريض.
 */
export async function updatePatient(id: number, input: {
  fullName?: string;
  phone?: string | null;
  note?: string | null;
}): Promise<Patient | null> {
  await ensureSchema();
  const { rows } = await getPool().query<PatientRow>(
    `UPDATE patients SET
       full_name = COALESCE($2, full_name),
       phone     = CASE WHEN $3::boolean THEN $4::text ELSE phone END,
       note      = CASE WHEN $5::boolean THEN $6::text ELSE note  END
     WHERE id = $1
     RETURNING id, patient_number, full_name, phone`,
    [
      id,
      input.fullName ?? null,
      input.phone !== undefined,
      input.phone !== undefined ? normalizePatientPhone(input.phone) : null,
      input.note !== undefined,
      input.note !== undefined ? input.note : null,
    ],
  );
  return rows[0] ? toPatient(rows[0]) : null;
}

// ─── أعمال المختبر ───────────────────────────────────────────────────────────

import type { LabOrder, LabOrderStatus } from "./lab";

interface LabOrderRow {
  id: number;
  patient_id: number;
  full_name: string;
  phone: string | null;
  lab_name: string;
  lab_phone: string | null;
  work_type: string;
  details: string | null;
  sent_date: Date;
  due_date: Date;
  status: string;
  received_at: Date | null;
  delivered_at: Date | null;
  note: string | null;
}

/** التاريخ من مكوّناته المحلية لا بـ toISOString — نفس فخ اليوم السابق. */
function dateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLabOrder(row: LabOrderRow): LabOrder {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.full_name,
    patientPhone: row.phone,
    labName: row.lab_name,
    labPhone: row.lab_phone,
    workType: row.work_type,
    details: row.details,
    sentDate: dateText(row.sent_date),
    dueDate: dateText(row.due_date),
    status: row.status as LabOrderStatus,
    receivedAt: row.received_at ? row.received_at.toISOString() : null,
    deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
    note: row.note,
  };
}

const LAB_SELECT = `
  SELECT l.id, l.patient_id, p.full_name, p.phone, l.lab_name, l.lab_phone, l.work_type,
         l.details, l.sent_date, l.due_date, l.status, l.received_at, l.delivered_at, l.note
    FROM lab_orders l JOIN patients p ON p.id = l.patient_id`;

/**
 * الأعمال المفتوحة وما أُنجز حديثًا.
 *
 * ما سُلّم قبل شهور لا يُحمَّل: القائمة أداة عمل يومية لا أرشيفًا، وصفحة تُحمّل مئات
 * الصفوف على هاتف الاستقبال تُفتح مرة ثم تُهجَر. الأرشيف الكامل يظهر في ملف المريض.
 */
export async function listLabOrders(): Promise<LabOrder[]> {
  await ensureSchema();
  const { rows } = await getPool().query<LabOrderRow>(
    `${LAB_SELECT}
      WHERE l.status IN ('sent', 'received')
         OR l.delivered_at > NOW() - INTERVAL '30 days'
      ORDER BY l.due_date ASC
      LIMIT 300`,
  );
  return rows.map(toLabOrder);
}

export async function createLabOrder(input: {
  patientId: number;
  labName: string;
  labPhone: string | null;
  workType: string;
  details: string | null;
  sentDate: string;
  dueDate: string;
  note: string | null;
}): Promise<LabOrder | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO lab_orders (patient_id, lab_name, lab_phone, work_type, details, sent_date, due_date, note)
     VALUES ($1, $2, $3::text, $4, $5::text, $6::date, $7::date, $8::text) RETURNING id`,
    [
      input.patientId, input.labName, input.labPhone, input.workType,
      input.details, input.sentDate, input.dueDate, input.note,
    ],
  );
  const { rows: full } = await getPool().query<LabOrderRow>(`${LAB_SELECT} WHERE l.id = $1`, [rows[0].id]);
  return full[0] ? toLabOrder(full[0]) : null;
}

/**
 * ينقل العمل بين حالاته، ولا يسمح بقفزة إلى الوراء.
 *
 * الشرط على الحالة الحالية داخل الاستعلام: ضغطتان على «وصل» من جهازين — الاستقبال
 * على الشاشة والطبيب على هاتفه — كانتا ستكتبان تاريخ وصول ثانيًا يمحو الأول، فيبدو
 * العمل كأنه وصل اليوم وهو واصل منذ ثلاثة أيام.
 */
export async function setLabOrderStatus(id: number, status: LabOrderStatus): Promise<LabOrder | null> {
  await ensureSchema();
  const allowedFrom: Record<LabOrderStatus, string[]> = {
    sent: ["received"],
    received: ["sent"],
    delivered: ["received"],
    cancelled: ["sent", "received"],
  };
  const { rows } = await getPool().query<{ id: number }>(
    `UPDATE lab_orders SET
       status = $2,
       received_at  = CASE WHEN $2 = 'received'  THEN NOW() ELSE received_at  END,
       delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END
     WHERE id = $1 AND status = ANY($3::text[])
     RETURNING id`,
    [id, status, allowedFrom[status]],
  );
  if (!rows[0]) return null;
  const { rows: full } = await getPool().query<LabOrderRow>(`${LAB_SELECT} WHERE l.id = $1`, [id]);
  return full[0] ? toLabOrder(full[0]) : null;
}

/** يؤجّل موعد التسليم حين يعد المختبر بموعد جديد — بلا هذا يبقى «متأخرًا» بلا معنى. */
export async function setLabOrderDueDate(id: number, dueDate: string): Promise<LabOrder | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `UPDATE lab_orders SET due_date = $2::date WHERE id = $1 AND status = 'sent' RETURNING id`,
    [id, dueDate],
  );
  if (!rows[0]) return null;
  const { rows: full } = await getPool().query<LabOrderRow>(`${LAB_SELECT} WHERE l.id = $1`, [id]);
  return full[0] ? toLabOrder(full[0]) : null;
}

/** أسماء المختبرات المستخدمة سابقًا — تُختصر الكتابة وتمنع «النور» و«مختبر النور». */
export async function listLabNames(): Promise<{ labName: string; labPhone: string | null }[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{ lab_name: string; lab_phone: string | null }>(
    `SELECT lab_name, MAX(lab_phone) AS lab_phone FROM lab_orders
      GROUP BY lab_name ORDER BY MAX(created_at) DESC LIMIT 10`,
  );
  return rows.map((row) => ({ labName: row.lab_name, labPhone: row.lab_phone }));
}

// ─── الاستدعاء ومتابعة المتغيّبين ────────────────────────────────────────────

import type { RecallRow } from "./recall";

/**
 * المتغيّبون الذين لم يُتابَعوا بعد.
 *
 * موعد فائت بلا مكالمة هو المريض الذي يفهم أن العيادة لم تلاحظ غيابه. والمدى محدود
 * بشهر: الاتصال بمن تغيّب قبل ثلاثة أشهر ليس متابعة غياب — إنه استدعاء، وله قائمته.
 */
export async function listMissedAppointments(): Promise<RecallRow[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    id: number; patient_id: number; full_name: string; phone: string | null;
    scheduled_date: Date; note: string | null;
  }>(
    `SELECT a.id, a.patient_id, p.full_name, p.phone, a.scheduled_date, a.note
       FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.status = 'no_show'
        AND a.follow_up_at IS NULL
        AND a.scheduled_date > CURRENT_DATE - INTERVAL '30 days'
      ORDER BY a.scheduled_date ASC
      LIMIT 100`,
  );
  return rows.map((row) => ({
    kind: "missed" as const,
    id: row.id,
    patientId: row.patient_id,
    patientName: row.full_name,
    patientPhone: row.phone,
    referenceDate: dateText(row.scheduled_date),
    note: row.note,
  }));
}

/**
 * المنقطعون: مرضى مضى على آخر نشاط لهم أكثر من المدة، ولا موعد قادم لهم.
 *
 * شرط «لا موعد قادم» هو الذي يجعل القائمة صالحة: من انقطع شهرين ولكنه حاجز الأسبوع
 * القادم ليس منقطعًا، والاتصال به يقول له إن العيادة لا تعرف مواعيدها.
 *
 * «آخر نشاط» أكبر التاريخين — آخر زيارة وآخر موعد — لأن المريض قد يكون له موعد
 * مسجّل بلا زيارة (سُجّل يدويًا) أو زيارة بلا موعد (مريض مشي).
 *
 * ومن استُدعي في آخر ثلاثين يومًا يخرج مؤقتًا: مكالمتان في أسبوع إلحاحٌ لا اهتمام.
 */
export async function listLapsedPatients(weeks: number): Promise<RecallRow[]> {
  await ensureSchema();
  const days = Math.max(1, Math.round(weeks * 7));
  const { rows } = await getPool().query<{
    id: number; full_name: string; phone: string | null; last_activity: Date; note: string | null;
  }>(
    `WITH activity AS (
       SELECT p.id, p.full_name, p.phone, p.note, p.recalled_at,
              GREATEST(
                COALESCE((SELECT MAX(v.arrived_at)::date FROM visits v WHERE v.patient_id = p.id), p.created_at::date),
                COALESCE((SELECT MAX(a.scheduled_date) FROM appointments a
                           WHERE a.patient_id = p.id AND a.status IN ('done', 'arrived')), p.created_at::date)
              ) AS last_activity
         FROM patients p
        WHERE NOT EXISTS (
                SELECT 1 FROM appointments f
                 WHERE f.patient_id = p.id
                   AND f.scheduled_date >= CURRENT_DATE
                   AND f.status IN ('booked', 'arrived')
              )
     )
     SELECT id, full_name, phone, note, last_activity
       FROM activity
      WHERE last_activity < CURRENT_DATE - ($1::int * INTERVAL '1 day')
        AND (recalled_at IS NULL OR recalled_at < NOW() - INTERVAL '30 days')
      ORDER BY last_activity ASC
      LIMIT 100`,
    [days],
  );
  return rows.map((row) => ({
    kind: "lapsed" as const,
    id: row.id,
    patientId: row.id,
    patientName: row.full_name,
    patientPhone: row.phone,
    referenceDate: dateText(row.last_activity),
    note: row.note,
  }));
}

/**
 * يُسجَّل بعد فتح واتساب لا قبله: التسجيل قبل الفتح يزعم متابعةً لم تحدث.
 *
 * `COALESCE` يُبقي أول وقت متابعة: ضغطة ثانية على الزر — أو فتح واتساب مرتين —
 * كانت ستكتب وقتًا جديدًا فيبدو أننا تابعنا المتغيّب اليوم وقد تابعناه قبل أسبوع.
 * التاريخ الأول هو الحقيقة، وهو ما يُقاس به أثر المتابعة.
 */
export async function markAppointmentFollowedUp(id: number): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE appointments SET follow_up_at = COALESCE(follow_up_at, NOW())
      WHERE id = $1 AND status = 'no_show'`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * آخر استدعاء — لا أوّله: عليه يقوم إخفاء المريض ثلاثين يومًا عن القائمة. لو حُفظ
 * الأول لعاد المريض إلى القائمة كل يوم بعد شهر من أول اتصال مهما اتُّصل به بعده.
 */
export async function markPatientRecalled(id: number): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE patients SET recalled_at = NOW() WHERE id = $1`, [id],
  );
  return (rowCount ?? 0) > 0;
}
