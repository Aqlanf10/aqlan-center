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

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL غير مضبوط — أضف رابط قاعدة البيانات في إعدادات النشر.");
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
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `UPDATE visits
        SET status = 'in_chair', chair = $2, seated_at = NOW()
      WHERE id = $1
        AND status = 'waiting'
        AND NOT EXISTS (
          SELECT 1 FROM visits busy
           WHERE busy.status = 'in_chair' AND busy.chair = $2
        )
      RETURNING *`,
    [id, chair],
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
