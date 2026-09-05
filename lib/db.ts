import { pgConnection } from "./pgConnection";
import { Pool, type PoolClient } from "pg";
import { toWhatsAppNumber } from "./reminders";
import type { Visit, VisitStatus } from "./flow";
import { chairCount } from "./settings";

/**
 * قاعدة بيانات مستقلة عن النظام الأساسي — قرار المالك.
 *
 * الأداة لا تكتب في قاعدة النظام الأساسي إطلاقًا. قواعد المال ومسار الزيارة والأقفال
 * كلها في واجهة النظام الأساسي، وأي كتابة مباشرة من برنامج ثانٍ كانت ستُفسد أرقامه
 * بصمت. الثمن المقبول — وقد قرره المالك صراحة — أن بيانات هذه الأداة تُرحَّل لاحقًا
 * حين يدخل النظام الأساسي الخدمة.
 */

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
  pool = new Pool({ ...pgConnection(connectionString), max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  return pool;
}

let schemaReady: Promise<void> | null = null;

/**
 * يُنسي البرنامج أنه أنشأ المخطط — لفحوص الإقلاع وحدها.
 *
 * `ensureSchema` تُنفَّذ مرة لكل عملية، وهذا هو الصحيح في التشغيل. لكن فحصَ «هل يُعاد
 * الإنشاء بسلامة فوق بيانات قائمة؟» يحتاج إقلاعًا ثانيًا في العملية نفسها — وهو
 * السؤال الذي فات فحصنا مرة، فمرّ خطأ لا يظهر إلا على قاعدة فيها صفوف.
 */
export function schemaReadyReset(): void {
  schemaReady = null;
}

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
      -- بيانات المريض التي تحتاجها عيادة تعمل: رقم بديل، جنس، سنة ميلاد، عنوان،
      -- وتنبيه طبي يُقرأ قبل الإجراء لا بعده.
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS alt_phone     TEXT;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS gender        TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS birth_year    INTEGER;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS address       TEXT;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS medical_alert TEXT;
      CREATE INDEX IF NOT EXISTS patients_phone_idx ON patients (phone);

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
      -- تأكيدُ المريض حضوره من البوابة. عمودٌ لا حالة: «مؤكَّد» ليس حالةً ثالثة
      -- للموعد بل صفةٌ عليه — والحالة تبقى بيد الاستقبال وحدها.
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_confirmed_at TIMESTAMPTZ;

      -- استمارة التاريخ الطبي التي يملؤها المريض في بوابته.
      --
      -- **يُضاف إليها ولا تُستبدل**: كل إرسالٍ صفٌّ جديد. فتاريخُ الصحة يتغيّر مع
      -- الزمن — من صار مريض سكّرٍ هذا العام لم يكن كذلك في استمارة أمس — ومحوُ
      -- القديمة يمحو **متى** تغيّر، وهو ما يُسأل عنه حين يقع ما يُسأل عنه.
      --
      -- ولا تكتب في patients.medical_alert: ذاك حقلُ الطبيب، وهذا قولُ المريض.
      CREATE TABLE IF NOT EXISTS patient_intake (
        id              SERIAL PRIMARY KEY,
        patient_id      INTEGER     NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        conditions      JSONB       NOT NULL DEFAULT '[]'::jsonb,
        allergies       TEXT,
        medications     TEXT,
        emergency_name  TEXT,
        emergency_phone TEXT,
        note            TEXT,
        submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS patient_intake_patient_idx
        ON patient_intake (patient_id, submitted_at DESC);

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

      -- الإعدادات: مفتاح وقيمة. لا أعمدة لكل إعداد، لأن كل إعداد جديد كان سيعني
      -- تعديل جدول في قاعدة إنتاج تعمل عليها عيادة.
      -- ── المالية ────────────────────────────────────────────────────────────
      -- المبالغ كلها أعداد صحيحة بالوحدة الصغرى. الكسور العشرية في المال تتراكم:
      -- مئة دفعة بحساب عشري تعطي رصيدًا يخالف الورقة بريالات لا أحد يعرف مصدرها.

      -- قائمة الأسعار.
      CREATE TABLE IF NOT EXISTS services (
        id            SERIAL PRIMARY KEY,
        name          TEXT        NOT NULL,
        category      TEXT,
        price_minor   BIGINT      NOT NULL DEFAULT 0,
        is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
        sort_order    INTEGER     NOT NULL DEFAULT 100,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE services ADD COLUMN IF NOT EXISTS catalog_code TEXT;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS price_configured BOOLEAN NOT NULL DEFAULT TRUE;
      CREATE UNIQUE INDEX IF NOT EXISTS services_catalog_code_idx ON services(catalog_code) WHERE catalog_code IS NOT NULL;
      CREATE INDEX IF NOT EXISTS services_active_idx ON services (is_active, sort_order);

      -- ورديات الصندوق. الدفع يتطلب وردية مفتوحة، والإغلاق يُقارن الجرد بالمتوقَّع.
      CREATE TABLE IF NOT EXISTS cashier_shifts (
        id            SERIAL PRIMARY KEY,
        opened_by     TEXT        NOT NULL,
        opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        opening_yer   BIGINT      NOT NULL DEFAULT 0,
        opening_sar   BIGINT      NOT NULL DEFAULT 0,
        opening_usd   BIGINT      NOT NULL DEFAULT 0,
        closed_by     TEXT,
        closed_at     TIMESTAMPTZ,
        counted_yer   BIGINT,
        counted_sar   BIGINT,
        counted_usd   BIGINT,
        note          TEXT,
        status        TEXT        NOT NULL DEFAULT 'open'
      );
      -- وردية مفتوحة واحدة لا أكثر: صندوقٌ واحد في العيادة، ووردّيتان مفتوحتان
      -- تعنيان دفعات موزّعة عشوائيًا بينهما فلا يُطابَق أيّهما.
      CREATE UNIQUE INDEX IF NOT EXISTS cashier_shifts_one_open
        ON cashier_shifts ((status)) WHERE status = 'open';

      CREATE TABLE IF NOT EXISTS invoices (
        id             SERIAL PRIMARY KEY,
        invoice_number TEXT        NOT NULL UNIQUE,
        patient_id     INTEGER     NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        status         TEXT        NOT NULL DEFAULT 'open',
        total_minor    BIGINT      NOT NULL DEFAULT 0,
        discount_minor BIGINT      NOT NULL DEFAULT 0,
        base_currency  TEXT        NOT NULL DEFAULT 'YER',
        note           TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS invoices_patient_idx ON invoices (patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices (created_at);

      CREATE TABLE IF NOT EXISTS invoice_items (
        id               SERIAL PRIMARY KEY,
        invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        service_id       INTEGER REFERENCES services(id),
        description      TEXT    NOT NULL,
        quantity         INTEGER NOT NULL DEFAULT 1,
        unit_price_minor BIGINT  NOT NULL DEFAULT 0,
        total_minor      BIGINT  NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items (invoice_id);
      -- ترتيب الإنشاء ليس تجميلًا: جدولٌ يُشار إليه بمفتاح أجنبي يجب أن يُنشأ قبل
      -- من يشير إليه. كان جدول الجهات يُنشأ بعد أول مرجع إليه، فلم يظهر الخلل أبدًا
      -- على قاعدة قائمة — الجدول موجود من قبل — وظهر أول ما بُنيت قاعدة من الصفر:
      -- «relation parties does not exist»، فسقط إنشاء المخطط كله ولم يُنشأ نظام جديد.
      -- جهات التعامل: مختبرات وموردون وأطباء. جدول واحد لأن ما يُسأل عنه واحد:
      -- كم لهذه الجهة عندنا، وكم دفعنا لها.
      CREATE TABLE IF NOT EXISTS parties (
        id         SERIAL PRIMARY KEY,
        name       TEXT        NOT NULL,
        kind       TEXT        NOT NULL DEFAULT 'supplier',
        phone      TEXT,
        note       TEXT,
        -- نسبة عمولة الطبيب من قيمة عمله. تُحفظ في الجهة لا في الكود.
        commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
        is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS parties_kind_idx ON parties (kind, is_active);

      -- الطبيب على مستوى البند لا الفاتورة: فاتورة واحدة قد تحمل عمل طبيبين — كشف
      -- من الأول وحشوة من الثانية — وعمولة كلٍّ على عمله وحده.
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS doctor_id INTEGER REFERENCES parties(id);
      CREATE INDEX IF NOT EXISTS invoice_items_doctor_idx ON invoice_items (doctor_id);

      -- الدفعة تحمل سعر صرفها لحظة الدفع. لو حُسبت بسعر اليوم لتغيّر رصيد كل مريض
      -- كلما حُدِّث السعر — وهو ما يجعل السجل كله بلا معنى.
      CREATE TABLE IF NOT EXISTS payments (
        id                SERIAL PRIMARY KEY,
        receipt_number    TEXT        NOT NULL UNIQUE,
        patient_id        INTEGER     NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        invoice_id        INTEGER     REFERENCES invoices(id) ON DELETE SET NULL,
        shift_id          INTEGER     NOT NULL REFERENCES cashier_shifts(id),
        kind              TEXT        NOT NULL DEFAULT 'payment',
        amount_minor      BIGINT      NOT NULL,
        currency          TEXT        NOT NULL,
        exchange_rate     NUMERIC(18,6) NOT NULL DEFAULT 1,
        base_amount_minor BIGINT      NOT NULL,
        base_currency     TEXT        NOT NULL DEFAULT 'YER',
        method            TEXT        NOT NULL DEFAULT 'cash',
        note              TEXT,
        created_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS payments_patient_idx ON payments (patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS payments_shift_idx ON payments (shift_id);
      CREATE INDEX IF NOT EXISTS payments_created_idx ON payments (created_at);

      -- المصروفات: سند صرف لكل مبلغ يخرج من الصندوق.
      CREATE TABLE IF NOT EXISTS expenses (
        id                SERIAL PRIMARY KEY,
        voucher_number    TEXT        NOT NULL UNIQUE,
        category          TEXT        NOT NULL,
        party_id          INTEGER     REFERENCES parties(id),
        payee_text        TEXT,
        shift_id          INTEGER     NOT NULL REFERENCES cashier_shifts(id),
        amount_minor      BIGINT      NOT NULL,
        currency          TEXT        NOT NULL,
        exchange_rate     NUMERIC(18,6) NOT NULL DEFAULT 1,
        base_amount_minor BIGINT      NOT NULL,
        base_currency     TEXT        NOT NULL DEFAULT 'YER',
        -- ما يربط الصرف بما يُسدَّده: أمر مختبر، أو التزام مورّد، أو عمولة طبيب.
        payable_id        INTEGER,
        note              TEXT,
        created_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS expenses_shift_idx ON expenses (shift_id);
      CREATE INDEX IF NOT EXISTS expenses_created_idx ON expenses (created_at);
      CREATE INDEX IF NOT EXISTS expenses_party_idx ON expenses (party_id, created_at DESC);

      -- الالتزامات: ما على العيادة لجهةٍ ما. الوجه الآخر لمديونية المرضى — أن تعرف
      -- كم عليك كما تعرف كم لك. عيادة تعرف مديونية مرضاها ولا تعرف ما عليها
      -- للمختبرات تحسب نفسها رابحة وهي مدينة.
      CREATE TABLE IF NOT EXISTS payables (
        id                SERIAL PRIMARY KEY,
        party_id          INTEGER     NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        category          TEXT        NOT NULL DEFAULT 'supplier',
        description       TEXT        NOT NULL,
        amount_minor      BIGINT      NOT NULL,
        currency          TEXT        NOT NULL,
        exchange_rate     NUMERIC(18,6) NOT NULL DEFAULT 1,
        base_amount_minor BIGINT      NOT NULL,
        base_currency     TEXT        NOT NULL DEFAULT 'YER',
        lab_order_id      INTEGER     REFERENCES lab_orders(id) ON DELETE SET NULL,
        due_date          DATE,
        created_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS payables_party_idx ON payables (party_id, created_at DESC);
      -- التزام واحد لكل أمر مختبر: تسجيل التكلفة مرتين يضاعف ما على العيادة.
      CREATE UNIQUE INDEX IF NOT EXISTS payables_lab_order_uniq
        ON payables (lab_order_id) WHERE lab_order_id IS NOT NULL;

      -- ربط أمر المختبر بالمختبر المسجّل وتكلفته.
      ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS party_id   INTEGER REFERENCES parties(id);
      ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS cost_minor BIGINT;
      ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS cost_currency TEXT;
      /*
       * كتالوج أعمال المختبر — بدل تسعة أنواع مكتوبة في الكود.
       *
       * ونصٌّ حرّ يجعل «زيركون» و«زركون» وZirconia ثلاثة أعمال في التقارير،
       * فلا يُعرف كم صُرف على الزيركون هذا العام.
       */
      CREATE TABLE IF NOT EXISTS lab_services (
        id             SERIAL PRIMARY KEY,
        name           TEXT        NOT NULL,
        category       TEXT        NOT NULL DEFAULT 'prostho',
        default_days   INTEGER     NOT NULL DEFAULT 7,
        requires_shade BOOLEAN     NOT NULL DEFAULT TRUE,
        is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
        sort_order     INTEGER     NOT NULL DEFAULT 100,
        created_by     TEXT        NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- اسمٌ واحد للعمل الواحد بين العاملة: عملان بالاسم نفسه يقسمان تقريره.
      CREATE UNIQUE INDEX IF NOT EXISTS lab_services_name_unique
        ON lab_services (lower(btrim(name))) WHERE is_active;
      CREATE INDEX IF NOT EXISTS lab_services_active_idx
        ON lab_services (is_active, sort_order, name);

      /*
       * قائمة أسعار كل مختبر — بتاريخ سريان.
       *
       * فالسعر يتغيّر، وأمرٌ أُرسل قبل الرفع سعرُه سعرُ يومه. ومراجعةُ فاتورة
       * الشهر الماضي بسعر اليوم تُنتج خلافًا مع المختبر لا حكم فيه.
       */
      CREATE TABLE IF NOT EXISTS lab_prices (
        id             SERIAL PRIMARY KEY,
        party_id       INTEGER     NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        service_id     INTEGER     NOT NULL REFERENCES lab_services(id) ON DELETE RESTRICT,
        cost_minor     BIGINT      NOT NULL CHECK (cost_minor > 0),
        currency       TEXT        NOT NULL,
        effective_from DATE        NOT NULL,
        effective_to   DATE,
        note           TEXT,
        created_by     TEXT        NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- نهايةٌ قبل بداية تجعل السعر لا يسري يومًا واحدًا، وتبقى في الجدول.
        CONSTRAINT lab_prices_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
      );
      CREATE INDEX IF NOT EXISTS lab_prices_lookup_idx
        ON lab_prices (party_id, service_id, effective_from DESC);

      -- العمل المختار من الكتالوج — ويبقى العمود work_type نصًّا لما سبقه.
      ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS service_id INTEGER
        REFERENCES lab_services(id) ON DELETE SET NULL;

      /*
       * الطبيب الذي أمر بالعمل — وعليه تُخصم تكلفته من عمولته.
       *
       * ويقبل الفراغ: أوامرُ ما قبل هذا العمود لا طبيب لها، وتخمينُه عليها
       * يخصم من طبيبٍ مالًا بحدسٍ لا بسجلّ. فتبقى بلا نسبة وتُعرض في الشاشة
       * «تكلفةٌ بلا طبيب» ليُنسبها المالك بنفسه.
       */
      ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS doctor_party_id INTEGER
        REFERENCES parties(id);
      CREATE INDEX IF NOT EXISTS lab_orders_doctor_idx
        ON lab_orders (doctor_party_id, sent_date) WHERE doctor_party_id IS NOT NULL;

      -- القيود اليدوية: التسويات وإعادة تقييم العملات والأرصدة الافتتاحية. قيود
      -- المستندات تُشتقّ من المستندات نفسها ولا تُخزَّن — فلا مصدرين للحقيقة.
      CREATE TABLE IF NOT EXISTS journal_manual (
        id          SERIAL PRIMARY KEY,
        entry_date  DATE        NOT NULL,
        description TEXT        NOT NULL,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS journal_manual_date_idx ON journal_manual (entry_date);

      CREATE TABLE IF NOT EXISTS journal_manual_lines (
        id           SERIAL PRIMARY KEY,
        entry_id     INTEGER NOT NULL REFERENCES journal_manual(id) ON DELETE CASCADE,
        account_code TEXT    NOT NULL,
        amount_minor BIGINT  NOT NULL,
        side         TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS journal_manual_lines_entry_idx ON journal_manual_lines (entry_id);

      -- خطط العلاج والأقساط: نموذج عمل عيادة التقويم. الخطة **اتفاق**، والقسط
      -- **استحقاق**، والدفعة **تحصيل** — ثلاثة أشياء مختلفة كان خلطها هو ما يجعل
      -- مرضى التقويم أصعب ملفات العيادة.
      CREATE TABLE IF NOT EXISTS treatment_plans (
        id            SERIAL PRIMARY KEY,
        patient_id    INTEGER     NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        title         TEXT        NOT NULL,
        total_minor   BIGINT      NOT NULL,
        base_currency TEXT        NOT NULL DEFAULT 'YER',
        status        TEXT        NOT NULL DEFAULT 'active',
        start_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
        note          TEXT,
        created_by    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS treatment_plans_patient_idx ON treatment_plans (patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS treatment_plans_status_idx ON treatment_plans (status);

      CREATE TABLE IF NOT EXISTS plan_installments (
        id           SERIAL PRIMARY KEY,
        plan_id      INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
        number       INTEGER NOT NULL,
        due_date     DATE    NOT NULL,
        amount_minor BIGINT  NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS plan_installments_uniq ON plan_installments (plan_id, number);
      CREATE INDEX IF NOT EXISTS plan_installments_due_idx ON plan_installments (due_date);

      -- بنود الخطة السريرية: ما سيُعمل، على أيّ سن، وبكم. والإجمالي يُشتقّ منها لا
      -- يُكتب باليد — رقمان لعملٍ واحد هما بذرة كل خلافٍ لاحق مع المريض.
      -- واسم الخدمة وسعرها **منسوخان** لحظة الاتفاق: الدليل يتغيّر غدًا، والاتفاق لا.
      CREATE TABLE IF NOT EXISTS plan_items (
        id               SERIAL PRIMARY KEY,
        plan_id          INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
        service_id       INTEGER REFERENCES services(id),
        service_name     TEXT    NOT NULL,
        category         TEXT,
        tooth_code       SMALLINT,
        surfaces         TEXT,
        quantity         INTEGER NOT NULL DEFAULT 1,
        unit_price_minor BIGINT  NOT NULL DEFAULT 0,
        status           TEXT    NOT NULL DEFAULT 'planned',
        visit_id         INTEGER REFERENCES visits(id),
        done_at          TIMESTAMPTZ,
        note             TEXT,
        sort_order       INTEGER NOT NULL DEFAULT 100,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS plan_items_plan_idx ON plan_items (plan_id, sort_order, id);
      CREATE INDEX IF NOT EXISTS plan_items_open_idx ON plan_items (status, service_id, tooth_code);

      -- الموافقة: متى وُقّعت وبيد من سُجّلت وكيف وُثّقت. وخطةٌ بلا موافقة تبقى
      -- مسوّدةً لا اتفاقًا — وهذا فرقٌ يظهر يوم الخلاف لا قبله.
      ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS consent_at   TIMESTAMPTZ;
      ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS consent_by   TEXT;
      ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS consent_note TEXT;
      -- خطةٌ إجماليّها من بنودها لا من لوحة المفاتيح. تُرفع مرةً عند أول بند ولا
      -- تُخفض: خفضها يعيد الإجمالي إلى رقمٍ يدويٍّ لا سند له.
      ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS total_from_items BOOLEAN NOT NULL DEFAULT FALSE;

      -- الأشعة والمستندات: **الوصف هنا والملفّ على القرص** — الدستور، المحظور ٨.
      -- صورةٌ بانورامية تُقاس بالميغابايتات، ومئةُ مريضٍ شهريًّا تعني قاعدةً تنتفخ
      -- حتى تصير كل نسخةٍ احتياطية عمليةً تستغرق ساعة — فلا تُؤخذ.
      -- وبصمة المحتوى هي اسم الملف على القرص: لا تصادم، ولا تكرار، ولا مسارٌ يُخمَّن.
      CREATE TABLE IF NOT EXISTS patient_documents (
        id           SERIAL PRIMARY KEY,
        patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        visit_id     INTEGER REFERENCES visits(id),
        kind         TEXT    NOT NULL DEFAULT 'other',
        title        TEXT    NOT NULL,
        mime_type    TEXT    NOT NULL,
        size_bytes   BIGINT  NOT NULL,
        sha256       TEXT    NOT NULL,
        storage_key  TEXT    NOT NULL,
        note         TEXT,
        taken_on     DATE,
        uploaded_by  TEXT    NOT NULL,
        uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- الحذف **إخفاءٌ موثَّق** لا محو: السجل الطبي شهادة، ومن يمحو بصمت يمكن
        -- أن يمحو بعد شكوى. والملفّ نفسه يبقى على القرص لأن صفًّا آخر قد يشير إليه.
        removed_at   TIMESTAMPTZ,
        removed_by   TEXT,
        removed_note TEXT
      );
      CREATE INDEX IF NOT EXISTS patient_documents_patient_idx
        ON patient_documents (patient_id, uploaded_at DESC);
      CREATE INDEX IF NOT EXISTS patient_documents_visit_idx ON patient_documents (visit_id);

      -- أبعاد الصورة بالبكسل.
      --
      -- ولم تكن محفوظة، ومعالمُ التتبّع كسورٌ من العرض والارتفاع — فنسبةُ الصورة
      -- تدخل حساب الزاوية. الشاشة تعرفها لأن المتصفّح حمّل الصورة؛ والخادم لم
      -- يكن يعرفها، فكان **تقرير الطباعة يحسب على نسبة ١**. وعلى أشعّةٍ ٤:٥ تُقاس
      -- FMA ٣٦٫٠° على الشاشة و٢٩٫٤° على الورقة — وستّ درجاتٍ ونصف هي الفرق بين
      -- نمطٍ عمودي مرتفع ونمطٍ سويّ، وعليها يُقرَّر القلع والتثبيت.
      ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS image_width INTEGER;
      ALTER TABLE patient_documents ADD COLUMN IF NOT EXISTS image_height INTEGER;

      -- حالة التقويم: علاجٌ يمتدّ سنتين لا زيارةً واحدة.
      -- والفرق الحاكم أن السؤال ليس «ماذا عُمل اليوم» بل «أين نحن من الخطة»: في أيّ
      -- مرحلة، وعلى أيّ سلك، وكم مضى وكم بقي.
      CREATE TABLE IF NOT EXISTS ortho_cases (
        id             SERIAL PRIMARY KEY,
        patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        appliance      TEXT    NOT NULL DEFAULT 'fixed_metal',
        arches         TEXT    NOT NULL DEFAULT 'both',
        slot           TEXT    NOT NULL DEFAULT '022',
        bracket_system TEXT,
        status         TEXT    NOT NULL DEFAULT 'active',
        phase          TEXT    NOT NULL DEFAULT 'aligning',
        start_date     DATE    NOT NULL DEFAULT CURRENT_DATE,
        planned_months INTEGER NOT NULL DEFAULT 18,
        -- السلك الحالي في كل فك: أول ما يحتاجه الطبيب على الكرسي، ويُقرأ بلا حساب
        -- من سجل الشدّات. ويُحدَّث مع كل شدّة في المعاملة نفسها.
        upper_wire     TEXT,
        lower_wire     TEXT,
        -- خطة الأقساط التي تموّل هذه الحالة — والاثنان وجهان لاتفاق واحد.
        plan_id        INTEGER REFERENCES treatment_plans(id),
        retainer       TEXT,
        retainer_on    DATE,
        note           TEXT,
        closed_at      TIMESTAMPTZ,
        closed_by      TEXT,
        closed_note    TEXT,
        created_by     TEXT    NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ortho_cases_patient_idx ON ortho_cases (patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ortho_cases_status_idx ON ortho_cases (status);
      -- حالةٌ جاريةٌ واحدة لكل مريض. وحالتان مفتوحتان تعنيان سجلَّي أسلاك لفمٍ
      -- واحد، فلا يُعرف أيّهما الحقيقي — والقاعدة تمنعه لا الشاشة.
      CREATE UNIQUE INDEX IF NOT EXISTS ortho_cases_one_open
        ON ortho_cases (patient_id) WHERE status IN ('active', 'retention');

      -- زيارات الشدّ: سجلّ العلاج نفسه، لا ملحقًا به.
      CREATE TABLE IF NOT EXISTS ortho_adjustments (
        id           SERIAL PRIMARY KEY,
        case_id      INTEGER NOT NULL REFERENCES ortho_cases(id) ON DELETE CASCADE,
        visit_id     INTEGER REFERENCES visits(id),
        done_on      DATE    NOT NULL DEFAULT CURRENT_DATE,
        phase        TEXT,
        upper_wire   TEXT,
        lower_wire   TEXT,
        elastics     TEXT    NOT NULL DEFAULT 'none',
        elastic_note TEXT,
        done         TEXT,
        next_weeks   INTEGER NOT NULL DEFAULT 4,
        note         TEXT,
        recorded_by  TEXT    NOT NULL,
        recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ortho_adjustments_case_idx
        ON ortho_adjustments (case_id, done_on DESC, id DESC);
      CREATE INDEX IF NOT EXISTS ortho_adjustments_visit_idx ON ortho_adjustments (visit_id);

      -- التتبّع السيفالومتري: **النقاط تُخزَّن والقياسات تُشتقّ**.
      -- ولو خُزّنت الزوايا لصار للحقيقة مصدران: يُصحَّح موضع نقطةٍ بعد مراجعة،
      -- فتبقى الزاوية القديمة في الجدول وتُبنى عليها خطة علاجٍ لسنتين.
      -- تتبّعٌ واحد لكل صورة: الصورة واحدة، وتتبّعان لها يعنيان تحليلين لا يُعرف
      -- أيّهما المعتمد. والتصحيح يُحدّث النقاط ويُسجَّل وقته ومن صحّحها.
      CREATE TABLE IF NOT EXISTS ceph_tracings (
        id          SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL UNIQUE REFERENCES patient_documents(id) ON DELETE CASCADE,
        patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        points      JSONB   NOT NULL DEFAULT '{}'::jsonb,
        calibration JSONB,
        note        TEXT,
        traced_by   TEXT    NOT NULL,
        traced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by  TEXT,
        updated_at  TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS ceph_tracings_patient_idx
        ON ceph_tracings (patient_id, traced_at DESC);

      /*
       * الدراسة السيفالومترية — الوثيقة فوق التتبّع.
       *
       * التتبّع صفٌّ واحد لكل صورة يُكتب فوقه، وهذا صحيحٌ لسطح عمل وخاطئٌ لوثيقة:
       * من يصحّح نقطةً اليوم يغيّر — بأثرٍ رجعي وبلا أثرٍ في السجل — الأرقامَ التي
       * بُنيت عليها خطّةُ علاجٍ قبل سنة. فالخطّة تبقى، والأرقام التي بُرِّرت بها
       * تصير أرقامًا أخرى.
       *
       * والدراسة تحمل موضعها من زمن العلاج (قبل/أثناء/بعد/متابعة)، وحالتها،
       * وحالةَ التقويم التي تخدمها — ودراسةٌ لا تعرفها ورقةٌ في درج.
       *
       * ولقطةُ الاعتماد **معالمُ ومعايرة لا زوايا**: القياس يبقى مشتقًّا كما هو
       * في كل هذا النظام. وتجميدُ الزوايا يعني رقمين لحقيقةٍ واحدة، ويومَ تُصحَّح
       * معادلةٌ لا يُصحَّح المحفوظ — فيبقى في الملف رقمٌ يُعرف أنه خطأ ولا يُمسّ.
       */
      /*
       * الوصفات الطبية — وثائقُ تخرج من المركز في يد المريض.
       *
       * والأدوية في عمود items مجموعةً لا في جدولٍ ثانٍ: هي محتوى الوثيقة لا
       * كياناتٌ تُستعلم أو تُربط، وتُقرأ وتُطبع كتلةً واحدة كما صدرت.
       *
       * ولا تعديل بعد الإصدار: لا عمود يُحدَّث إلّا أعمدة الإبطال. فنسخةُ
       * المريض ونسخةُ الملف تبقيان واحدة.
       */
      CREATE TABLE IF NOT EXISTS prescriptions (
        id                SERIAL PRIMARY KEY,
        patient_id        INTEGER     NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        visit_id          INTEGER     REFERENCES visits(id) ON DELETE SET NULL,
        diagnosis         TEXT        NOT NULL DEFAULT '',
        notes             TEXT        NOT NULL DEFAULT '',
        instructions_lang TEXT        NOT NULL DEFAULT 'both',
        items             JSONB       NOT NULL,
        -- لقطةُ المريض يوم الإصدار: الورقة لا تتغيّر بتغيّر ملفّه بعدها،
        -- وأخطرُ ما فيها التنبيه الطبي.
        patient_name      TEXT        NOT NULL DEFAULT '',
        patient_number    TEXT        NOT NULL DEFAULT '',
        patient_birth_year INTEGER,
        patient_gender    TEXT        NOT NULL DEFAULT 'unspecified',
        medical_alert     TEXT,
        issued_by         TEXT        NOT NULL,
        issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        voided_by         TEXT,
        voided_at         TIMESTAMPTZ,
        void_reason       TEXT
      );
      CREATE INDEX IF NOT EXISTS prescriptions_patient_idx
        ON prescriptions (patient_id, issued_at DESC);
      CREATE INDEX IF NOT EXISTS prescriptions_visit_idx
        ON prescriptions (visit_id);

      CREATE TABLE IF NOT EXISTS ceph_studies (
        id             SERIAL PRIMARY KEY,
        patient_id     INTEGER     NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        document_id    INTEGER     NOT NULL REFERENCES patient_documents(id) ON DELETE RESTRICT,
        ortho_case_id  INTEGER              REFERENCES ortho_cases(id) ON DELETE SET NULL,
        phase          TEXT        NOT NULL DEFAULT 'pre',
        status         TEXT        NOT NULL DEFAULT 'draft',
        revision       INTEGER     NOT NULL DEFAULT 1,
        title          TEXT,
        taken_on       DATE,
        note           TEXT,
        -- تُملأ عند الاعتماد وحده، وتبقى كما هي بعده.
        snapshot_points      JSONB,
        snapshot_calibration JSONB,
        approved_by    TEXT,
        approved_at    TIMESTAMPTZ,
        archived_at    TIMESTAMPTZ,
        created_by     TEXT        NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ceph_studies_patient_idx
        ON ceph_studies (patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ceph_studies_document_idx
        ON ceph_studies (document_id, revision DESC);
      CREATE INDEX IF NOT EXISTS ceph_studies_case_idx
        ON ceph_studies (ortho_case_id) WHERE ortho_case_id IS NOT NULL;

      -- مسودّةٌ واحدة لكل صورة: مسودّتان على أشعّةٍ واحدة تعنيان طبيبين يعملان
      -- على نسختين ولا يعرف أحدهما بالآخر. والمعتمدات تتراكم بإصداراتها بلا حدّ.
      CREATE UNIQUE INDEX IF NOT EXISTS ceph_studies_one_draft_idx
        ON ceph_studies (document_id) WHERE status = 'draft';

      /*
       * المجموعات المرجعية السيفالومترية.
       *
       * كانت المعايير ثابتةً في الكود: متوسّطٌ وانحرافٌ لكل قياس، بلا عمرٍ ولا جنسٍ
       * ولا مجتمع. وهذا يخالف قاعدة المشروع — لا تثبيت للقواعد التشغيلية في الكود —
       * ويُطبّق معيارَ ستاينر المأخوذ من مجتمعٍ آخر على مريضٍ في تعز بلا تمييز.
       *
       * فصارت مجموعاتٍ تُدار: واحدةٌ افتراضية تُزرع بالقيم الكلاسيكية موثَّقةً
       * بمرجعها، وللمدير أن يضيف مجموعةً محلّية متى جمع بياناته ويجعلها الافتراضية.
       */
      /*
       * المخزون — بندٌ وحركاته.
       *
       * ولا عمودَ رصيد. الرصيد مجموعُ الحركات، يُحسب عند كل قراءة — فلا يفترق رقمٌ
       * عن سجلّه أبدًا. وعمودٌ يُحدَّث مع كل حركة يكفي أن يفشل تحديثه مرّةً ليصير
       * في القاعدة رقمان لا يُعرف أيّهما الصحيح.
       */
      CREATE TABLE IF NOT EXISTS inventory_items (
        id         SERIAL PRIMARY KEY,
        name       TEXT          NOT NULL,
        category   TEXT          NOT NULL DEFAULT 'other',
        unit       TEXT          NOT NULL DEFAULT 'وحدة',
        -- حدّ الطلب: دونه يُنبَّه قبل أن ينتهي البند لا بعده.
        min_level  NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_level >= 0),
        note       TEXT,
        is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
        created_by TEXT          NOT NULL,
        created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS inventory_items_active_idx ON inventory_items (is_active, name);
      -- اسمٌ واحد للبند الواحد: بندان باسم «قفازات» يقسمان رصيدًا واحدًا على
      -- سجلَّين، فيبدو كلاهما تحت الحدّ والمخزن ممتلئ.
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_unique
        ON inventory_items (lower(btrim(name))) WHERE is_active;

      CREATE TABLE IF NOT EXISTS inventory_movements (
        id          SERIAL PRIMARY KEY,
        item_id     INTEGER       NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
        kind        TEXT          NOT NULL CHECK (kind IN ('in','out','adjust')),
        -- صفرٌ ليس حركة: التسوية الصفرية تعني أن الجرد وافق السجلّ.
        qty         NUMERIC(12,3) NOT NULL CHECK (qty <> 0),
        expiry_date DATE,
        reason      TEXT,
        visit_id    INTEGER       REFERENCES visits(id) ON DELETE SET NULL,
        patient_id  INTEGER       REFERENCES patients(id) ON DELETE SET NULL,
        -- ردُّ ما صُرف على زيارة، لا إدخالٌ جديد إلى المخزن. والفرق ليس تسمية:
        -- الإدخال دفعةٌ جديدة لها صلاحيتها، والردّ **إلغاءُ استهلاك** يعيد المادّة
        -- إلى دفعتها الأولى بصلاحيتها. فلو حُسب الردّ إدخالًا لضاعت صلاحية ما رُدّ،
        -- ولَبدا بندٌ عاد إلى الرفّ وهو على وشك الانتهاء كأنه سليم.
        is_return   BOOLEAN       NOT NULL DEFAULT FALSE,
        created_by  TEXT          NOT NULL,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      ALTER TABLE inventory_movements
        ADD COLUMN IF NOT EXISTS is_return BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements (item_id, id);
      CREATE INDEX IF NOT EXISTS inventory_movements_visit_idx
        ON inventory_movements (visit_id, item_id) WHERE visit_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS inventory_movements_expiry_idx
        ON inventory_movements (expiry_date) WHERE kind = 'in' AND expiry_date IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ceph_reference_sets (
        id          SERIAL PRIMARY KEY,
        name        TEXT    NOT NULL,
        -- المرجع العلمي — كي يُراجَع الرقم لا يُصدَّق.
        source      TEXT    NOT NULL,
        note        TEXT,
        is_default  BOOLEAN NOT NULL DEFAULT FALSE,
        archived    BOOLEAN NOT NULL DEFAULT FALSE,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by  TEXT,
        updated_at  TIMESTAMPTZ
      );
      -- مجموعةٌ افتراضية واحدة لا أكثر: واثنتان تعنيان أن «المعيار» سؤالٌ بجوابين.
      CREATE UNIQUE INDEX IF NOT EXISTS ceph_reference_one_default
        ON ceph_reference_sets (is_default) WHERE is_default;

      /*
       * والقيمة قد تختلف بالجنس.
       *
       * معيار Wits ذكورًا ١±٢ وإناثًا ٠±٢ (Jacobson 1975) — ومليمترٌ واحد هنا يقلب
       * حكمًا. والقيمة العامّة «any» تُستعمل حين لا يُعرف جنس المريض أو حين لا
       * يفرّق المعيار — فلا يُجبَر كل قياسٍ على صفَّين لا معنى لثانيهما.
       *
       * أمّا الفئة العمرية فلم تُضف: المواصفة تطلبها، ولا قيمَ عمريةً موثَّقةً
       * تُملأ بها. وحقلٌ فارغٌ يُوهم أن العمر داخلٌ في الحساب وهو ليس كذلك.
       */
      CREATE TABLE IF NOT EXISTS ceph_reference_values (
        set_id      INTEGER NOT NULL REFERENCES ceph_reference_sets(id) ON DELETE CASCADE,
        measurement TEXT    NOT NULL,
        sex         TEXT    NOT NULL DEFAULT 'any' CHECK (sex IN ('any', 'male', 'female')),
        mean        DOUBLE PRECISION NOT NULL,
        -- الانحراف موجبٌ دائمًا: صفرٌ يجعل كل قياسٍ خارج المعيار إلا المطابق تمامًا.
        tolerance   DOUBLE PRECISION NOT NULL CHECK (tolerance > 0),
        source      TEXT    NOT NULL,
        PRIMARY KEY (set_id, measurement, sex)
      );

      /*
       * وترقيةُ جدولٍ أُنشئ قبل إدخال الجنس.
       *
       * CREATE TABLE IF NOT EXISTS لا يضيف عمودًا إلى جدولٍ قائم — يمرّ صامتًا
       * ويترك الجدول على شكله القديم. فتنكسر القراءة على قاعدةٍ عمرها يومان بينما
       * تنجح على قاعدةٍ تُبنى من الصفر، ويُفحص الفحصُ على الثانية فيُظنّ كل شيء
       * بخير. وهذا ما وقع: قاعدة التطوير بقيت بلا العمود، فسقط الاستدعاء وعادت
       * الشاشة إلى المعيار المدمج — فطُبّق معيار الذكور على مريضة.
       */
      ALTER TABLE ceph_reference_values
        ADD COLUMN IF NOT EXISTS sex TEXT NOT NULL DEFAULT 'any';

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.key_column_usage
           WHERE table_name = 'ceph_reference_values'
             AND constraint_name = 'ceph_reference_values_pkey'
             AND column_name = 'sex'
        ) THEN
          ALTER TABLE ceph_reference_values DROP CONSTRAINT IF EXISTS ceph_reference_values_pkey;
          ALTER TABLE ceph_reference_values
            ADD CONSTRAINT ceph_reference_values_pkey PRIMARY KEY (set_id, measurement, sex);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ceph_reference_values_sex_check'
        ) THEN
          ALTER TABLE ceph_reference_values
            ADD CONSTRAINT ceph_reference_values_sex_check CHECK (sex IN ('any', 'male', 'female'));
        END IF;
      END $$;

      -- وبذرةٌ قديمة فيها Wits صفًّا عامًّا واحدًا: يصير صفَّ الذكور ويُضاف صفُّ
      -- الإناث. وتركُها عامّةً يعني تطبيق معيار الذكور على كل مريضة.
      UPDATE ceph_reference_values SET sex = 'male'
       WHERE measurement = 'WITS' AND sex = 'any';
      INSERT INTO ceph_reference_values (set_id, measurement, sex, mean, tolerance, source)
      SELECT set_id, 'WITS', 'female', 0, 2, source
        FROM ceph_reference_values WHERE measurement = 'WITS' AND sex = 'male'
      ON CONFLICT (set_id, measurement, sex) DO NOTHING;

      -- الدفعة قد تكون على خطة: عليها يقوم حساب ما سُدّد منها.
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES treatment_plans(id);
      CREATE INDEX IF NOT EXISTS payments_plan_idx ON payments (plan_id);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES treatment_plans(id);

      -- الأرصدة الافتتاحية للمرضى: ما كان على المريض **قبل** تشغيل النظام.
      -- صفٌّ واحد لكل مريض عمدًا: الرصيد الافتتاحي واقعة واحدة لا سجلّ حركات، وتعدّد
      -- الصفوف يجعل «كم كان عليه يوم البدء» سؤالًا بأكثر من جواب.
      CREATE TABLE IF NOT EXISTS patient_opening_balances (
        patient_id   INTEGER     PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
        amount_minor BIGINT      NOT NULL CHECK (amount_minor > 0),
        as_of_date   DATE        NOT NULL,
        note         TEXT,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS opening_balances_date_idx ON patient_opening_balances (as_of_date);

      -- عدّادات أرقام المستندات.
      --
      -- كانت الأرقام تُولَّد بأكبر رقم زائد واحد داخل جملة الإدراج. والقيد الفريد يمنع
      -- التكرار، لكنه يمنعه **بإفشال الطلب الثاني**: موظفتان تقبضان في الثانية نفسها
      -- فترى إحداهما خطأً عامًّا وهي تمسك نقود مريض. والأسوأ في تسجيل قسط: الفاتورة
      -- والدفعة في معاملة واحدة، فيسقط القسط كله.
      --
      -- والعدّاد يحلّها من أصلها: nextval لا يتصادم ولا ينتظر قفلًا.
      CREATE SEQUENCE IF NOT EXISTS patient_number_seq;
      CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;
      CREATE SEQUENCE IF NOT EXISTS receipt_number_seq;
      CREATE SEQUENCE IF NOT EXISTS voucher_number_seq;

      -- المواءمة مع ما هو موجود، **إلى الأمام فقط**: GREATEST مع قيمة العدّاد
      -- الحالية تمنع إرجاعه إلى الخلف عند إقلاع لاحق — وإرجاعه يعني إصدار رقم
      -- مستعمل، وهو ما يُفشل الإدراج بدل أن يُصلحه.
      SELECT setval('patient_number_seq', GREATEST(
        (SELECT last_value FROM patient_number_seq),
        (SELECT COALESCE(MAX(NULLIF(regexp_replace(patient_number, '\\D', '', 'g'), '')::bigint), 0) FROM patients)
      ), true);
      SELECT setval('invoice_number_seq', GREATEST(
        (SELECT last_value FROM invoice_number_seq),
        (SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\\D', '', 'g'), '')::bigint), 0) FROM invoices)
      ), true);
      SELECT setval('receipt_number_seq', GREATEST(
        (SELECT last_value FROM receipt_number_seq),
        (SELECT COALESCE(MAX(NULLIF(regexp_replace(receipt_number, '\\D', '', 'g'), '')::bigint), 0) FROM payments)
      ), true);
      SELECT setval('voucher_number_seq', GREATEST(
        (SELECT last_value FROM voucher_number_seq),
        (SELECT COALESCE(MAX(NULLIF(regexp_replace(voucher_number, '\\D', '', 'g'), '')::bigint), 0) FROM expenses)
      ), true);

      -- طبعات المستندات المالية.
      --
      -- سندٌ يُطبع مرتين ويُعطى مرتين يمكن أن يُقدَّم دليلًا على دفعتين. والعلامة على
      -- النسخة الثانية تحمي الطرفين: المريض من اتهامٍ باطل، والمركز من مطالبةٍ
      -- بمبلغ قُبض مرة واحدة.
      CREATE TABLE IF NOT EXISTS document_prints (
        id         BIGSERIAL   PRIMARY KEY,
        doc_type   TEXT        NOT NULL,
        doc_id     TEXT        NOT NULL,
        printed_by TEXT        NOT NULL,
        printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS document_prints_doc_idx ON document_prints (doc_type, doc_id);

      -- الزيارة السريرية: **أعمدة على جدول الزيارات القائم لا جدول موازٍ**.
      --
      -- والدستور يمنع إنشاء وحدة جديدة قبل البحث في النواة: جدول الزيارات هو الزيارة
      -- فعلًا — وصولٌ وانتظارٌ وكرسي — وما ينقصه توثيقُ الطبيب. وجدولٌ ثانٍ اسمه
      -- clinical_visits كان سيعني مريضًا له زيارتان لحدثٍ واحد، وهو أول باب
      -- للازدواجية التي جاء الدستور ليمنعها.
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS chief_complaint TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS examination     TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS diagnosis       TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS treatment_done  TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS next_plan       TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS addendum        TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS doctor_id       INTEGER REFERENCES parties(id);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS signed_at       TIMESTAMPTZ;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS signed_by       TEXT;
      -- الفاتورة المولَّدة من الزيارة: الرابط الذي يجعل «عملٌ بلا فاتورة» مستحيلًا.
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS invoice_id      INTEGER REFERENCES invoices(id);

      -- الإجراءات المنفَّذة في الزيارة — كلٌّ منها **خدمة من الدليل** لا نصّ حرّ.
      CREATE TABLE IF NOT EXISTS visit_procedures (
        id               BIGSERIAL PRIMARY KEY,
        visit_id         INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
        service_id       INTEGER NOT NULL REFERENCES services(id),
        doctor_id        INTEGER REFERENCES parties(id),
        tooth_code       SMALLINT,
        surfaces         TEXT,
        quantity         INTEGER NOT NULL DEFAULT 1,
        unit_price_minor BIGINT  NOT NULL DEFAULT 0,
        note             TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE visit_procedures ADD COLUMN IF NOT EXISTS plan_item_id INTEGER REFERENCES plan_items(id);
      CREATE INDEX IF NOT EXISTS visit_procedures_visit_idx ON visit_procedures (visit_id);

      -- حالات الأسنان — سجلٌّ زمني لا حالة واحدة لكل سن.
      --
      -- الجدول **يُضاف إليه ولا يُعدَّل**: حالةُ السن اليوم تُعرف من آخر سطر لا من
      -- حقلٍ يُكتب فوقه. والفرق أن تاريخ السن يبقى: متى وُجد التسوّس، ومتى حُشي،
      -- ومن سجّل كلًّا منهما. وحقلٌ واحد يُكتب فوقه يمحو التاريخ مع كل تحديث —
      -- والدستور يمنع التعديل الصامت على الحركات السريرية.
      CREATE TABLE IF NOT EXISTS tooth_conditions (
        id          BIGSERIAL   PRIMARY KEY,
        patient_id  INTEGER     NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        tooth_code  SMALLINT    NOT NULL,
        condition   TEXT        NOT NULL,
        stage       TEXT        NOT NULL DEFAULT 'existing',
        surfaces    TEXT,
        note        TEXT,
        visit_id    INTEGER     REFERENCES visits(id),
        recorded_by TEXT        NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS tooth_conditions_patient_idx
        ON tooth_conditions (patient_id, tooth_code, recorded_at);

      -- سجل التدقيق — يُكتب ولا يُعدَّل ولا يُحذف.
      --
      -- لا عمود updated_at ولا حالة ولا حذف منطقي: كلها أبوابٌ للتعديل، وسجلٌّ
      -- يمكن تعديله يشهد لمن يملك تعديله وحده. والحماية هنا في **غياب المسار**
      -- لا في صلاحية تُمنح وتُمنع: لا دالة في البرنامج كله تحدّث هذا الجدول أو
      -- تحذف منه — والقيود أدناه تجعل المحاولة تفشل في القاعدة نفسها.
      CREATE TABLE IF NOT EXISTS audit_log (
        id         BIGSERIAL   PRIMARY KEY,
        action     TEXT        NOT NULL,
        entity     TEXT,
        entity_id  TEXT,
        summary    TEXT        NOT NULL,
        details    JSONB,
        actor      TEXT        NOT NULL,
        actor_role TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (created_at DESC);
      CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);
      CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id);

      -- الحارس الأخير: قاعدة البيانات ترفض التعديل والحذف مهما كان مصدرهما — حتى
      -- من اتصال مباشر بالقاعدة. وهذا ما يجعل السجل شهادةً لا مجرّد جدول.
      CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS TRIGGER AS $audit$
      BEGIN
        RAISE EXCEPTION 'سجل التدقيق لا يُعدَّل ولا يُحذف منه.';
      END;
      $audit$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

      DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT        NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT        NOT NULL UNIQUE,
        display_name  TEXT        NOT NULL,
        password_hash TEXT        NOT NULL,
        role          TEXT        NOT NULL DEFAULT 'staff',
        is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

      -- الرسائل الداخلية بين الطاقم.
      --
      -- العيادة تعمل بالنداء من الباب، فيُنسى ما قيل ولا يُعرف غدًا من قاله ولا
      -- متى. وهذا سجلٌّ للعمل لا دردشة.
      --
      -- والمستقبِل NULL يعني الفريق كلّه: صفٌّ واحد يراه الجميع، لا نسخةٌ لكل
      -- زميل. ونسخةٌ لكل زميل تعني تسجيلًا صوتيًا واحدًا مكتوبًا خمس مرات، ثم
      -- تُقرأ إحداها فتبقى الأربع «غير مقروءة» إلى الأبد.
      --
      -- والصوت هنا **وصفُه لا جسمُه**: المفتاح على القرص والمدّة والحجم. المحظور
      -- الثامن — لا Blobs في القاعدة، لأن نسخةً احتياطية تستغرق ساعة نسخةٌ لا
      -- تُؤخذ.
      CREATE TABLE IF NOT EXISTS staff_messages (
        id           SERIAL PRIMARY KEY,
        sender_id    INTEGER     NOT NULL REFERENCES users(id),
        recipient_id INTEGER              REFERENCES users(id),
        kind         TEXT        NOT NULL DEFAULT 'text',
        body         TEXT,
        voice_key    TEXT,
        voice_mime   TEXT,
        voice_ms     INTEGER,
        voice_bytes  INTEGER,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS staff_messages_pair_idx
        ON staff_messages (sender_id, recipient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS staff_messages_inbox_idx
        ON staff_messages (recipient_id, created_at DESC);

      -- من قرأ ماذا. جدولٌ منفصل لا عمود: رسالة الفريق يقرؤها خمسة في أوقات
      -- خمسة، وعمودٌ واحد لا يسع إلا واحدًا منهم.
      CREATE TABLE IF NOT EXISTS staff_message_reads (
        message_id INTEGER     NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS staff_message_reads_user_idx
        ON staff_message_reads (user_id, message_id);
      CREATE OR REPLACE FUNCTION revoke_changed_user_sessions() RETURNS TRIGGER AS $sessions$
      BEGIN
        IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
           OR NEW.role IS DISTINCT FROM OLD.role
           OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
          NEW.session_version := OLD.session_version + 1;
        END IF;
        RETURN NEW;
      END;
      $sessions$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS users_revoke_sessions ON users;
      CREATE TRIGGER users_revoke_sessions BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION revoke_changed_user_sessions();

      CREATE TABLE IF NOT EXISTS login_limits (
        key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS login_limits_window_idx ON login_limits(window_start);
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
  /** ملفُّ المريض إن اختارته الاستقبال من القائمة — وهو ما يمنع الملف الثاني. */
  patientId?: number | null;
}): Promise<Visit> {
  await ensureSchema();
  const { rows } = await getPool().query<VisitRow>(
    `INSERT INTO visits (patient_name, patient_phone, note, patient_id)
     VALUES ($1, $2, $3, $4::int) RETURNING *`,
    [input.patientName, input.patientPhone, input.note, input.patientId ?? null],
  );
  return toVisit(rows[0]);
}

/**
 * يربط زيارةً بملفٍّ قائم.
 *
 * **العلّة التي يعالجها**: المريض المسجَّل الذي يصل بلا رقم جوال كان يُنشأ له ملفٌ
 * ثانٍ عند التوقيع، لأن حلّ الملف يطابق بالهاتف وحده. فتذهب فاتورته ومخططه إلى ملفٍ
 * غير ملفّه، ويصير له تاريخان — وهو نقيض المبدأ الأول: مريضٌ واحد بسجلٍّ واحد.
 *
 * ولا يطابق البرنامج بالاسم من تلقاء نفسه: «محمد أحمد» اسمُ رجلين، ودمجُ ملفَّي
 * شخصين أسوأ من تكرار ملفٍّ واحد — الأول يخلط تاريخين طبيّين، والثاني يُدمج لاحقًا.
 * فالربط **قرارٌ بشري**: البرنامج يعرض المرشّحين، والاستقبال تختار.
 *
 * ولا يُربط بعد التوقيع: الفاتورة صدرت لملفٍّ بعينه، وتحويلُ الزيارة بعدها يترك
 * فاتورةً في ملفٍ وعملًا في آخر.
 */
export async function linkVisitToPatient(visitId: number, patientId: number): Promise<
  { ok: true; patientName: string } | { ok: false; message: string }
> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: visits } = await client.query<{ signed_at: Date | null; patient_id: number | null }>(
      `SELECT signed_at, patient_id FROM visits WHERE id = $1 FOR UPDATE`, [visitId],
    );
    if (!visits[0]) { await client.query("ROLLBACK"); return { ok: false, message: "الزيارة غير موجودة." }; }
    if (visits[0].signed_at) {
      await client.query("ROLLBACK");
      return { ok: false, message: "الزيارة موقَّعة — وفاتورتها صدرت لملفٍّ بعينه فلا تُحوَّل." };
    }

    const { rows: patients } = await client.query<{ full_name: string; phone: string | null }>(
      `SELECT full_name, phone FROM patients WHERE id = $1`, [patientId],
    );
    if (!patients[0]) { await client.query("ROLLBACK"); return { ok: false, message: "الملف غير موجود." }; }

    // الاسم والهاتف يتبعان الملف: ما يظهر على اللوحة يجب أن يوافق ما في السجل.
    await client.query(
      `UPDATE visits SET patient_id = $2, patient_name = $3,
              patient_phone = COALESCE(NULLIF(patient_phone, ''), $4::text)
        WHERE id = $1`,
      [visitId, patientId, patients[0].full_name, patients[0].phone],
    );
    await client.query("COMMIT");
    return { ok: true, patientName: patients[0].full_name };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * يُجلس المريض على كرسي، ويرفض إن كان الكرسي مشغولًا.
 *
 * الشرط `NOT EXISTS` داخل الاستعلام نفسه لا في الكود: الاستقبال قد تكون على شاشة
 * والطبيب على هاتفه، وضغطهما معًا على نفس الكرسي في نفس اللحظة كان سيُجلس مريضين
 * على كرسي واحد. الفحص هنا ذرّي، فيفوز واحد ويُخبَر الثاني.
 */
export async function seatVisit(id: number, chair: number): Promise<Visit | null> {
  return occupyChair(id, chair, "in_chair");
}

async function occupyChair(id: number, chair: number, status: "called" | "in_chair"): Promise<Visit | null> {
  // الحراسة محدودة بيوم العيادة عمدًا: زيارة أمس لم يضغط أحد «انتهى» عليها تبقى
  // `in_chair` في الجدول، وهي غير ظاهرة في لوحة اليوم — فلو شملها الفحص لظلّ الكرسي
  // مرفوضًا كل صباح برسالة «الكرسي شُغل للتو» بلا أحد عليه وبلا طريقة لتحريره.
  await ensureSchema();
  const settings = await getSettings();
  if (!Number.isInteger(chair) || chair < 1 || chair > chairCount(settings)) return null;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(41001, $1)", [chair]);
    const { rows } = await client.query<VisitRow>(
      `UPDATE visits
          SET status = $4, chair = $2,
              seated_at = CASE WHEN $4 = 'in_chair' THEN NOW() ELSE seated_at END,
              called_at = CASE WHEN $4 = 'called' THEN NOW() ELSE called_at END
        WHERE id = $1
          AND (arrived_at AT TIME ZONE $3)::date = (NOW() AT TIME ZONE $3)::date
          AND (status = 'waiting' OR ($4 = 'in_chair' AND status = 'called'))
          AND NOT EXISTS (
            SELECT 1 FROM visits busy
             WHERE busy.status IN ('called', 'in_chair') AND busy.chair = $2 AND busy.id <> $1
               AND (busy.arrived_at AT TIME ZONE $3)::date = (NOW() AT TIME ZONE $3)::date
          )
        RETURNING *`, [id, chair, CLINIC_TIME_ZONE, status],
    );
    await client.query("COMMIT");
    return rows[0] ? toVisit(rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
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
/**
 * يحلّ ملف المريض من زيارة — ويُنشئه إن لم يوجد.
 *
 * **دالة واحدة يستعملها المساران**: حجزُ الجلسة القادمة، وتوقيعُ الزيارة الذي يُصدر
 * الفاتورة. وكانت محبوسة داخل حجز الجلسة، فكان توقيع زيارةِ مريضٍ مشي يفشل لأنه بلا
 * ملف — بينما نفس المريض يُنشأ له ملفٌ لو حُجزت له جلسة. سلوكان لحالة واحدة، وهو
 * أوّل ما يُنتج «مريضًا في وحدة ومريضًا آخر في وحدة».
 *
 * والبحث بالرقم لا بالاسم: «عبدالله محمد» و«عبد الله محمد» شخص واحد بسجلّين.
 * وتُستدعى **داخل معاملة الطرف المستدعي** فتسقط معه إن سقط.
 */
async function resolveVisitPatient(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  visit: { id: number; patient_name: string; patient_phone: string | null; patient_id: number | null },
  overridePhone?: string | null,
): Promise<number> {
  const rawPhone = overridePhone ?? visit.patient_phone;
  // الرقم يُوحَّد قبل أن يُكتب: المريض المشي يكتب رقمه محليًا، ولو حُفظ كما هو لصار
  // له سجلّ ثانٍ حين يحجز يومًا من صفحة الحجز بنفس الرقم.
  const phone = normalizePatientPhone(rawPhone);

  let patientId = visit.patient_id;
  if (!patientId && phone) {
    const { rows } = await client.query(
      `SELECT id FROM patients WHERE phone = ANY($1::text[]) ORDER BY id LIMIT 1`,
      [phoneLookupForms(rawPhone)],
    );
    patientId = (rows[0]?.id as number) ?? null;
  }
  if (!patientId) {
    const { rows } = await client.query(
      `INSERT INTO patients (patient_number, full_name, phone)
       VALUES ('P-' || LPAD(nextval('patient_number_seq')::text, 5, '0'), $1, $2)
       RETURNING id`,
      [visit.patient_name, phone],
    );
    patientId = rows[0].id as number;
  } else if (phone) {
    // رقم وصل ولم يكن في السجل: يُملأ ولا يُستبدل رقمٌ قائم.
    await client.query(
      `UPDATE patients SET phone = $2 WHERE id = $1 AND (phone IS NULL OR phone = '')`,
      [patientId, phone],
    );
  }
  // يُثبَّت في الزيارة فلا تتكرّر العملية، ويصير الرابط ظاهرًا في كل شاشة.
  await client.query(
    `UPDATE visits SET patient_id = $2 WHERE id = $1 AND patient_id IS NULL`,
    [visit.id, patientId],
  );
  return patientId;
}

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
    const phone = normalizePatientPhone(input.phone ?? visit.patient_phone);
    const patientId = await resolveVisitPatient(client, visit, input.phone ?? visit.patient_phone);

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
  sessionVersion: number;
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
}

interface UserRow {
  session_version: number;
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  is_active: boolean;
}

function toUser(row: UserRow): StaffUser {
  return {
    sessionVersion: row.session_version,
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

import { clinicDateString } from "./schedule";
import { setupTokenIsLive, type ReadinessFacts } from "./readiness";
import { type IntakeAnswers } from "./intake";
import { CONFIRM_REFUSAL, confirmVerdict } from "./portal";
import type { Appointment, AppointmentStatus } from "./schedule";

import { ageFromBirthYear } from "./patient";
import { debtAge, type DebtHistory } from "./debtAge";
import type { Gender, Patient, PatientInput } from "./patient";
import type { CandidatePatient } from "./duplicates";

/** ما يكفي لقائمة بحث: الحقول الثقيلة لا تُحمَّل لعشرين نتيجة لن تُقرأ. */
export interface PatientSummary {
  id: number;
  patientNumber: string;
  fullName: string;
  phone: string | null;
  medicalAlert: string | null;
}

interface PatientRow {
  id: number;
  patient_number: string;
  full_name: string;
  phone: string | null;
  alt_phone: string | null;
  gender: string;
  birth_year: number | null;
  address: string | null;
  medical_alert: string | null;
  note: string | null;
  created_at: Date;
}

const PATIENT_COLUMNS = `id, patient_number, full_name, phone, alt_phone, gender,
                         birth_year, address, medical_alert, note, created_at`;

const toPatient = (row: PatientRow): Patient => ({
  id: row.id,
  patientNumber: row.patient_number,
  fullName: row.full_name,
  phone: row.phone,
  altPhone: row.alt_phone,
  gender: (row.gender as Gender) ?? "unknown",
  birthYear: row.birth_year,
  address: row.address,
  medicalAlert: row.medical_alert,
  note: row.note,
  createdAt: row.created_at.toISOString(),
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
export async function searchPatients(term: string, limit = 8): Promise<PatientSummary[]> {
  await ensureSchema();
  const trimmed = term.trim();
  if (!trimmed) return [];
  // الرقم يُبحث عنه بصيغتيه: من كتب `770…` يجب أن يجد سجلًا مخزّنًا `967770…`.
  const forms = phoneLookupForms(trimmed);
  const { rows } = await getPool().query<PatientRow>(
    `SELECT id, patient_number, full_name, phone, medical_alert FROM patients
      WHERE full_name ILIKE $1
         OR phone ILIKE $1 OR alt_phone ILIKE $1
         OR phone = ANY($3::text[]) OR alt_phone = ANY($3::text[])
         OR patient_number ILIKE $1
      ORDER BY full_name LIMIT $2`,
    [`%${trimmed}%`, limit, forms],
  );
  return rows.map((row) => ({
    id: row.id,
    patientNumber: row.patient_number,
    fullName: row.full_name,
    phone: row.phone,
    medicalAlert: row.medical_alert,
  }));
}

/** صفحة من كل المرضى — للتصفّح حين لا يعرف الباحث ما يكتب. */
export async function listPatients(offset: number, limit: number): Promise<{
  rows: PatientSummary[]; total: number;
}> {
  await ensureSchema();
  const pool = getPool();
  const [{ rows }, { rows: counted }] = await Promise.all([
    pool.query<PatientRow>(
      `SELECT id, patient_number, full_name, phone, medical_alert FROM patients
        ORDER BY created_at DESC, id DESC OFFSET $1 LIMIT $2`,
      [offset, limit],
    ),
    pool.query<{ c: string }>(`SELECT count(*)::int AS c FROM patients`),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      patientNumber: row.patient_number,
      fullName: row.full_name,
      phone: row.phone,
      medicalAlert: row.medical_alert,
    })),
    total: Number(counted[0].c),
  };
}

/**
 * ينشئ مريضًا برقم متسلسل.
 *
 * الرقم يُولَّد داخل الاستعلام من أكبر رقم موجود، لا من عدّ السجلات: العدّ يعيد استخدام
 * رقم مريض محذوف فيصير لمريضين الرقم نفسه في سجلات مطبوعة قديمة.
 */
/**
 * مرشّحو التكرار لمريض على وشك الإنشاء.
 *
 * الاستعلام واسعٌ عمدًا ثم يُصفّى في الذاكرة: القاعدة تُرجّح بالهاتف وبأول كلمة من
 * الاسم، والمنطق العربي (الهمزات، التاء المربوطة، «عبد الله») يُطبَّق في
 * `lib/duplicates` حيث يُختبر. ولو صُفّي في SQL وحده لاحتاج امتدادات وفهارس نصّية
 * لا يستحقّها حجم عيادة، ولصار المنطق غير قابل للاختبار بلا قاعدة.
 */
export async function duplicateCandidates(input: {
  fullName: string; phone: string | null; altPhone: string | null;
}): Promise<CandidatePatient[]> {
  await ensureSchema();
  const phones = [
    ...phoneLookupForms(input.phone),
    ...phoneLookupForms(input.altPhone),
  ];
  /*
   * **كل** كلمات الاسم لا أولاها.
   *
   * الأولى وحدها كانت تفوّت أشيع حالتين: «عبدالله محمد» ملتصقةً لا تطابق «عبد الله
   * محمد» مفصولةً، والاسم المختصر يبدأ بكلمة أخرى. والبحث بكل الكلمات يجد السجل من
   * أي كلمة مشتركة، ثم يفصل المنطقُ العربي في `lib/duplicates` أهو نفس الشخص.
   */
  const words = input.fullName.trim().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const patterns = words.map((word) => `%${word}%`);

  const { rows } = await getPool().query<{
    id: number; patient_number: string; full_name: string;
    phone: string | null; alt_phone: string | null; birth_year: number | null;
  }>(
    `SELECT id, patient_number, full_name, phone, alt_phone, birth_year
       FROM patients
      WHERE ($1::text[] <> '{}' AND (phone = ANY($1::text[]) OR alt_phone = ANY($1::text[])))
         OR ($2::text[] <> '{}' AND full_name ILIKE ANY($2::text[]))
      ORDER BY id DESC
      LIMIT 60`,
    [phones, patterns],
  );
  return rows.map((row) => ({
    id: row.id,
    patientNumber: row.patient_number,
    fullName: row.full_name,
    phone: row.phone,
    altPhone: row.alt_phone,
    birthYear: row.birth_year,
  }));
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  await ensureSchema();
  const { rows } = await getPool().query<PatientRow>(
    `INSERT INTO patients (patient_number, full_name, phone, alt_phone, gender, birth_year, address, medical_alert, note)
     VALUES (
       'P-' || LPAD(nextval('patient_number_seq')::text, 5, '0'),
       $1, $2::text, $3::text, $4, $5::int, $6::text, $7::text, $8::text)
     RETURNING ${PATIENT_COLUMNS}`,
    [
      input.fullName,
      normalizePatientPhone(input.phone),
      normalizePatientPhone(input.altPhone),
      input.gender,
      input.birthYear,
      input.address,
      input.medicalAlert,
      input.note,
    ],
  );
  return toPatient(rows[0]);
}

/** مريض بعينه — لشاشة التعديل ولكشف الحساب. */
export async function getPatient(id: number): Promise<Patient | null> {
  await ensureSchema();
  const { rows } = await getPool().query<PatientRow>(
    `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id],
  );
  return rows[0] ? toPatient(rows[0]) : null;
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
  patient_confirmed_at: Date | null;
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
    appointmentType: row.appointment_type,
    note: row.note,
    status: row.status as AppointmentStatus,
    reminderSentAt: row.reminder_sent_at ? row.reminder_sent_at.toISOString() : null,
    patientConfirmedAt: row.patient_confirmed_at ? row.patient_confirmed_at.toISOString() : null,
  };
}

const APPOINTMENT_SELECT = `
  SELECT a.id, a.patient_id, p.full_name, p.phone, a.scheduled_date, a.scheduled_time,
         a.duration_minutes, a.appointment_type, a.note, a.status, a.reminder_sent_at,
         a.patient_confirmed_at
    FROM appointments a JOIN patients p ON p.id = a.patient_id`;

export async function listAppointmentsByDate(date: string): Promise<Appointment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<AppointmentRow>(
    `${APPOINTMENT_SELECT} WHERE a.scheduled_date = $1 ORDER BY a.scheduled_time`,
    [date],
  );
  return rows.map(toAppointment);
}

/**
 * أرقام التشغيل لغرفة القيادة.
 *
 * وكلُّها تُعدّ في القاعدة بجملةٍ واحدة لا بجرّ الصفوف ثم عدّها في التطبيق: الفترة
 * قد تكون سنةً كاملة، وجرُّ زياراتِ سنةٍ لعدّها يكبر مع كل يوم عمل.
 *
 * والتنبيهات الثلاثة — التقويم والمخزون والمختبر — تُقرأ من **الدوالّ نفسها** التي
 * تُغذّي عدّادات القشرة، فلا تقول اللوحة رقمًا ويقول الشريطُ آخر.
 */
export async function executiveOperational(input: {
  from: string; to: string; today: string; adjustWeeks: number; retentionWeeks: number;
}): Promise<import("./executive").ExecutiveOperational> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    arrived: string; done: string; still_open: string; no_show: string; new_patients: string;
    ortho_active: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM visits
         WHERE arrived_at::date BETWEEN $1 AND $2)                              AS arrived,
       (SELECT COUNT(*) FROM visits
         WHERE arrived_at::date BETWEEN $1 AND $2 AND status = 'done')          AS done,
       (SELECT COUNT(*) FROM visits
         WHERE arrived_at::date BETWEEN $1 AND $2
           AND status NOT IN ('done', 'cancelled'))                             AS still_open,
       (SELECT COUNT(*) FROM appointments
         WHERE scheduled_date BETWEEN $1 AND $2 AND status = 'no_show')         AS no_show,
       (SELECT COUNT(*) FROM patients
         WHERE created_at::date BETWEEN $1 AND $2)                              AS new_patients,
       (SELECT COUNT(*) FROM ortho_cases WHERE status = 'active')               AS ortho_active`,
    [input.from, input.to],
  );
  const row = rows[0];

  const [ortho, inventory, lab] = await Promise.all([
    orthoCounts({ today: input.today, adjustWeeks: input.adjustWeeks, retentionWeeks: input.retentionWeeks }),
    inventoryCounts(input.today),
    labCounts(),
  ]);

  return {
    arrived: Number(row.arrived),
    done: Number(row.done),
    stillOpen: Number(row.still_open),
    noShow: Number(row.no_show),
    newPatients: Number(row.new_patients),
    orthoActive: Number(row.ortho_active),
    orthoOverdue: ortho.overdue,
    inventoryAlerts: inventory.attention,
    labLate: lab.late,
  };
}

/**
 * دقائق شغل الكراسي وأيام العمل الفعلية.
 *
 * والدقائق من **جلوس المريض إلى انتهاء زيارته** لا من موعده المحجوز: الموعد نيّة،
 * والجلوس واقع. ومن حجز ولم يأتِ لا يشغل كرسيًا.
 */
export async function chairMinutes(from: string, to: string): Promise<{
  occupiedMinutes: number; activeDays: number;
}> {
  await ensureSchema();
  const { rows } = await getPool().query<{ minutes: string; days: string }>(
    `SELECT
       COALESCE(SUM(EXTRACT(EPOCH FROM (finished_at - seated_at)) / 60), 0)::int AS minutes,
       COUNT(DISTINCT arrived_at::date)                                          AS days
       FROM visits
      WHERE arrived_at::date BETWEEN $1 AND $2
        AND seated_at IS NOT NULL AND finished_at IS NOT NULL
        AND finished_at > seated_at`,
    [from, to],
  );
  return { occupiedMinutes: Number(rows[0].minutes), activeDays: Number(rows[0].days) };
}

/* ── بوابة المريض ─────────────────────────────────────────────────────────── */

export interface PatientIntake extends IntakeAnswers {
  id: number;
  patientId: number;
  submittedAt: string;
}

const toIntake = (row: Record<string, unknown>): PatientIntake => ({
  id: row.id as number,
  patientId: row.patient_id as number,
  conditions: Array.isArray(row.conditions) ? (row.conditions as string[]) : [],
  allergies: (row.allergies as string | null) ?? null,
  medications: (row.medications as string | null) ?? null,
  emergencyName: (row.emergency_name as string | null) ?? null,
  emergencyPhone: (row.emergency_phone as string | null) ?? null,
  note: (row.note as string | null) ?? null,
  submittedAt: (row.submitted_at as Date).toISOString(),
});

/** استمارةٌ جديدة — تُضاف ولا تُستبدل. */
export async function submitIntake(
  patientId: number, answers: IntakeAnswers,
): Promise<PatientIntake> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO patient_intake
       (patient_id, conditions, allergies, medications, emergency_name, emergency_phone, note)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
     RETURNING id, patient_id, conditions, allergies, medications,
               emergency_name, emergency_phone, note, submitted_at`,
    [
      patientId, JSON.stringify(answers.conditions), answers.allergies, answers.medications,
      answers.emergencyName, answers.emergencyPhone, answers.note,
    ],
  );
  return toIntake(rows[0]);
}

/** آخر استمارةٍ أرسلها المريض — وهي التي تُقرأ على الكرسي. */
export async function latestIntake(patientId: number): Promise<PatientIntake | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, patient_id, conditions, allergies, medications,
            emergency_name, emergency_phone, note, submitted_at
       FROM patient_intake WHERE patient_id = $1
      ORDER BY submitted_at DESC, id DESC LIMIT 1`,
    [patientId],
  );
  return rows[0] ? toIntake(rows[0]) : null;
}

/** كل ما أرسله — والفرق بين استمارتين هو متى تغيّرت صحّته. */
export async function intakeHistory(patientId: number, limit = 12): Promise<PatientIntake[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, patient_id, conditions, allergies, medications,
            emergency_name, emergency_phone, note, submitted_at
       FROM patient_intake WHERE patient_id = $1
      ORDER BY submitted_at DESC, id DESC LIMIT $2`,
    [patientId, Math.min(50, Math.max(1, limit))],
  );
  return rows.map(toIntake);
}



/**
 * الملف المطابق لرقمه — للدخول إلى البوابة.
 *
 * ويُعاد الملف ولو لم يطابق هاتفه: **المطابقة تقع في `portalCredentialsMatch`**
 * وحدها، فلا يُقسَّم قرار الهوية بين استعلامٍ ودالّة. واستعلامٌ يطابق الهاتف بنفسه
 * كان سيقارنه نصًّا، فيمنع صاحب الملف من الدخول برقمه هو مكتوبًا بصيغةٍ أخرى.
 */
export async function patientForPortal(patientNumber: string): Promise<{
  id: number; patientNumber: string; fullName: string;
  phone: string | null; altPhone: string | null;
} | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, patient_number, full_name, phone, alt_phone
       FROM patients WHERE upper(btrim(patient_number)) = upper(btrim($1)) LIMIT 1`,
    [patientNumber],
  );
  const row = rows[0];
  return row ? {
    id: row.id as number,
    patientNumber: row.patient_number as string,
    fullName: row.full_name as string,
    phone: (row.phone as string | null) ?? null,
    altPhone: (row.alt_phone as string | null) ?? null,
  } : null;
}

/**
 * مواعيد المريض للبوابة — القادمة أوّلًا ثم القريبة الماضية.
 *
 * والماضية تُعرض لأن أوّل ما يسأل عنه المريض «متى كانت زيارتي؟» — لكنها محدودة
 * بشهرين: بوابةٌ تعرض تاريخه كلّه تصير سجلًّا طبّيًا يُقرأ على هاتفٍ مفقود.
 */
export async function portalAppointments(patientId: number): Promise<Appointment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<AppointmentRow>(
    `${APPOINTMENT_SELECT}
      WHERE a.patient_id = $1 AND a.scheduled_date >= CURRENT_DATE - INTERVAL '60 days'
      ORDER BY a.scheduled_date, a.scheduled_time`,
    [patientId],
  );
  return rows.map(toAppointment);
}

/**
 * تأكيد المريض حضوره.
 *
 * ويُقفل صفّ الموعد ويُعاد فحصُه داخل المعاملة: الاستقبال قد تُلغيه أو تنقله بينما
 * البوابة مفتوحة على شاشة المريض — فيؤكّد موعدًا لم يعد قائمًا، ويأتي فلا يجد له
 * مكانًا. **وشاشةٌ حمّلت الحالة قبل دقيقة ليست حارسًا.**
 *
 * ويُشترط أن يكون الموعد **لهذا المريض**: رقمُ موعدٍ عددٌ متسلسل، ومن يبدّله في
 * الطلب يؤكّد موعد غيره لولا هذا الشرط.
 */
export async function confirmAppointmentByPatient(input: {
  appointmentId: number; patientId: number; today: string;
}): Promise<{ ok: true; confirmedAt: string } | { ok: false; reason: string; message: string }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      status: string; scheduled_date: Date; patient_id: number; patient_confirmed_at: Date | null;
    }>(
      `SELECT status, scheduled_date, patient_id, patient_confirmed_at
         FROM appointments WHERE id = $1 FOR UPDATE`,
      [input.appointmentId],
    );
    const row = rows[0];
    if (!row || row.patient_id !== input.patientId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found", message: "لم نجد هذا الموعد في ملفّك." };
    }
    if (row.patient_confirmed_at) {
      await client.query("ROLLBACK");
      return {
        ok: false, reason: "already",
        message: "الموعد مؤكَّد سلفًا — لا حاجة لتأكيده مرّة أخرى.",
      };
    }
    const date = row.scheduled_date;
    const scheduledDate =
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const verdict = confirmVerdict({ status: row.status, scheduledDate }, input.today);
    if (!verdict.ok) {
      await client.query("ROLLBACK");
      return { ok: false, reason: verdict.reason, message: CONFIRM_REFUSAL[verdict.reason] };
    }
    const { rows: saved } = await client.query<{ at: Date }>(
      `UPDATE appointments SET patient_confirmed_at = NOW() WHERE id = $1 RETURNING patient_confirmed_at AS at`,
      [input.appointmentId],
    );
    await client.query("COMMIT");
    return { ok: true, confirmedAt: saved[0].at.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
  return occupyChair(id, chair, "called");
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
           'P-' || LPAD(nextval('patient_number_seq')::text, 5, '0'),
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
  patient: Patient;
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
  const { rows: patients } = await pool.query<PatientRow>(
    `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id],
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
    patient: toPatient(patients[0]),
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
export async function updatePatient(
  id: number,
  input: Partial<PatientInput>,
): Promise<Patient | null> {
  await ensureSchema();
  // التحديث الجزئي بعلَم لكل حقل: `COALESCE` وحده لا يفرّق بين «لم يُرسَل» و«أُرسل
  // فارغًا عمدًا»، فمسحُ رقم بديل خاطئ كان مستحيلًا — يبقى إلى الأبد.
  const has = (key: keyof PatientInput) => input[key] !== undefined;
  const { rows } = await getPool().query<PatientRow>(
    `UPDATE patients SET
       full_name     = COALESCE($2::text, full_name),
       phone         = CASE WHEN $3::boolean  THEN $4::text  ELSE phone         END,
       alt_phone     = CASE WHEN $5::boolean  THEN $6::text  ELSE alt_phone     END,
       gender        = COALESCE($7::text, gender),
       birth_year    = CASE WHEN $8::boolean  THEN $9::int   ELSE birth_year    END,
       address       = CASE WHEN $10::boolean THEN $11::text ELSE address       END,
       medical_alert = CASE WHEN $12::boolean THEN $13::text ELSE medical_alert END,
       note          = CASE WHEN $14::boolean THEN $15::text ELSE note          END
     WHERE id = $1
     RETURNING ${PATIENT_COLUMNS}`,
    [
      id,
      input.fullName ?? null,
      has("phone"), has("phone") ? normalizePatientPhone(input.phone) : null,
      has("altPhone"), has("altPhone") ? normalizePatientPhone(input.altPhone) : null,
      input.gender ?? null,
      has("birthYear"), has("birthYear") ? input.birthYear : null,
      has("address"), has("address") ? input.address : null,
      has("medicalAlert"), has("medicalAlert") ? input.medicalAlert : null,
      has("note"), has("note") ? input.note : null,
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
  doctor_party_id: number | null;
  doctor_name: string | null;
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
    doctorId: (row.doctor_party_id as number | null) ?? null,
    doctorName: (row.doctor_name as string | null) ?? null,
  };
}

const LAB_SELECT = `
  SELECT l.id, l.patient_id, p.full_name, p.phone, l.lab_name, l.lab_phone, l.work_type,
         l.details, l.sent_date, l.due_date, l.status, l.received_at, l.delivered_at, l.note,
         l.doctor_party_id, doc.name AS doctor_name
    FROM lab_orders l
    JOIN patients p ON p.id = l.patient_id
    LEFT JOIN parties doc ON doc.id = l.doctor_party_id`;

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

/**
 * ينشئ أمر مختبر، ويسجّل تكلفته التزامًا على العيادة في نفس المعاملة.
 *
 * التكلفة والالتزام معًا أو لا شيء: أمرٌ سُجّل وتكلفته ضاعت يعني عملًا يُنتظر بلا
 * أثر مالي، ثم يأتي المختبر بحسابه آخر الشهر فلا يُقابَل بشيء يُراجَع.
 */
export async function createLabOrder(input: {
  patientId: number;
  labName: string;
  labPhone: string | null;
  workType: string;
  details: string | null;
  sentDate: string;
  dueDate: string;
  note: string | null;
  partyId: number | null;
  /** العمل من الكتالوج متى اختير — فتُوحَّد التسمية ويصحّ تجميع التقارير. */
  serviceId: number | null;
  /** الطبيب الذي أمر بالعمل — تُخصم تكلفته من عمولته. */
  doctorPartyId: number | null;
  costMinor: number | null;
  costCurrency: Currency | null;
  baseCurrency: Currency;
  exchangeRate: number;
  createdBy: string;
}): Promise<LabOrder | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO lab_orders (patient_id, lab_name, lab_phone, work_type, details, sent_date,
                               due_date, note, party_id, cost_minor, cost_currency,
                               doctor_party_id, service_id)
       VALUES ($1, $2, $3::text, $4, $5::text, $6::date, $7::date, $8::text, $9::int, $10::bigint,
               $11::text, $12::int, $13::int)
       RETURNING id`,
      [
        input.patientId, input.labName, input.labPhone, input.workType,
        input.details, input.sentDate, input.dueDate, input.note,
        input.partyId, input.costMinor, input.costCurrency, input.doctorPartyId,
        input.serviceId,
      ],
    );
    const orderId = rows[0].id;

    if (input.partyId && input.costMinor && input.costCurrency) {
      const baseAmount = toBaseAmount(
        input.costMinor, input.costCurrency, input.baseCurrency, input.exchangeRate,
      );
      await client.query(
        `INSERT INTO payables (party_id, category, description, amount_minor, currency,
                               exchange_rate, base_amount_minor, base_currency, lab_order_id, due_date, created_by)
         VALUES ($1, 'lab', $2, $3, $4, $5, $6, $7, $8, $9::date, $10)
         ON CONFLICT (lab_order_id) WHERE lab_order_id IS NOT NULL DO NOTHING`,
        [
          input.partyId,
          `${input.workType}${input.details ? ` — ${input.details}` : ""}`,
          input.costMinor, input.costCurrency, input.exchangeRate, baseAmount,
          input.baseCurrency, orderId, input.dueDate, input.createdBy,
        ],
      );
    }

    await client.query("COMMIT");
    const { rows: full } = await getPool().query<LabOrderRow>(`${LAB_SELECT} WHERE l.id = $1`, [orderId]);
    return full[0] ? toLabOrder(full[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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

/**
 * أرقام المختبر معدودة في Postgres لا في الذاكرة.
 *
 * اللوحة تسأل عنها كل عشرين ثانية. جلبُ الصفوف كلها ثم عدّها في الخادم يعمل اليوم
 * وثلاثون صفًّا في الجدول، ويصير حِملًا بلا سبب بعد سنة — والعدّ هنا لا يحتاج صفًّا
 * واحدًا في الذاكرة. «اليوم» بتوقيت العيادة لا بـUTC، وإلا حُسب عمل يستحق غدًا متأخرًا.
 */
export async function labCounts(): Promise<{
  outstanding: number; late: number; dueToday: number; waitingFitting: number;
}> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    outstanding: string; late: string; due_today: string; waiting_fitting: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'sent')::int AS outstanding,
       count(*) FILTER (WHERE status = 'sent' AND due_date < (NOW() AT TIME ZONE $1)::date)::int AS late,
       count(*) FILTER (WHERE status = 'sent' AND due_date = (NOW() AT TIME ZONE $1)::date)::int AS due_today,
       count(*) FILTER (WHERE status = 'received')::int AS waiting_fitting
     FROM lab_orders`,
    [CLINIC_TIME_ZONE],
  );
  return {
    outstanding: Number(rows[0].outstanding),
    late: Number(rows[0].late),
    dueToday: Number(rows[0].due_today),
    waitingFitting: Number(rows[0].waiting_fitting),
  };
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

// ─── الإعدادات ───────────────────────────────────────────────────────────────

import {
  ALL_SETTING_KEYS,
  SETTING_DEFAULTS,
  rateFromSettings,
  settingIsYes,
  withDefaults,
  type SettingKey,
  type SettingsMap,
} from "./settings";

/**
 * ذاكرة قصيرة للإعدادات.
 *
 * الإعدادات تُقرأ في كل طلب تقريبًا — كل صفحة تحتاج اسم المركز، وكل حساب يحتاج عدد
 * الكراسي أو سعر الصرف — وقراءتها من القاعدة في كل مرة استعلامٌ زائد على كل نقرة.
 * وخمس ثوانٍ من التقادم مقبولة هنا: أسوأ ما يحدث أن يرى من غيّر السعر قيمته القديمة
 * لثوانٍ. والحفظ يُبطل الذاكرة فورًا فلا ينتظر حتى ذلك.
 */
const SETTINGS_TTL_MS = 5_000;
let settingsCache: { value: SettingsMap; at: number } | null = null;

export function invalidateSettingsCache(): void {
  settingsCache = null;
}

export async function getSettings(): Promise<SettingsMap> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;

  await ensureSchema();
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM settings`,
  );
  const stored: Record<string, string> = {};
  for (const row of rows) stored[row.key] = row.value;
  const value = withDefaults(stored);
  settingsCache = { value, at: now };
  return value;
}

/**
 * الإعدادات بلا انهيار.
 *
 * تُستدعى من التخطيط الجذري الذي يُصيّر **كل** صفحة، بما فيها صفحة تسجيل الدخول.
 * ولو رمت عند انقطاع القاعدة لصارت شاشة بيضاء في كل مسار بلا رسالة — بينما البرنامج
 * يستطيع أن يعمل بالافتراضيات حتى تعود القاعدة.
 */
export async function getSettingsSafe(): Promise<SettingsMap> {
  try {
    return await getSettings();
  } catch {
    return withDefaults({});
  }
}

/**
 * يحفظ المفاتيح المُرسَلة وحدها.
 *
 * `ON CONFLICT` بدل حذف وإدراج: الحفظ الجزئي من شاشة مفتوحة على قسم واحد يجب ألا
 * يمسح أقسامًا أخرى. والمفاتيح المجهولة تُرفض قبل الوصول إلى هنا.
 */
export async function saveSettings(values: Partial<Record<SettingKey, string>>): Promise<SettingsMap> {
  await ensureSchema();
  const entries = ALL_SETTING_KEYS
    .filter((key) => values[key] !== undefined)
    .map((key) => [key, String(values[key] ?? SETTING_DEFAULTS[key]).trim()] as const);

  if (entries.length > 0) {
    await getPool().query(
      `INSERT INTO settings (key, value)
       SELECT key, value FROM UNNEST($1::text[], $2::text[]) AS t(key, value)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [entries.map(([key]) => key), entries.map(([, value]) => value)],
    );
  }
  invalidateSettingsCache();
  return getSettings();
}

// ─── المالية ─────────────────────────────────────────────────────────────────

import {
  MINOR_UNITS,
  isCurrency,
  toBaseAmount,
  type Currency,
  type PaymentLike,
} from "./money";

export interface Service {
  id: number;
  name: string;
  category: string | null;
  priceMinor: number;
  priceConfigured: boolean;
  catalogCode: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface ServiceRow {
  id: number; name: string; category: string | null;
  price_minor: string; is_active: boolean; sort_order: number; price_configured: boolean; catalog_code: string | null;
}

// `BIGINT` يصل من pg نصًّا لا رقمًا — وهو الصحيح لأنه قد يتجاوز حدّ العدد الآمن.
// مبالغ العيادة أصغر من ذلك بكثير، فالتحويل آمن، لكن نسيانَه يعطي «"12500" + 1»
// = «"125001"» — وهو نوع الخطأ الذي لا يُكتشف إلا في رصيد مريض.
const toMinor = (value: string | number | null): number => Number(value ?? 0);

const toService = (row: ServiceRow): Service => ({
  id: row.id,
  name: row.name,
  category: row.category,
  priceMinor: toMinor(row.price_minor),
  priceConfigured: row.price_configured,
  catalogCode: row.catalog_code,
  isActive: row.is_active,
  sortOrder: row.sort_order,
});

export async function listServices(includeInactive = false): Promise<Service[]> {
  await ensureSchema();
  const { rows } = await getPool().query<ServiceRow>(
    `SELECT id, name, category, price_minor, is_active, sort_order, price_configured, catalog_code FROM services
      ${includeInactive ? "" : "WHERE is_active"}
      ORDER BY sort_order, name`,
  );
  return rows.map(toService);
}

/** خدمةٌ واحدة من الدليل — لأن سعرًا يأتي من المتصفّح سعرٌ يمكن تغييره في المتصفّح. */
export async function getService(id: number): Promise<Service | null> {
  await ensureSchema();
  const { rows } = await getPool().query<ServiceRow>(
    `SELECT id, name, category, price_minor, is_active, sort_order, price_configured, catalog_code FROM services WHERE id = $1`,
    [id],
  );
  return rows[0] ? toService(rows[0]) : null;
}

export async function createService(input: {
  name: string; category: string | null; priceMinor: number;
}): Promise<Service> {
  await ensureSchema();
  const { rows } = await getPool().query<ServiceRow>(
    `INSERT INTO services (name, category, price_minor)
     VALUES ($1, $2::text, $3) RETURNING id, name, category, price_minor, is_active, sort_order, price_configured, catalog_code`,
    [input.name, input.category, input.priceMinor],
  );
  return toService(rows[0]);
}

export async function updateService(id: number, input: {
  name?: string; category?: string | null; priceMinor?: number; isActive?: boolean;
}): Promise<Service | null> {
  await ensureSchema();
  const { rows } = await getPool().query<ServiceRow>(
    `UPDATE services SET
       name        = COALESCE($2::text, name),
       category    = CASE WHEN $3::boolean THEN $4::text ELSE category END,
       price_minor = COALESCE($5::bigint, price_minor),
       price_configured = CASE WHEN $5::bigint IS NOT NULL THEN TRUE ELSE price_configured END,
       is_active   = COALESCE($6::boolean, is_active)
     WHERE id = $1
     RETURNING id, name, category, price_minor, is_active, sort_order, price_configured, catalog_code`,
    [
      id, input.name ?? null,
      input.category !== undefined, input.category ?? null,
      input.priceMinor ?? null, input.isActive ?? null,
    ],
  );
  return rows[0] ? toService(rows[0]) : null;
}

// ── الورديات ────────────────────────────────────────────────────────────────

export interface CashierShift {
  id: number;
  openedBy: string;
  openedAt: string;
  opening: Record<Currency, number>;
  closedBy: string | null;
  closedAt: string | null;
  counted: Record<Currency, number> | null;
  note: string | null;
  status: "open" | "closed";
}

interface ShiftRow {
  id: number; opened_by: string; opened_at: Date;
  opening_yer: string; opening_sar: string; opening_usd: string;
  closed_by: string | null; closed_at: Date | null;
  counted_yer: string | null; counted_sar: string | null; counted_usd: string | null;
  note: string | null; status: string;
}

const toShift = (row: ShiftRow): CashierShift => ({
  id: row.id,
  openedBy: row.opened_by,
  openedAt: row.opened_at.toISOString(),
  opening: { YER: toMinor(row.opening_yer), SAR: toMinor(row.opening_sar), USD: toMinor(row.opening_usd) },
  closedBy: row.closed_by,
  closedAt: row.closed_at ? row.closed_at.toISOString() : null,
  counted: row.counted_yer === null ? null : {
    YER: toMinor(row.counted_yer), SAR: toMinor(row.counted_sar), USD: toMinor(row.counted_usd),
  },
  note: row.note,
  status: row.status === "closed" ? "closed" : "open",
});

export async function getOpenShift(): Promise<CashierShift | null> {
  await ensureSchema();
  const { rows } = await getPool().query<ShiftRow>(
    `SELECT * FROM cashier_shifts WHERE status = 'open' LIMIT 1`,
  );
  return rows[0] ? toShift(rows[0]) : null;
}

/**
 * يفتح وردية، ويرفض إن كانت هناك واحدة مفتوحة.
 *
 * الشرط `WHERE NOT EXISTS` داخل `INSERT` نفسه لا في الكود: ضغطتان على «افتح الوردية»
 * من جهازين في اللحظة نفسها كانتا ستفتحان ورديتين، فتتوزّع دفعات اليوم بينهما ولا
 * يُطابَق أيّهما. والفهرس الفريد على الحالة يمنعها حتى لو فشل هذا الشرط.
 */
export async function openShift(input: {
  openedBy: string; opening: Record<Currency, number>;
}): Promise<CashierShift | null> {
  await ensureSchema();
  const { rows } = await getPool().query<ShiftRow>(
    `INSERT INTO cashier_shifts (opened_by, opening_yer, opening_sar, opening_usd)
     SELECT $1, $2, $3, $4
      WHERE NOT EXISTS (SELECT 1 FROM cashier_shifts WHERE status = 'open')
     RETURNING *`,
    [input.openedBy, input.opening.YER, input.opening.SAR, input.opening.USD],
  );
  return rows[0] ? toShift(rows[0]) : null;
}

export async function closeShift(input: {
  id: number; closedBy: string; counted: Record<Currency, number>; note: string | null;
}): Promise<CashierShift | null> {
  await ensureSchema();
  const { rows } = await getPool().query<ShiftRow>(
    `UPDATE cashier_shifts SET
       status = 'closed', closed_by = $2, closed_at = NOW(),
       counted_yer = $3, counted_sar = $4, counted_usd = $5, note = $6::text
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [input.id, input.closedBy, input.counted.YER, input.counted.SAR, input.counted.USD, input.note],
  );
  return rows[0] ? toShift(rows[0]) : null;
}

export async function listShifts(limit = 30): Promise<CashierShift[]> {
  await ensureSchema();
  const { rows } = await getPool().query<ShiftRow>(
    `SELECT * FROM cashier_shifts ORDER BY opened_at DESC LIMIT $1`, [limit],
  );
  return rows.map(toShift);
}

// ── الفواتير والدفعات ───────────────────────────────────────────────────────

export interface InvoiceItem {
  id: number;
  serviceId: number | null;
  doctorId: number | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  patientId: number;
  patientName: string;
  status: "open" | "paid" | "cancelled";
  totalMinor: number;
  discountMinor: number;
  baseCurrency: Currency;
  note: string | null;
  createdAt: string;
  items: InvoiceItem[];
}

export interface Payment {
  id: number;
  receiptNumber: string;
  patientId: number;
  patientName: string;
  invoiceId: number | null;
  shiftId: number;
  kind: "payment" | "refund";
  amountMinor: number;
  currency: Currency;
  exchangeRate: number;
  baseAmountMinor: number;
  baseCurrency: Currency;
  method: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface InvoiceRow {
  id: number; invoice_number: string; patient_id: number; full_name: string;
  status: string; total_minor: string; discount_minor: string; base_currency: string;
  note: string | null; created_at: Date;
}

interface PaymentRow {
  id: number; receipt_number: string; patient_id: number; full_name: string;
  invoice_id: number | null; shift_id: number; kind: string;
  amount_minor: string; currency: string; exchange_rate: string;
  base_amount_minor: string; base_currency: string; method: string;
  note: string | null; created_by: string | null; created_at: Date;
}

const toInvoice = (row: InvoiceRow, items: InvoiceItem[]): Invoice => ({
  id: row.id,
  invoiceNumber: row.invoice_number,
  patientId: row.patient_id,
  patientName: row.full_name,
  status: row.status as Invoice["status"],
  totalMinor: toMinor(row.total_minor),
  discountMinor: toMinor(row.discount_minor),
  baseCurrency: row.base_currency as Currency,
  note: row.note,
  createdAt: row.created_at.toISOString(),
  items,
});

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  receiptNumber: row.receipt_number,
  patientId: row.patient_id,
  patientName: row.full_name,
  invoiceId: row.invoice_id,
  shiftId: row.shift_id,
  kind: row.kind === "refund" ? "refund" : "payment",
  amountMinor: toMinor(row.amount_minor),
  currency: row.currency as Currency,
  exchangeRate: Number(row.exchange_rate),
  baseAmountMinor: toMinor(row.base_amount_minor),
  baseCurrency: row.base_currency as Currency,
  method: row.method,
  note: row.note,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.patient_id, p.full_name, i.status, i.total_minor,
         i.discount_minor, i.base_currency, i.note, i.created_at
    FROM invoices i JOIN patients p ON p.id = i.patient_id`;

const PAYMENT_SELECT = `
  SELECT y.id, y.receipt_number, y.patient_id, p.full_name, y.invoice_id, y.shift_id, y.kind,
         y.amount_minor, y.currency, y.exchange_rate, y.base_amount_minor, y.base_currency,
         y.method, y.note, y.created_by, y.created_at
    FROM payments y JOIN patients p ON p.id = y.patient_id`;

async function itemsFor(invoiceIds: number[]): Promise<Map<number, InvoiceItem[]>> {
  const map = new Map<number, InvoiceItem[]>();
  if (invoiceIds.length === 0) return map;
  const { rows } = await getPool().query<{
    id: number; invoice_id: number; service_id: number | null; doctor_id: number | null;
    description: string; quantity: number; unit_price_minor: string; total_minor: string;
  }>(
    `SELECT id, invoice_id, service_id, doctor_id, description, quantity, unit_price_minor, total_minor
       FROM invoice_items WHERE invoice_id = ANY($1::int[]) ORDER BY id`,
    [invoiceIds],
  );
  for (const row of rows) {
    const list = map.get(row.invoice_id) ?? [];
    list.push({
      id: row.id,
      serviceId: row.service_id,
      doctorId: row.doctor_id,
      description: row.description,
      quantity: row.quantity,
      unitPriceMinor: toMinor(row.unit_price_minor),
      totalMinor: toMinor(row.total_minor),
    });
    map.set(row.invoice_id, list);
  }
  return map;
}

/**
 * ينشئ فاتورة ببنودها في معاملة واحدة، ويحسب الإجمالي على الخادم.
 *
 * الإجمالي **لا يُقرأ من الطلب** مهما أرسله المتصفّح: قيمة الفاتورة هي مجموع بنودها،
 * وقبولُ رقم من الواجهة يعني أن أي أحد يستطيع إنشاء فاتورة بمليون وبنودٍ بألف.
 */
export async function createInvoice(input: {
  patientId: number;
  baseCurrency: Currency;
  discountMinor: number;
  note: string | null;
  createdBy: string;
  items: {
    serviceId: number | null; doctorId: number | null;
    description: string; quantity: number; unitPriceMinor: number;
  }[];
}): Promise<Invoice | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const total = input.items.reduce(
      (sum, item) => sum + Math.max(0, item.quantity) * Math.max(0, item.unitPriceMinor), 0,
    );
    const discount = Math.min(Math.max(0, input.discountMinor), total);

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO invoices (invoice_number, patient_id, total_minor, discount_minor, base_currency, note, created_by)
       VALUES (
         'INV-' || LPAD(nextval('invoice_number_seq')::text, 5, '0'),
         $1, $2, $3, $4, $5::text, $6)
       RETURNING id`,
      [input.patientId, total, discount, input.baseCurrency, input.note, input.createdBy],
    );
    const invoiceId = rows[0].id;

    for (const item of input.items) {
      const quantity = Math.max(1, Math.round(item.quantity));
      const unit = Math.max(0, Math.round(item.unitPriceMinor));
      await client.query(
        `INSERT INTO invoice_items (invoice_id, service_id, doctor_id, description, quantity, unit_price_minor, total_minor)
         VALUES ($1, $2::int, $3::int, $4, $5, $6, $7)`,
        [invoiceId, item.serviceId, item.doctorId, item.description, quantity, unit, quantity * unit],
      );
    }
    await client.query("COMMIT");
    return getInvoice(invoiceId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getInvoice(id: number): Promise<Invoice | null> {
  await ensureSchema();
  const { rows } = await getPool().query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1`, [id]);
  if (!rows[0]) return null;
  const items = await itemsFor([id]);
  return toInvoice(rows[0], items.get(id) ?? []);
}

export async function listPatientInvoices(patientId: number): Promise<Invoice[]> {
  await ensureSchema();
  const { rows } = await getPool().query<InvoiceRow>(
    `${INVOICE_SELECT} WHERE i.patient_id = $1 ORDER BY i.created_at DESC`, [patientId],
  );
  const items = await itemsFor(rows.map((row) => row.id));
  return rows.map((row) => toInvoice(row, items.get(row.id) ?? []));
}

export async function setInvoiceStatus(
  id: number, status: "open" | "paid" | "cancelled",
): Promise<Invoice | null> {
  await ensureSchema();
  // الفاتورة الملغاة لا تعود: إلغاءٌ ثم فتحٌ يعيد مبلغًا أُسقط من رصيد المريض بعد
  // أن رآه مسدّدًا. التصحيح يكون بفاتورة جديدة لا بإحياء ملغاة.
  const { rowCount } = await getPool().query(
    `UPDATE invoices SET status = $2 WHERE id = $1 AND status <> 'cancelled'`, [id, status],
  );
  return (rowCount ?? 0) > 0 ? getInvoice(id) : null;
}

export async function listPatientPayments(patientId: number): Promise<Payment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<PaymentRow>(
    `${PAYMENT_SELECT} WHERE y.patient_id = $1 ORDER BY y.created_at DESC`, [patientId],
  );
  return rows.map(toPayment);
}

export async function getPayment(id: number): Promise<Payment | null> {
  await ensureSchema();
  const { rows } = await getPool().query<PaymentRow>(`${PAYMENT_SELECT} WHERE y.id = $1`, [id]);
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function listShiftPayments(shiftId: number): Promise<Payment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<PaymentRow>(
    `${PAYMENT_SELECT} WHERE y.shift_id = $1 ORDER BY y.created_at DESC`, [shiftId],
  );
  return rows.map(toPayment);
}

export async function listPaymentsByDate(date: string): Promise<Payment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<PaymentRow>(
    `${PAYMENT_SELECT}
      WHERE (y.created_at AT TIME ZONE $1)::date = $2::date
      ORDER BY y.created_at DESC`,
    [CLINIC_TIME_ZONE, date],
  );
  return rows.map(toPayment);
}

/**
 * يسجّل دفعة أو استردادًا داخل الوردية المفتوحة.
 *
 * ثلاثة أشياء مقصودة:
 *
 * ١) **الوردية شرطٌ داخل الاستعلام** لا فحصٌ قبله: بين الفحص والإدراج ثانيةٌ قد
 *    تُغلق فيها الوردية من جهاز آخر، فتُسجَّل الدفعة في وردية مقفلة ولا تظهر في
 *    جردها ولا في جرد التالية — مالٌ دخل ولا يظهر في أي إغلاق.
 *
 * ٢) **سعر الصرف يُنسخ في الصف** ولا يُقرأ من الإعدادات بعدها. هذا ما يجعل رصيد
 *    المريض ثابتًا حين يتغيّر السعر غدًا.
 *
 * ٣) **المكافئ الأساسي يُحسب على الخادم** من المبلغ والسعر: قبولُه من الواجهة يعني
 *    دفعة بدولار واحد تُسجَّل بمليون ريال.
 */
export async function recordPayment(input: {
  patientId: number;
  invoiceId: number | null;
  kind: "payment" | "refund";
  amountMinor: number;
  currency: Currency;
  baseCurrency: Currency;
  exchangeRate: number;
  method: string;
  note: string | null;
  createdBy: string;
}): Promise<{ payment: Payment | null; reason: "no_shift" | "invalid_invoice" | null }> {
  await ensureSchema();
  const baseAmount = toBaseAmount(
    input.amountMinor, input.currency, input.baseCurrency, input.exchangeRate,
  );

  const client = await getPool().connect();
  let released = false;
  try {
    await client.query("BEGIN");
    const { rows: shifts } = await client.query<{ id: number }>(
      "SELECT id FROM cashier_shifts WHERE status = 'open' LIMIT 1 FOR UPDATE",
    );
    if (!shifts[0]) { await client.query("ROLLBACK"); return { payment: null, reason: "no_shift" }; }
    let linkedPlanId: number | null = null;
    if (input.invoiceId !== null) {
      const { rows: invoices } = await client.query(
        "SELECT patient_id, status, base_currency, plan_id FROM invoices WHERE id = $1 FOR UPDATE", [input.invoiceId],
      );
      const invoice = invoices[0];
      linkedPlanId = invoice?.plan_id ?? null;
      if (!invoice || invoice.patient_id !== input.patientId || invoice.status === 'cancelled'
          || invoice.base_currency !== input.baseCurrency) {
        await client.query("ROLLBACK"); return { payment: null, reason: "invalid_invoice" };
      }
    }
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO payments (
       receipt_number, patient_id, invoice_id, shift_id, kind, amount_minor, currency,
       exchange_rate, base_amount_minor, base_currency, method, note, created_by, plan_id)
     SELECT
       'R-' || LPAD(nextval('receipt_number_seq')::text, 5, '0'),
       $1, $2::int, s.id, $3, $4, $5, $6, $7, $8, $9, $10::text, $11, $12::int
       FROM cashier_shifts s
      WHERE s.status = 'open'
      LIMIT 1
     RETURNING id`,
    [
      input.patientId, input.invoiceId, input.kind, input.amountMinor, input.currency,
      input.exchangeRate, baseAmount, input.baseCurrency, input.method, input.note, input.createdBy, linkedPlanId,
    ],
  );

  if(input.invoiceId!==null) {
    await client.query(`UPDATE invoices SET status=CASE WHEN total_minor-discount_minor <=
      (SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -base_amount_minor ELSE base_amount_minor END),0) FROM payments WHERE invoice_id=$1)
      THEN 'paid' ELSE 'open' END WHERE id=$1 AND status<>'cancelled'`,[input.invoiceId]);
  }
  await client.query("COMMIT");
  const id = rows[0]?.id;
  client.release();
  released = true;
  return { payment: id ? await getPayment(id) : null, reason: id ? null : "no_shift" };
  } catch (error) {
    if (!released) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { if (!released) client.release(); }
}

/** رصيد المريض: الفواتير والدفعات معًا، لأن الرقم لا يُقرأ من أحدهما وحده. */
export async function patientLedger(patientId: number): Promise<{
  invoices: Invoice[]; payments: Payment[]; opening: OpeningBalance | null;
}> {
  const [invoices, payments, opening] = await Promise.all([
    listPatientInvoices(patientId),
    listPatientPayments(patientId),
    getPatientOpeningBalance(patientId),
  ]);
  return { invoices, payments, opening };
}

/** يحوّل صفوف الدفعات إلى الشكل الذي تفهمه حسابات `lib/money`. */
export function asPaymentLikes(payments: Payment[]): PaymentLike[] {
  return payments.map((payment) => ({
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    exchangeRate: payment.exchangeRate,
    baseAmountMinor: payment.baseAmountMinor,
    kind: payment.kind,
  }));
}

/** الوحدات الصغرى — تُصدَّر لتستعملها المسارات في التحقق. */
export { MINOR_UNITS };

// ─── الجهات والمصروفات ───────────────────────────────────────────────────────

import type { ExpenseCategory, PartyKind } from "./expenses";

export interface Party {
  id: number;
  name: string;
  kind: PartyKind;
  phone: string | null;
  note: string | null;
  commissionPercent: number;
  isActive: boolean;
}

interface PartyRow {
  id: number; name: string; kind: string; phone: string | null;
  note: string | null; commission_percent: string; is_active: boolean;
}

const toParty = (row: PartyRow): Party => ({
  id: row.id,
  name: row.name,
  kind: row.kind as PartyKind,
  phone: row.phone,
  note: row.note,
  commissionPercent: Number(row.commission_percent),
  isActive: row.is_active,
});

export async function listParties(kind?: PartyKind): Promise<Party[]> {
  await ensureSchema();
  const { rows } = await getPool().query<PartyRow>(
    `SELECT id, name, kind, phone, note, commission_percent, is_active FROM parties
      WHERE ($1::text IS NULL OR kind = $1::text)
      ORDER BY is_active DESC, name`,
    [kind ?? null],
  );
  return rows.map(toParty);
}

export async function createParty(input: {
  name: string; kind: PartyKind; phone: string | null;
  commissionPercent: number; note: string | null;
}): Promise<Party> {
  await ensureSchema();
  const { rows } = await getPool().query<PartyRow>(
    `INSERT INTO parties (name, kind, phone, commission_percent, note)
     VALUES ($1, $2, $3::text, $4, $5::text)
     RETURNING id, name, kind, phone, note, commission_percent, is_active`,
    [input.name, input.kind, input.phone, input.commissionPercent, input.note],
  );
  return toParty(rows[0]);
}

export async function updateParty(id: number, input: {
  name?: string; phone?: string | null; commissionPercent?: number;
  note?: string | null; isActive?: boolean;
}): Promise<Party | null> {
  await ensureSchema();
  const { rows } = await getPool().query<PartyRow>(
    `UPDATE parties SET
       name               = COALESCE($2::text, name),
       phone              = CASE WHEN $3::boolean THEN $4::text ELSE phone END,
       commission_percent = COALESCE($5::numeric, commission_percent),
       note               = CASE WHEN $6::boolean THEN $7::text ELSE note END,
       is_active          = COALESCE($8::boolean, is_active)
     WHERE id = $1
     RETURNING id, name, kind, phone, note, commission_percent, is_active`,
    [
      id, input.name ?? null,
      input.phone !== undefined, input.phone ?? null,
      input.commissionPercent ?? null,
      input.note !== undefined, input.note ?? null,
      input.isActive ?? null,
    ],
  );
  return rows[0] ? toParty(rows[0]) : null;
}

export interface Expense {
  id: number;
  voucherNumber: string;
  category: ExpenseCategory;
  partyId: number | null;
  partyName: string | null;
  payeeText: string | null;
  shiftId: number;
  amountMinor: number;
  currency: Currency;
  exchangeRate: number;
  baseAmountMinor: number;
  baseCurrency: Currency;
  payableId: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface ExpenseRow {
  id: number; voucher_number: string; category: string; party_id: number | null;
  party_name: string | null; payee_text: string | null; shift_id: number;
  amount_minor: string; currency: string; exchange_rate: string;
  base_amount_minor: string; base_currency: string; payable_id: number | null;
  note: string | null; created_by: string | null; created_at: Date;
}

const toExpense = (row: ExpenseRow): Expense => ({
  id: row.id,
  voucherNumber: row.voucher_number,
  category: row.category as ExpenseCategory,
  partyId: row.party_id,
  partyName: row.party_name,
  payeeText: row.payee_text,
  shiftId: row.shift_id,
  amountMinor: toMinor(row.amount_minor),
  currency: row.currency as Currency,
  exchangeRate: Number(row.exchange_rate),
  baseAmountMinor: toMinor(row.base_amount_minor),
  baseCurrency: row.base_currency as Currency,
  payableId: row.payable_id,
  note: row.note,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const EXPENSE_SELECT = `
  SELECT e.id, e.voucher_number, e.category, e.party_id, t.name AS party_name, e.payee_text,
         e.shift_id, e.amount_minor, e.currency, e.exchange_rate, e.base_amount_minor,
         e.base_currency, e.payable_id, e.note, e.created_by, e.created_at
    FROM expenses e LEFT JOIN parties t ON t.id = e.party_id`;

export async function getExpense(id: number): Promise<Expense | null> {
  await ensureSchema();
  const { rows } = await getPool().query<ExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = $1`, [id]);
  return rows[0] ? toExpense(rows[0]) : null;
}

export async function listShiftExpenses(shiftId: number): Promise<Expense[]> {
  await ensureSchema();
  const { rows } = await getPool().query<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE e.shift_id = $1 ORDER BY e.created_at DESC`, [shiftId],
  );
  return rows.map(toExpense);
}

export async function listExpensesBetween(from: string, to: string): Promise<Expense[]> {
  await ensureSchema();
  const { rows } = await getPool().query<ExpenseRow>(
    `${EXPENSE_SELECT}
      WHERE (e.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
      ORDER BY e.created_at DESC LIMIT 1000`,
    [CLINIC_TIME_ZONE, from, to],
  );
  return rows.map(toExpense);
}

export async function listPartyExpenses(partyId: number): Promise<Expense[]> {
  await ensureSchema();
  const { rows } = await getPool().query<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE e.party_id = $1 ORDER BY e.created_at DESC LIMIT 200`, [partyId],
  );
  return rows.map(toExpense);
}

/**
 * يسجّل سند صرف داخل الوردية المفتوحة.
 *
 * نفس حراسة القبض: الوردية شرطٌ داخل الاستعلام لا فحصٌ قبله. والمال الخارج أخطر من
 * الداخل — مبلغٌ يخرج بلا سند ولا وردية لا يظهر في أي جرد، وهو بالضبط كيف تضيع
 * أموال العيادات.
 */
export async function recordExpense(input: {
  category: ExpenseCategory;
  partyId: number | null;
  payeeText: string | null;
  amountMinor: number;
  currency: Currency;
  baseCurrency: Currency;
  exchangeRate: number;
  payableId: number | null;
  note: string | null;
  createdBy: string;
}): Promise<{ expense: Expense | null; reason: "no_shift" | null }> {
  await ensureSchema();
  const baseAmount = toBaseAmount(
    input.amountMinor, input.currency, input.baseCurrency, input.exchangeRate,
  );

  const client = await getPool().connect();
  let released = false;
  try {
    await client.query("BEGIN");
    const { rows: shifts } = await client.query<{ id: number }>(
      "SELECT id FROM cashier_shifts WHERE status = 'open' LIMIT 1 FOR UPDATE",
    );
    if (!shifts[0]) { await client.query("ROLLBACK"); return { expense: null, reason: "no_shift" }; }
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO expenses (
       voucher_number, category, party_id, payee_text, shift_id, amount_minor, currency,
       exchange_rate, base_amount_minor, base_currency, payable_id, note, created_by)
     SELECT
       'V-' || LPAD(nextval('voucher_number_seq')::text, 5, '0'),
       $1, $2::int, $3::text, s.id, $4, $5, $6, $7, $8, $9::int, $10::text, $11
       FROM cashier_shifts s
      WHERE s.status = 'open'
      LIMIT 1
     RETURNING id`,
    [
      input.category, input.partyId, input.payeeText, input.amountMinor, input.currency,
      input.exchangeRate, baseAmount, input.baseCurrency, input.payableId, input.note, input.createdBy,
    ],
  );

  await client.query("COMMIT");
  const id = rows[0]?.id;
  client.release();
  released = true;
  return { expense: id ? await getExpense(id) : null, reason: id ? null : "no_shift" };
  } catch (error) {
    if (!released) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { if (!released) client.release(); }
}

// ─── تقرير العمولات ──────────────────────────────────────────────────────────

import { commissionForPatient, summarizeCommissions, type CommissionInvoice } from "./commission";
import { invoiceNet } from "./money";

export interface CommissionRow {
  doctorId: number;
  doctorName: string;
  commissionPercent: number;
  accruedMinor: number;
  /** المكتسب قبل الخصم. */
  earnedMinor: number;
  /** تكلفة أعمال المختبر التي أمر بها في المدّة — كاملةً، بالعملة الأساسية. */
  labCostMinor: number;
  /** حصّته منها بنسبته — وهي المخصومة. */
  labShareMinor: number;
  /** المكتسب بعد الخصم — وهو المستحق. */
  netEarnedMinor: number;
  /** ما فاض من التكلفة عن عمولته، فلم يُخصم ولم يُرحَّل. */
  uncoveredLabCostMinor: number;
  paidMinor: number;
  dueMinor: number;
}

/** حصيلةُ العمولات ومعها ما لا يُنسب إلى طبيب. */
export interface CommissionReport {
  rows: CommissionRow[];
  /** أمفعَّلٌ الخصم؟ — الشاشة تقول للقارئ على أيّ قاعدةٍ حُسب ما يراه. */
  deductsLabCost: boolean;
  /**
   * تكلفةُ مختبرٍ في المدّة بلا طبيبٍ مكتوب عليها.
   *
   * ولا تُوزَّع على الأطباء بالتساوي ولا بالنسبة: توزيعٌ بلا سجلّ يخصم من
   * طبيبٍ مالًا لم يثبت أنّه عمله. فتُعرض رقمًا ظاهرًا ليُنسبها المالك.
   */
  unattributedLabCostMinor: number;
}

/**
 * عمولات الأطباء عن مدى تاريخي.
 *
 * التوزيع يجري على **كل** فواتير المريض ودفعاته — لا على المدى وحده — ثم تُحسب
 * فواتير المدى. لو قُصر التوزيع على المدى لبدت دفعةٌ قديمة كأنها تغطّي فاتورة الشهر
 * الحالي، فتُصرف عمولة مرتين على مالٍ واحد.
 */
export async function commissionReport(from: string, to: string): Promise<CommissionReport> {
  await ensureSchema();
  const pool = getPool();

  const [{ rows: doctorRows }, { rows: invoiceRows }, { rows: paidRows }] = await Promise.all([
    pool.query<{ id: number; name: string; commission_percent: string }>(
      `SELECT id, name, commission_percent FROM parties WHERE kind = 'doctor'`,
    ),
    pool.query<{
      patient_id: number; invoice_id: number; net_minor: string; created_at: Date;
      clinic_date: Date; doctor_id: number | null; share_minor: string;
    }>(
      `SELECT i.patient_id,
              i.id AS invoice_id,
              GREATEST(0, i.total_minor - i.discount_minor) AS net_minor,
              i.created_at,
              (i.created_at AT TIME ZONE $1)::date AS clinic_date,
              it.doctor_id,
              COALESCE(SUM(it.total_minor), 0) AS share_minor
         FROM invoices i
         LEFT JOIN invoice_items it ON it.invoice_id = i.id
        WHERE i.status <> 'cancelled'
          AND i.patient_id IN (
                SELECT patient_id FROM invoices
                 WHERE status <> 'cancelled'
                   AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
              )
        GROUP BY i.patient_id, i.id, i.total_minor, i.discount_minor, i.created_at, clinic_date, it.doctor_id`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{ party_id: number; paid: string }>(
      `SELECT party_id, COALESCE(SUM(base_amount_minor), 0) AS paid
         FROM expenses
        WHERE category = 'commission' AND party_id IS NOT NULL
          AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
        GROUP BY party_id`,
      [CLINIC_TIME_ZONE, from, to],
    ),
  ]);

  const percentByDoctor = new Map(doctorRows.map((row) => [row.id, Number(row.commission_percent)]));
  const nameByDoctor = new Map(doctorRows.map((row) => [row.id, row.name]));

  // تجميع الفواتير لكل مريض مع حصص الأطباء فيها.
  const byPatient = new Map<number, Map<number, CommissionInvoice>>();
  const clinicDateOfInvoice = new Map<number, string>();
  for (const row of invoiceRows) {
    clinicDateOfInvoice.set(row.invoice_id, dateText(row.clinic_date));
    const patientInvoices = byPatient.get(row.patient_id) ?? new Map<number, CommissionInvoice>();
    const invoice = patientInvoices.get(row.invoice_id) ?? {
      id: row.invoice_id,
      netMinor: toMinor(row.net_minor),
      createdAt: row.created_at.toISOString(),
      doctorShares: [],
    };
    if (row.doctor_id) {
      invoice.doctorShares.push({ doctorId: row.doctor_id, amountMinor: toMinor(row.share_minor) });
    }
    patientInvoices.set(row.invoice_id, invoice);
    byPatient.set(row.patient_id, patientInvoices);
  }

  const patientIds = [...byPatient.keys()];
  const collectedByPatient = new Map<number, number>();
  if (patientIds.length > 0) {
    const { rows } = await pool.query<{ patient_id: number; collected: string }>(
      `SELECT patient_id,
              COALESCE(SUM(CASE WHEN kind = 'refund' THEN -base_amount_minor ELSE base_amount_minor END), 0) AS collected
         FROM payments WHERE patient_id = ANY($1::int[]) GROUP BY patient_id`,
      [patientIds],
    );
    for (const row of rows) collectedByPatient.set(row.patient_id, toMinor(row.collected));
  }

  // التحصيل يُغطّي الأقدم أولًا، والرصيد الافتتاحي أقدم من كل فاتورة في هذا النظام.
  // فما دخل منه على دَينٍ سابق **لا عمولة عليه**: عمله تمّ قبل النظام وعمولته صُرفت
  // في حينها، وصرفها ثانية دفعٌ مرتين عن عمل واحد.
  const openingByPatient = await openingBalanceAmounts(patientIds);
  for (const [patientId, collected] of collectedByPatient) {
    const opening = openingByPatient.get(patientId) ?? 0;
    if (opening > 0) collectedByPatient.set(patientId, Math.max(0, collected - opening));
  }

  // فواتير المدى تُنتقى **بيوم العيادة** لا بيوم التوقيت العالمي.
  //
  // كان الانتقاء بمقارنة الطابع الزمني بـ`YYYY-MM-DDT00:00Z`، واليمن UTC+3: فحالةٌ
  // سُجّلت الواحدة ليلًا يومها العيادي هو اليوم نفسه لكن طابعها العالمي في اليوم
  // السابق، فتسقط من عمولة الطبيب بلا أثر — والفرق بين استعلام SQL يصفّي بيوم
  // العيادة وفلترٍ في الذاكرة يصفّي بيوم UTC هو بالضبط ما يجعل الخلل صامتًا.
  const inRange = (invoiceId: number): boolean => {
    const day = clinicDateOfInvoice.get(invoiceId);
    return day !== undefined && day >= from && day <= to;
  };
  const perPatient = patientIds.map((patientId) =>
    commissionForPatient(
      [...(byPatient.get(patientId) ?? new Map()).values()],
      collectedByPatient.get(patientId) ?? 0,
      percentByDoctor,
      (invoice) => inRange(invoice.id),
    ),
  );

  const paidByDoctor = new Map(paidRows.map((row) => [row.party_id, toMinor(row.paid)]));

  /*
   * تكلفة المختبر بالعملة الأساسية — من `payables` لا من `lab_orders`.
   *
   * فالتكلفة تُكتب على الأمر بعملتها، و`payables` تحمل مقابلها بالأساسية
   * **بسعر يوم الأمر**. وضربُها بسعر اليوم يجعل عمولة شهرٍ مضى تتغيّر كلّما
   * تحرّك الصرف — وقد صُرفت.
   *
   * والمُلغى لا يُخصم: عملٌ أُلغي لا تكلفة له.
   */
  const labCostRows = await pool.query<{ doctor_id: number | null; cost: string }>(
    `SELECT lo.doctor_party_id AS doctor_id,
            COALESCE(SUM(pay.base_amount_minor), 0) AS cost
       FROM lab_orders lo
       JOIN payables pay ON pay.lab_order_id = lo.id
      WHERE lo.status <> 'cancelled'
        AND lo.sent_date >= $1::date AND lo.sent_date <= $2::date
      GROUP BY lo.doctor_party_id`,
    [from, to],
  );
  const labCostByDoctor = new Map<number, number>();
  let unattributedLabCostMinor = 0;
  for (const row of labCostRows.rows) {
    if (row.doctor_id === null) unattributedLabCostMinor += toMinor(row.cost);
    else labCostByDoctor.set(row.doctor_id, toMinor(row.cost));
  }

  const settings = await getSettingsSafe();
  const deductsLabCost = settingIsYes(settings, "finance.commission_deducts_lab_cost");

  const rows = summarizeCommissions(
    perPatient, paidByDoctor, labCostByDoctor, percentByDoctor, deductsLabCost,
  )
    .map((row) => ({
      doctorId: row.doctorId,
      doctorName: nameByDoctor.get(row.doctorId) ?? "—",
      commissionPercent: percentByDoctor.get(row.doctorId) ?? 0,
      accruedMinor: row.accruedMinor,
      earnedMinor: row.earnedMinor,
      labCostMinor: row.labCostMinor,
      labShareMinor: row.labShareMinor,
      netEarnedMinor: row.netEarnedMinor,
      uncoveredLabCostMinor: row.uncoveredLabCostMinor,
      paidMinor: row.paidMinor,
      dueMinor: row.dueMinor,
    }));

  return { rows, deductsLabCost, unattributedLabCostMinor };
}

/** يُبقي `invoiceNet` مستعملًا في هذا الملف — يُستخدم في تقرير المديونية أدناه. */
export const netOfInvoice = invoiceNet;

// ─── تقارير مالية ────────────────────────────────────────────────────────────

export interface DebtRow {
  patientId: number;
  patientName: string;
  phone: string | null;
  billedMinor: number;
  /** ما كان عليه قبل تشغيل النظام — دَينٌ حقيقي وإن لم تكن له فاتورة هنا. */
  openingMinor: number;
  collectedMinor: number;
  dueMinor: number;
  /** أقدم فاتورة غير مغطّاة — عليها يقوم عمر الدين. */
  oldestUnpaidDate: string | null;
  ageDays: number;
}

/**
 * مديونية المرضى.
 *
 * الرقم الذي يعرف به صاحب العيادة كم من ماله عند الناس. ومعه **عمر الدين**: مئة ألف
 * عمرها أسبوع شيء، ومئة ألف عمرها سنة شيء آخر تمامًا — الأولى تُحصَّل بمكالمة،
 * والثانية غالبًا لن تعود. وبلا العمر تبدو المديونية رقمًا واحدًا لا يُتصرَّف فيه.
 *
 * **والمجموعُ وتفصيلُه من لقطةٍ واحدة.** فالمبلغ يُقرأ في استعلامٍ مجمَّع، والعمرُ
 * من ثلاثة استعلاماتٍ بعده. وكلُّ استعلامٍ على اتّصالٍ من المجمَّع يرى لقطةً
 * مستقلّة، فدفعةٌ تُقيَّد بينها تترك المبلغ موجبًا من اللقطة الأولى بينما يرى حسابُ
 * العمر الدفعةَ فيقول «لا دَين» — فيقع الصفّ في خانةٍ ليست له: مبلغٌ بلا تاريخ، أو
 * تاريخٌ لا يوافق مبلغه. فالأربعة على اتّصالٍ واحد داخل معاملة `REPEATABLE READ`
 * للقراءة وحدها: ما تراه أوّلُها تراه آخرُها.
 *
 * و`source` اتّصالٌ مخصَّص لا مجمَّع اتّصالات، **ومن مرّره فتح لقطته وأغلقها بنفسه**:
 * الدالّة لا تبدأ معاملةً على اتّصالٍ لا تملكه ولا تُنهيها. ولو فعلت لكان
 * `ROLLBACK` في نهايتها يُلغي معاملةَ من استدعاها — يقرأ التقرير في جملة عملٍ
 * أطول، فيضيع ما كتبه قبله بلا رسالةٍ ولا أثر. **والدالّة تدير ما تفتحه هي وحده.**
 */
export async function patientDebtReport(minDueMinor = 1, source?: PoolClient): Promise<DebtRow[]> {
  if (source) return debtRowsInSnapshot(source, minDueMinor);
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return await debtRowsInSnapshot(client, minDueMinor);
  } finally {
    // لقطةُ قراءةٍ لا أثر لها — تُغلق بالتراجع، ويعود الاتّصال إلى المجمَّع.
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/** يقرأ التقرير كلَّه على اتّصالٍ واحد — لا استعلام خارجه، فاللقطة واحدة. */
async function debtRowsInSnapshot(client: PoolClient, minDueMinor: number): Promise<DebtRow[]> {
  const { rows } = await client.query<{
    patient_id: number; full_name: string; phone: string | null;
    billed: string; opening: string; collected: string; oldest: Date | null;
  }>(
    `WITH billed AS (
       SELECT patient_id,
              COALESCE(SUM(GREATEST(0, total_minor - discount_minor)), 0) AS amount,
              MIN(created_at) AS oldest
         FROM invoices WHERE status <> 'cancelled' GROUP BY patient_id
     ), collected AS (
       SELECT patient_id,
              COALESCE(SUM(CASE WHEN kind = 'refund' THEN -base_amount_minor ELSE base_amount_minor END), 0) AS amount
         FROM payments GROUP BY patient_id
     )
     SELECT p.id AS patient_id, p.full_name, p.phone,
            COALESCE(b.amount, 0) AS billed,
            COALESCE(o.amount_minor, 0) AS opening,
            COALESCE(c.amount, 0) AS collected,
            -- أقدم فاتورةٍ للمريض — لا عمرُ دينه. والعمر يُحسب بالأقدم-أوّلًا
            -- بعد هذا الاستعلام، فالسداد يُغطّي أقدم ما عليه ولا يُتجاهل.
            LEAST(b.oldest, o.as_of_date::timestamptz) AS oldest
       FROM patients p
       LEFT JOIN billed b ON b.patient_id = p.id
       LEFT JOIN collected c ON c.patient_id = p.id
       LEFT JOIN patient_opening_balances o ON o.patient_id = p.id
      WHERE COALESCE(b.amount, 0) + COALESCE(o.amount_minor, 0) - COALESCE(c.amount, 0) >= $1
      ORDER BY (COALESCE(b.amount, 0) + COALESCE(o.amount_minor, 0) - COALESCE(c.amount, 0)) DESC
      LIMIT 500`,
    [minDueMinor],
  );

  if (rows.length === 0) return [];

  /*
   * عمر الدين **بالأقدم-أوّلًا**، لا من أقدم فاتورة.
   *
   * وكان يُحسب من `MIN(created_at)` بلا نظرٍ إلى ما دفع المريض. فمن عالجناه
   * قبل سنةٍ وسدّد، ثم جاء الأسبوع الماضي لفاتورةٍ جديدة، يظهر «منذ ٤٠٠ يومًا»
   * ويُصنَّف دَينًا ميتًا — فيُطارَد بمكالماتٍ يستحقّها غيره، أو يُشطب دينُه وهو
   * حاضرٌ يدفع. والشاشة كلُّها بُنيت على أنّ العمر يُقرَّر به.
   *
   * والتواريخ **بيوم العيادة**: اليمن على ‎+٣‎، وفاتورةُ العاشرة مساءً يومُها
   * العيادي هو يومها لا اليوم التالي بتوقيت غرينتش.
   */
  const patientIds = rows.map((row) => row.patient_id);
  // اتّصالٌ واحد لا يحمل استعلامين معًا، فتتوالى الثلاثة داخل اللقطة نفسها.
  const { rows: invoiceRows } = await client.query<{ patient_id: number; day: string; amount: string }>(
    `SELECT patient_id,
            (created_at AT TIME ZONE $2)::date::text AS day,
            GREATEST(0, total_minor - discount_minor) AS amount
       FROM invoices
      WHERE status <> 'cancelled' AND patient_id = ANY($1::int[])`,
    [patientIds, CLINIC_TIME_ZONE],
  );
  const { rows: paymentRows } = await client.query<{ patient_id: number; day: string; amount: string; kind: string }>(
    `SELECT patient_id,
            (created_at AT TIME ZONE $2)::date::text AS day,
            base_amount_minor AS amount, kind
       FROM payments WHERE patient_id = ANY($1::int[])`,
    [patientIds, CLINIC_TIME_ZONE],
  );
  const { rows: openingRows } = await client.query<{ patient_id: number; day: string; amount: string }>(
    `SELECT patient_id, as_of_date::text AS day, amount_minor AS amount
       FROM patient_opening_balances WHERE patient_id = ANY($1::int[])`,
    [patientIds],
  );

  const histories = new Map<number, DebtHistory>();
  const historyOf = (id: number): DebtHistory => {
    let found = histories.get(id);
    if (!found) { found = { opening: null, invoices: [], payments: [] }; histories.set(id, found); }
    return found;
  };
  for (const row of invoiceRows) {
    historyOf(row.patient_id).invoices.push({ date: row.day, minor: toMinor(row.amount) });
  }
  for (const row of paymentRows) {
    historyOf(row.patient_id).payments.push({
      date: row.day, minor: toMinor(row.amount), isRefund: row.kind === "refund",
    });
  }
  for (const row of openingRows) {
    historyOf(row.patient_id).opening = { date: row.day, minor: toMinor(row.amount) };
  }

  const today = clinicDateString(new Date(), CLINIC_TIME_ZONE);
  return rows.map((row) => {
    const age = debtAge(historyOf(row.patient_id), today);
    return {
      patientId: row.patient_id,
      patientName: row.full_name,
      phone: row.phone,
      billedMinor: toMinor(row.billed),
      openingMinor: toMinor(row.opening),
      collectedMinor: toMinor(row.collected),
      dueMinor: toMinor(row.billed) + toMinor(row.opening) - toMinor(row.collected),
      oldestUnpaidDate: age.since,
      ageDays: age.ageDays,
    };
  });
}

export interface FinanceSummary {
  from: string;
  to: string;
  income: { byCurrency: Record<Currency, number>; baseTotalMinor: number; count: number };
  refunds: { baseTotalMinor: number; count: number };
  expenses: { byCategory: Record<string, number>; baseTotalMinor: number; count: number };
  netMinor: number;
  invoicedMinor: number;
  invoiceCount: number;
  patientCount: number;
  topServices: { name: string; count: number; totalMinor: number }[];
}

/**
 * ملخص مالي لمدى تاريخي — يخدم التقرير اليومي والشهري معًا.
 *
 * الفرق بينهما تاريخان لا منطقان، وبناء تقريرين منفصلين كان يعني رقمين مختلفين
 * لنفس اليوم حين يختلف الحسابان بسطر.
 */
export async function financeSummary(from: string, to: string): Promise<FinanceSummary> {
  await ensureSchema();
  const pool = getPool();

  const [payments, expenses, invoices, services] = await Promise.all([
    pool.query<{ currency: string; kind: string; amount: string; base: string; count: string }>(
      `SELECT currency, kind,
              COALESCE(SUM(amount_minor), 0) AS amount,
              COALESCE(SUM(base_amount_minor), 0) AS base,
              COUNT(*)::int AS count
         FROM payments
        WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
        GROUP BY currency, kind`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{ category: string; base: string; count: string }>(
      `SELECT category, COALESCE(SUM(base_amount_minor), 0) AS base, COUNT(*)::int AS count
         FROM expenses
        WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
        GROUP BY category`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{ invoiced: string; count: string; patients: string }>(
      `SELECT COALESCE(SUM(GREATEST(0, total_minor - discount_minor)), 0) AS invoiced,
              COUNT(*)::int AS count,
              COUNT(DISTINCT patient_id)::int AS patients
         FROM invoices
        WHERE status <> 'cancelled'
          AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{ description: string; count: string; total: string }>(
      `SELECT it.description, COUNT(*)::int AS count, COALESCE(SUM(it.total_minor), 0) AS total
         FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
        WHERE i.status <> 'cancelled'
          AND (i.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
        GROUP BY it.description
        ORDER BY total DESC
        LIMIT 10`,
      [CLINIC_TIME_ZONE, from, to],
    ),
  ]);

  const byCurrency: Record<Currency, number> = { YER: 0, SAR: 0, USD: 0 };
  let incomeBase = 0;
  let incomeCount = 0;
  let refundBase = 0;
  let refundCount = 0;
  for (const row of payments.rows) {
    const currency = row.currency as Currency;
    const sign = row.kind === "refund" ? -1 : 1;
    byCurrency[currency] += sign * toMinor(row.amount);
    if (row.kind === "refund") {
      refundBase += toMinor(row.base);
      refundCount += Number(row.count);
    } else {
      incomeBase += toMinor(row.base);
      incomeCount += Number(row.count);
    }
  }

  const byCategory: Record<string, number> = {};
  let expenseBase = 0;
  let expenseCount = 0;
  for (const row of expenses.rows) {
    byCategory[row.category] = toMinor(row.base);
    expenseBase += toMinor(row.base);
    expenseCount += Number(row.count);
  }

  const invoiceRow = invoices.rows[0];

  return {
    from,
    to,
    income: { byCurrency, baseTotalMinor: incomeBase, count: incomeCount },
    refunds: { baseTotalMinor: refundBase, count: refundCount },
    expenses: { byCategory, baseTotalMinor: expenseBase, count: expenseCount },
    // الصافي = المقبوض − المسترد − المصروف. هذا ما بقي في الصندوق فعلًا، لا
    // «الدخل» الذي يظنّه من يقرأ المقبوض وحده.
    netMinor: incomeBase - refundBase - expenseBase,
    invoicedMinor: toMinor(invoiceRow?.invoiced ?? 0),
    invoiceCount: Number(invoiceRow?.count ?? 0),
    patientCount: Number(invoiceRow?.patients ?? 0),
    topServices: services.rows.map((row) => ({
      name: row.description,
      count: Number(row.count),
      totalMinor: toMinor(row.total),
    })),
  };
}

// ─── الالتزامات وحسابات الجهات ───────────────────────────────────────────────

export interface Payable {
  id: number;
  partyId: number;
  partyName: string;
  category: string;
  description: string;
  amountMinor: number;
  currency: Currency;
  exchangeRate: number;
  baseAmountMinor: number;
  labOrderId: number | null;
  dueDate: string | null;
  createdAt: string;
}

interface PayableRow {
  id: number; party_id: number; party_name: string; category: string; description: string;
  amount_minor: string; currency: string; exchange_rate: string; base_amount_minor: string;
  lab_order_id: number | null; due_date: Date | null; created_at: Date;
}

const toPayable = (row: PayableRow): Payable => ({
  id: row.id,
  partyId: row.party_id,
  partyName: row.party_name,
  category: row.category,
  description: row.description,
  amountMinor: toMinor(row.amount_minor),
  currency: row.currency as Currency,
  exchangeRate: Number(row.exchange_rate),
  baseAmountMinor: toMinor(row.base_amount_minor),
  labOrderId: row.lab_order_id,
  dueDate: row.due_date ? dateText(row.due_date) : null,
  createdAt: row.created_at.toISOString(),
});

const PAYABLE_SELECT = `
  SELECT b.id, b.party_id, t.name AS party_name, b.category, b.description, b.amount_minor,
         b.currency, b.exchange_rate, b.base_amount_minor, b.lab_order_id, b.due_date, b.created_at
    FROM payables b JOIN parties t ON t.id = b.party_id`;

export async function createPayable(input: {
  partyId: number;
  category: string;
  description: string;
  amountMinor: number;
  currency: Currency;
  baseCurrency: Currency;
  exchangeRate: number;
  labOrderId: number | null;
  dueDate: string | null;
  createdBy: string;
}): Promise<Payable | null> {
  await ensureSchema();
  const baseAmount = toBaseAmount(
    input.amountMinor, input.currency, input.baseCurrency, input.exchangeRate,
  );
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO payables (party_id, category, description, amount_minor, currency,
                           exchange_rate, base_amount_minor, base_currency, lab_order_id, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::int, $10::date, $11)
     ON CONFLICT (lab_order_id) WHERE lab_order_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      input.partyId, input.category, input.description, input.amountMinor, input.currency,
      input.exchangeRate, baseAmount, input.baseCurrency, input.labOrderId, input.dueDate, input.createdBy,
    ],
  );
  if (!rows[0]) return null;
  const { rows: full } = await getPool().query<PayableRow>(`${PAYABLE_SELECT} WHERE b.id = $1`, [rows[0].id]);
  return full[0] ? toPayable(full[0]) : null;
}

export interface PartyBalance {
  partyId: number;
  partyName: string;
  kind: string;
  owedMinor: number;
  paidMinor: number;
  dueMinor: number;
}

/**
 * ما على العيادة لكل جهة.
 *
 * الوجه الآخر لمديونية المرضى: أن تعرف كم عليك كما تعرف كم لك. عيادة تعرف مديونية
 * مرضاها ولا تعرف ما عليها للمختبرات تحسب نفسها رابحة وهي مدينة.
 *
 * والمقارنة بالعملة الأساسية: الالتزام قد يكون بالدولار والسداد بالريال، وكلاهما
 * محفوظ بسعر يومه — فالطرح بالمكافئ الأساسي هو الوحيد الذي يعطي رقمًا صحيحًا.
 */
export async function partyBalances(): Promise<PartyBalance[]> {
  await ensureSchema();
  // الأطباء مستثنون: مستحقهم لا يأتي من التزامات مسجّلة بل يُحسب من نسبتهم على
  // المحصّل، وهو حسابٌ بمدى تاريخي مكانه تقرير العمولات. إدراجهم هنا كان يُظهر
  // «دُفع زيادة» لطبيب مستحقُّه محسوب في مكان آخر — رقمٌ صحيح حسابيًا وكاذب معنى.
  const { rows } = await getPool().query<{
    id: number; name: string; kind: string; owed: string; paid: string;
  }>(
    `SELECT t.id, t.name, t.kind,
            COALESCE((SELECT SUM(base_amount_minor) FROM payables WHERE party_id = t.id), 0) AS owed,
            COALESCE((SELECT SUM(base_amount_minor) FROM expenses WHERE party_id = t.id), 0) AS paid
       FROM parties t
      WHERE t.kind <> 'doctor'
      ORDER BY t.kind, t.name`,
  );
  return rows.map((row) => ({
    partyId: row.id,
    partyName: row.name,
    kind: row.kind,
    owedMinor: toMinor(row.owed),
    paidMinor: toMinor(row.paid),
    dueMinor: toMinor(row.owed) - toMinor(row.paid),
  }));
}

/** كشف حساب جهة: التزاماتها وما دُفع لها. */
export async function partyStatement(partyId: number): Promise<{
  payables: Payable[]; expenses: Expense[];
}> {
  await ensureSchema();
  const [{ rows }, expenses] = await Promise.all([
    getPool().query<PayableRow>(
      `${PAYABLE_SELECT} WHERE b.party_id = $1 ORDER BY b.created_at DESC LIMIT 200`, [partyId],
    ),
    listPartyExpenses(partyId),
  ]);
  return { payables: rows.map(toPayable), expenses };
}

// ─── المستخدمون ──────────────────────────────────────────────────────────────

export interface StaffAccount {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export async function listUsers(): Promise<StaffAccount[]> {
  await ensureSchema();
  // كلمة المرور المجزّأة لا تخرج من هذه الدالة إطلاقًا: قائمة المستخدمين تُعرض في
  // شاشة، وما يُرسَل إلى المتصفّح يُقرأ.
  const { rows } = await getPool().query<{
    id: number; username: string; display_name: string;
    role: string; is_active: boolean; created_at: Date;
  }>(
    `SELECT id, username, display_name, role, is_active, created_at
       FROM users ORDER BY is_active DESC, created_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function updateUser(id: number, input: {
  displayName?: string; role?: string; isActive?: boolean; passwordHash?: string;
}): Promise<StaffAccount | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    id: number; username: string; display_name: string;
    role: string; is_active: boolean; created_at: Date;
  }>(
    `UPDATE users SET
       display_name  = COALESCE($2::text, display_name),
       role          = COALESCE($3::text, role),
       is_active     = COALESCE($4::boolean, is_active),
       password_hash = COALESCE($5::text, password_hash)
     WHERE id = $1
     RETURNING id, username, display_name, role, is_active, created_at`,
    [id, input.displayName ?? null, input.role ?? null, input.isActive ?? null, input.passwordHash ?? null],
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    username: rows[0].username,
    displayName: rows[0].display_name,
    role: rows[0].role,
    isActive: rows[0].is_active,
    createdAt: rows[0].created_at.toISOString(),
  };
}

/**
 * عدد المديرين الفاعلين.
 *
 * يُفحص قبل إيقاف مدير أو تغيير دوره: عيادة بلا مدير فاعل لا يستطيع أحد فيها فتح
 * الإعدادات ولا رؤية التقارير — ولا إعادة تعيين مدير، لأن ذلك نفسه يحتاج مديرًا.
 */
export async function countActiveAdmins(): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query<{ c: string }>(
    `SELECT count(*)::int AS c FROM users WHERE role = 'admin' AND is_active`,
  );
  return Number(rows[0].c);
}

// ─── الدفاتر المحاسبية ───────────────────────────────────────────────────────

import {
  effectiveRate,
  foreignCurrencies,
  isWorthPosting,
  revaluationDescription,
  revaluePosition,
  type FxPosition,
} from "./fx";
import {
  CASH_ACCOUNT,
  cashDifferenceEntry,
  expenseEntry,
  invoiceEntry,
  isBalanced,
  openingBalanceEntry,
  payableEntry,
  paymentEntry,
  revaluationEntry,
  trialBalance,
  type JournalEntry,
} from "./accounting";

/** التاريخ المحلي لطابع زمني بتوقيت العيادة — كل القيود تُؤرَّخ به. */
function clinicDayOf(iso: string): string {
  const local = new Date(new Date(iso).toLocaleString("en-US", { timeZone: CLINIC_TIME_ZONE }));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

/**
 * دفتر اليومية عن مدى تاريخي — مشتقًّا من المستندات.
 *
 * لا جدول قيود للمستندات: الفاتورة تُنتج قيدها كلما قُرئت، فلا تعارض ممكن بين
 * الدفاتر والمستندات، ولا ترحيل خلفي للبيانات القائمة، ولا قيد يتيم. وما لا يُشتقّ
 * من مستند — التسويات وإعادة التقييم — يأتي من `journal_manual` ويُدمج هنا.
 */
export async function journalEntries(from: string, to: string): Promise<JournalEntry[]> {
  await ensureSchema();
  const pool = getPool();

  const [invoices, payments, expenses, payables, shifts, manual, openings] = await Promise.all([
    pool.query<{
      invoice_number: string; created_at: Date; full_name: string;
      total_minor: string; discount_minor: string; status: string;
    }>(
      `SELECT i.invoice_number, i.created_at, p.full_name, i.total_minor, i.discount_minor, i.status
         FROM invoices i JOIN patients p ON p.id = i.patient_id
        WHERE (i.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{
      receipt_number: string; created_at: Date; full_name: string;
      currency: string; base_amount_minor: string; kind: string;
    }>(
      `SELECT y.receipt_number, y.created_at, p.full_name, y.currency, y.base_amount_minor, y.kind
         FROM payments y JOIN patients p ON p.id = y.patient_id
        WHERE (y.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{
      voucher_number: string; created_at: Date; category: string; currency: string;
      base_amount_minor: string; party_id: number | null; party_kind: string | null;
      party_name: string | null; payee_text: string | null;
    }>(
      `SELECT e.voucher_number, e.created_at, e.category, e.currency, e.base_amount_minor,
              e.party_id, t.kind AS party_kind, t.name AS party_name, e.payee_text
         FROM expenses e LEFT JOIN parties t ON t.id = e.party_id
        WHERE (e.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{
      id: number; created_at: Date; category: string; base_amount_minor: string; party_name: string;
    }>(
      `SELECT b.id, b.created_at, b.category, b.base_amount_minor, t.name AS party_name
         FROM payables b JOIN parties t ON t.id = b.party_id
        WHERE (b.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<ShiftRow>(
      `SELECT * FROM cashier_shifts
        WHERE status = 'closed'
          AND (closed_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [CLINIC_TIME_ZONE, from, to],
    ),
    pool.query<{
      id: number; entry_date: Date; description: string;
      account_code: string; amount_minor: string; side: string;
    }>(
      `SELECT m.id, m.entry_date, m.description, l.account_code, l.amount_minor, l.side
         FROM journal_manual m JOIN journal_manual_lines l ON l.entry_id = m.id
        WHERE m.entry_date BETWEEN $1::date AND $2::date
        ORDER BY m.id, l.id`,
      [from, to],
    ),
    pool.query<{ patient_id: number; full_name: string; amount_minor: string; as_of_date: Date }>(
      `SELECT o.patient_id, p.full_name, o.amount_minor, o.as_of_date
         FROM patient_opening_balances o JOIN patients p ON p.id = o.patient_id
        WHERE o.as_of_date BETWEEN $1::date AND $2::date`,
      [from, to],
    ),
  ]);

  const entries: (JournalEntry | null)[] = [];

  for (const row of invoices.rows) {
    entries.push(invoiceEntry({
      invoiceNumber: row.invoice_number,
      date: clinicDayOf(row.created_at.toISOString()),
      patientName: row.full_name,
      totalMinor: toMinor(row.total_minor),
      discountMinor: toMinor(row.discount_minor),
      cancelled: row.status === "cancelled",
    }));
  }

  for (const row of payments.rows) {
    entries.push(paymentEntry({
      receiptNumber: row.receipt_number,
      date: clinicDayOf(row.created_at.toISOString()),
      patientName: row.full_name,
      currency: row.currency as Currency,
      baseAmountMinor: toMinor(row.base_amount_minor),
      kind: row.kind === "refund" ? "refund" : "payment",
    }));
  }

  for (const row of payables.rows) {
    entries.push(payableEntry({
      reference: `PB-${row.id}`,
      date: clinicDayOf(row.created_at.toISOString()),
      partyName: row.party_name,
      category: row.category,
      baseAmountMinor: toMinor(row.base_amount_minor),
    }));
  }

  for (const row of expenses.rows) {
    entries.push(expenseEntry({
      voucherNumber: row.voucher_number,
      date: clinicDayOf(row.created_at.toISOString()),
      payeeName: row.party_name ?? row.payee_text ?? "—",
      category: row.category,
      currency: row.currency as Currency,
      baseAmountMinor: toMinor(row.base_amount_minor),
      // السداد لجهة مسجّلة (مختبر أو مورّد) يُنقص الذمم؛ وغيره مصروف مباشر.
      settlesPayable: row.party_kind === "lab" || row.party_kind === "supplier",
    }));
  }

  // فروق جرد الورديات المغلقة: المعدود ناقص (الافتتاحي + المقبوض − المصروف).
  //
  // والفرق يُعدّ **بورق العملة** ثم يُقيَّد **بالمكافئ الأساسي**: الدفاتر كلها بعملة
  // واحدة، فعجزُ عشرة دولارات ليس عشرة ريالات. وسعرُه سعرُ ما مرّ من تلك العملة في
  // الوردية نفسها — لا سعر اليوم — فالوردية أُغلقت يومها لا اليوم؛ وإن لم يمرّ منها
  // شيء (فرقٌ في افتتاحيّها) فسعر الإعدادات هو أقرب ما يُتاح.
  const settingsNow = await getSettings();
  const baseCurrency: Currency = isCurrency(settingsNow["finance.base_currency"])
    ? settingsNow["finance.base_currency"] : "YER";
  for (const row of shifts.rows) {
    const shift = toShift(row);
    if (!shift.counted || !shift.closedAt) continue;
    const [shiftPayments, shiftExpenses] = await Promise.all([
      listShiftPayments(shift.id),
      listShiftExpenses(shift.id),
    ]);
    for (const currency of ["YER", "SAR", "USD"] as Currency[]) {
      const collected = shiftPayments.reduce(
        (sum, payment) => payment.currency === currency
          ? sum + (payment.kind === "refund" ? -payment.amountMinor : payment.amountMinor)
          : sum, 0);
      const spent = shiftExpenses.reduce(
        (sum, expense) => expense.currency === currency ? sum + expense.amountMinor : sum, 0);
      const expected = shift.opening[currency] + collected - spent;
      const rate = effectiveRate(
        shiftPayments.filter((payment) => payment.currency === currency),
        currency,
        baseCurrency,
        rateFromSettings(settingsNow, currency, baseCurrency) ?? 1,
      );
      entries.push(cashDifferenceEntry({
        shiftId: shift.id,
        date: clinicDayOf(shift.closedAt),
        currency,
        differenceMinor: toBaseAmount(
          shift.counted[currency] - expected, currency, baseCurrency, rate,
        ),
      }));
    }
  }

  // الأرصدة الافتتاحية للمرضى — أصلٌ جاء مع افتتاح الدفاتر لا إيراد الفترة.
  for (const row of openings.rows) {
    entries.push(openingBalanceEntry({
      patientId: row.patient_id,
      date: dateText(row.as_of_date),
      patientName: row.full_name,
      amountMinor: toMinor(row.amount_minor),
    }));
  }

  // القيود اليدوية.
  const manualById = new Map<number, JournalEntry>();
  for (const row of manual.rows) {
    const entry = manualById.get(row.id) ?? {
      source: "manual",
      reference: `JM-${row.id}`,
      date: dateText(row.entry_date),
      description: row.description,
      lines: [],
    };
    entry.lines.push({
      accountCode: row.account_code,
      amountMinor: toMinor(row.amount_minor),
      side: row.side === "credit" ? "credit" : "debit",
    });
    manualById.set(row.id, entry);
  }
  entries.push(...manualById.values());

  // قيدٌ لا يتوازن لا يدخل الدفاتر: وجوده يُفسد ميزان المراجعة كله ويجعل تتبّع
  // الخلل مستحيلًا بعد شهور. وهو مستحيل من قواعد الترحيل، لكنه ممكن من قيد يدوي.
  return entries.filter((entry): entry is JournalEntry => entry !== null && isBalanced(entry));
}

export async function createManualEntry(input: {
  date: string;
  description: string;
  lines: { accountCode: string; amountMinor: number; side: "debit" | "credit" }[];
  createdBy: string;
}): Promise<number | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO journal_manual (entry_date, description, created_by)
       VALUES ($1::date, $2, $3) RETURNING id`,
      [input.date, input.description, input.createdBy],
    );
    for (const line of input.lines) {
      await client.query(
        `INSERT INTO journal_manual_lines (entry_id, account_code, amount_minor, side)
         VALUES ($1, $2, $3, $4)`,
        [rows[0].id, line.accountCode, line.amountMinor, line.side],
      );
    }
    await client.query("COMMIT");
    return rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * هل الفترة مقفلة عند هذا التاريخ؟
 *
 * الإقفال هو ما يجعل التقارير الشهرية قابلة للاعتماد: شهرٌ أُقفل لا يتغيّر رقمه بعد
 * أن قُرئ وصُدّق. وبلا قفل يستطيع قيدٌ يُكتب اليوم أن يغيّر ربح مارس الذي بُنيت عليه
 * قرارات — وهو ما يجعل أي محاسب يرفض النظام كله.
 */
export async function isPeriodLocked(date: string): Promise<boolean> {
  const settings = await getSettings();
  const lockedBefore = (settings["finance.locked_before"] ?? "").trim();
  if (!lockedBefore) return false;
  return date < lockedBefore;
}

// ─── النسخة الاحتياطية الكاملة ───────────────────────────────────────────────

import { insertStatement, insertionOrder, quoteIdentifier, sqlValue } from "./backup";

/**
 * يبني ملف النسخة الاحتياطية سطرًا سطرًا.
 *
 * بيانات فقط بلا مخطط: البرنامج ينشئ جداوله بنفسه عند أول تشغيل، فالاستعادة قاعدةٌ
 * فارغة يفتحها البرنامج ثم يُشغَّل عليها هذا الملف.
 *
 * وليس فيه `TRUNCATE` ولا `DROP` عمدًا. ملفٌّ يمسح قبل أن يكتب يبدو أذكى، لكنه يعني
 * أن نقرة خاطئة على قاعدة تعمل تمحو يوم عمل كامل. فالاستعادة فوق بيانات موجودة
 * **تفشل** باصطدام المفاتيح — وهو الفشل الصحيح.
 */
export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** A supplied source must be a dedicated connection, never a connection pool. */
export async function* backupSqlLines(source?: Queryable): AsyncGenerator<string> {
  if (!source) await ensureSchema();
  const owned = source ? null : await getPool().connect();
  const client: Queryable = source ?? owned!;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    yield* snapshotSqlLines(client);
    await client.query("COMMIT");
  } finally {
    // Also releases the snapshot when a client cancels its download.
    await client.query("ROLLBACK").catch(() => {});
    owned?.release();
  }
}

/** Only call within a dedicated REPEATABLE READ transaction. Also used by full backups. */
export async function* snapshotSqlLines(client: Queryable): AsyncGenerator<string> {
  const { rows: tableRows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const tables = tableRows.map(row => String(row.table_name));
  const { rows: fkRows } = await client.query(
    `SELECT child.relname AS child, parent.relname AS parent
       FROM pg_constraint c JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
       JOIN pg_namespace n ON n.oid = child.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const ordered = insertionOrder(tables.map(table => ({
    table, dependsOn: fkRows.filter(row => row.child === table).map(row => String(row.parent)),
  })));
  yield `-- Aqlan database backup v2; ${new Date().toISOString()}\nBEGIN;\n`;
  for (const table of ordered) {
    const { rows: columnRows } = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [table],
    );
    const columns = columnRows.map(row => String(row.column_name));
    const selection = columnRows.map(row => {
      const name = quoteIdentifier(String(row.column_name));
      return /timestamp|date|time/.test(String(row.data_type)) ? `${name}::text AS ${name}` : name;
    }).join(', ');
    await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT ${selection} FROM public.${quoteIdentifier(table)}`);
    try {
      while (true) {
        const { rows } = await client.query("FETCH 500 FROM backup_rows");
        if (!rows.length) break;
        for (const row of rows) yield insertStatement(table, columns, row) + "\n";
      }
    } finally { await client.query("CLOSE backup_rows"); }
  }
  // Include business-number sequences, not just SERIAL id columns. Sequence values
  // can advance beyond the snapshot; preserving those gaps is safe and prevents reuse.
  const { rows: sequences } = await client.query(
    "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename",
  );
  for (const row of sequences) {
    const name = String(row.sequencename);
    const { rows: state } = await client.query(`SELECT last_value, is_called FROM public.${quoteIdentifier(name)}`);
    yield `SELECT setval(${sqlValue('public.' + quoteIdentifier(name))}, ${String(state[0].last_value)}, ${state[0].is_called ? 'TRUE' : 'FALSE'});\n`;
  }
  yield "COMMIT;\n-- AQLAN_BACKUP_COMPLETE\n";
}

// ─── إعادة تقييم العملات الأجنبية ────────────────────────────────────────────

export interface FxReport {
  asOf: string;
  baseCurrency: Currency;
  positions: FxPosition[];
  totalDifferenceMinor: number;
}

/**
 * مركز كل عملة أجنبية اليوم: كم منها في الصندوق، وبكم هي في الدفاتر، وكم تساوي.
 *
 * الوحدات المحتفظ بها تُحسب من المستندات — سندات القبض ناقص سندات الصرف بتلك
 * العملة — لا من جرد الوردية. والفرق مقصود: **الجرد يعالج الفرق بين الدرج
 * والدفاتر، وإعادة التقييم تعالج تغيّر السعر**، وخلطهما يجعل الحسابين بلا معنى فلا
 * يُعرف أضاع الصندوق مالًا أم تحرّك السعر.
 *
 * والقيمة الدفترية تُقرأ من رصيد حساب صندوق العملة في ميزان المراجعة — بكل مصادره،
 * ومنها إعادات التقييم السابقة. فترحيلُ الفرق يجعل الفرق التالي صفرًا: لا ازدواج
 * ولو رُحّل مرتين في اليوم نفسه.
 */
export async function fxReport(asOf: string): Promise<FxReport> {
  await ensureSchema();
  const settings = await getSettings();
  const baseCurrency: Currency = isCurrency(settings["finance.base_currency"])
    ? settings["finance.base_currency"] : "YER";

  const [entries, { rows: flows }] = await Promise.all([
    journalEntries(FX_EPOCH, asOf),
    getPool().query<{ currency: string; held: string }>(
      `SELECT currency, COALESCE(SUM(held), 0) AS held FROM (
         SELECT currency,
                SUM(CASE WHEN kind = 'refund' THEN -amount_minor ELSE amount_minor END) AS held
           FROM payments
          WHERE (created_at AT TIME ZONE $1)::date <= $2::date
          GROUP BY currency
         UNION ALL
         SELECT currency, -SUM(amount_minor) AS held
           FROM expenses
          WHERE (created_at AT TIME ZONE $1)::date <= $2::date
          GROUP BY currency
       ) AS movements GROUP BY currency`,
      [CLINIC_TIME_ZONE, asOf],
    ),
  ]);

  const balances = trialBalance(entries);
  const heldByCurrency = new Map<string, number>(
    flows.map((row) => [row.currency, toMinor(row.held)]),
  );

  const positions = foreignCurrencies(baseCurrency).map((currency) => {
    const account = balances.find((row) => row.code === CASH_ACCOUNT[currency]);
    return revaluePosition({
      currency,
      base: baseCurrency,
      heldMinor: heldByCurrency.get(currency) ?? 0,
      bookValueMinor: account?.balanceMinor ?? 0,
      rate: rateFromSettings(settings, currency, baseCurrency) ?? 0,
    });
  });

  return {
    asOf,
    baseCurrency,
    positions,
    totalDifferenceMinor: positions.reduce((sum, row) => sum + row.differenceMinor, 0),
  };
}

/** أول يوم تُقرأ منه الدفاتر لحساب رصيد الصندوق — قبل أي حركة ممكنة. */
const FX_EPOCH = "2000-01-01";

/**
 * ترحيل فرق إعادة التقييم قيدًا.
 *
 * يُعاد الحساب على الخادم ولا يُقبل الفرق من الواجهة: رقمٌ يأتي من المتصفّح يعني أن
 * يستطيع من يفتح الشاشة أن يكتب في الدفاتر ما يشاء.
 */
export async function postRevaluation(input: {
  currency: Currency;
  asOf: string;
  createdBy: string;
}): Promise<{ entryId: number | null; reason: "locked" | "nothing" | "no_rate" | null }> {
  if (await isPeriodLocked(input.asOf)) return { entryId: null, reason: "locked" };

  const report = await fxReport(input.asOf);
  const position = report.positions.find((row) => row.currency === input.currency);
  if (!position || position.rate <= 0) return { entryId: null, reason: "no_rate" };
  if (!isWorthPosting(position.differenceMinor)) return { entryId: null, reason: "nothing" };

  const entry = revaluationEntry({
    date: input.asOf,
    currency: input.currency,
    differenceMinor: position.differenceMinor,
  });
  if (!entry) return { entryId: null, reason: "nothing" };

  const entryId = await createManualEntry({
    date: input.asOf,
    description: revaluationDescription(input.currency, position.rate, input.asOf),
    lines: entry.lines,
    createdBy: input.createdBy,
  });
  return { entryId, reason: null };
}

// ─── سجل التدقيق ─────────────────────────────────────────────────────────────

import {
  describeAudit,
  sanitizeDetails,
  type AuditAction,
  type AuditEntry,
} from "./audit";

/**
 * يكتب سطرًا في سجل التدقيق.
 *
 * **لا يرمي أبدًا.** وهذا قرارٌ مقصود: فشلُ الكتابة في السجل يجب ألّا يُسقط قبضَ
 * مبلغ من مريض واقف. سجلٌّ ناقص سطرًا أهون من صندوق لا يقبض — والعكس يجعل التدقيق
 * نفسه سببًا لتعطيل العيادة.
 *
 * ويُستدعى **بعد** نجاح العملية لا قبلها: تسجيلُ ما لم يقع أسوأ من عدم تسجيل ما وقع.
 */
export async function recordAudit(input: {
  action: AuditAction;
  entity?: string | null;
  entityId?: string | number | null;
  entityLabel?: string | null;
  details?: Record<string, unknown> | null;
  actor: string;
  actorRole?: string | null;
}): Promise<void> {
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO audit_log (action, entity, entity_id, summary, details, actor, actor_role)
       VALUES ($1, $2::text, $3::text, $4, $5::jsonb, $6, $7::text)`,
      [
        input.action,
        input.entity ?? null,
        input.entityId === null || input.entityId === undefined ? null : String(input.entityId),
        describeAudit(input.action, input.entityLabel),
        JSON.stringify(sanitizeDetails(input.details)),
        input.actor,
        input.actorRole ?? null,
      ],
    );
  } catch {
    // يُبتلع عمدًا — انظر التعليق أعلاه.
  }
}

interface AuditRow {
  id: string; action: string; entity: string | null; entity_id: string | null;
  summary: string; details: Record<string, unknown> | null;
  actor: string; actor_role: string | null; created_at: Date;
}

const toAuditEntry = (row: AuditRow): AuditEntry => ({
  id: Number(row.id),
  action: row.action as AuditAction,
  entity: row.entity,
  entityId: row.entity_id,
  summary: row.summary,
  details: row.details,
  actor: row.actor,
  actorRole: row.actor_role,
  createdAt: row.created_at.toISOString(),
});

/**
 * قراءة السجل — بتصفية تجعله مقروءًا.
 *
 * سجلٌّ يُعرض بألف سطر بلا تصفية لا يُقرأ، فلا يُراجَع، فلا يشهد. والمالك يفتحه
 * بسؤال محدّد: ماذا فعل فلان؟ من ألغى هذه الفاتورة؟ ماذا جرى أمس؟
 */
export async function listAudit(input: {
  from?: string | null;
  to?: string | null;
  action?: string | null;
  actor?: string | null;
  entity?: string | null;
  entityId?: string | null;
  limit?: number;
} = {}): Promise<AuditEntry[]> {
  await ensureSchema();
  const { rows } = await getPool().query<AuditRow>(
    `SELECT id, action, entity, entity_id, summary, details, actor, actor_role, created_at
       FROM audit_log
      WHERE ($1::date IS NULL OR (created_at AT TIME ZONE $7)::date >= $1::date)
        AND ($2::date IS NULL OR (created_at AT TIME ZONE $7)::date <= $2::date)
        AND ($3::text IS NULL OR action = $3::text)
        AND ($4::text IS NULL OR actor = $4::text)
        AND ($5::text IS NULL OR (entity = $5::text AND ($6::text IS NULL OR entity_id = $6::text)))
      ORDER BY id DESC
      LIMIT $8`,
    [
      input.from ?? null, input.to ?? null, input.action ?? null, input.actor ?? null,
      input.entity ?? null, input.entityId ?? null, CLINIC_TIME_ZONE,
      Math.min(Math.max(1, input.limit ?? 200), 500),
    ],
  );
  return rows.map(toAuditEntry);
}

/** من عمل في هذه الفترة — لقائمة التصفية. */
export async function auditActors(): Promise<string[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{ actor: string }>(
    `SELECT DISTINCT actor FROM audit_log ORDER BY actor LIMIT 50`,
  );
  return rows.map((row) => row.actor);
}

// ─── الزيارة السريرية — الحلقة بين السريري والمالي ──────────────────────────

import {
  canSign, conditionForCategory, formatAddendum, visitTotal,
  type ClinicalStatus, type ProcedureLine, type VisitProcedureInput,
} from "./clinical";

export interface ClinicalVisit {
  id: number;
  patientId: number | null;
  patientName: string;
  chiefComplaint: string | null;
  examination: string | null;
  diagnosis: string | null;
  treatmentDone: string | null;
  nextPlan: string | null;
  addendum: string | null;
  doctorId: number | null;
  status: ClinicalStatus;
  signedAt: string | null;
  signedBy: string | null;
  invoiceId: number | null;
  arrivedAt: string;
  procedures: ProcedureLine[];
  totalMinor: number;
  /** بنود خطةٍ موافَقٍ عليها تشطبها هذه الزيارة. */
  planItemsMatched: number;
  planTitle: string | null;
  /** تحذير فوترةٍ مزدوجة إن كانت البنود المطابِقة على خطة أقساط. */
  planWarning: string | null;
  /** حالة التقويم المفتوحة إن كان المريض مريض تقويم. */
  ortho: VisitOrtho | null;
}

export interface VisitOrtho {
  caseId: number;
  appliance: string;
  phase: string;
  slot: string;
  upperWire: string | null;
  lowerWire: string | null;
  lastAdjustment: string | null;
  daysSinceLast: number | null;
  lastDone: string | null;
  elastics: string | null;
  elasticNote: string | null;
  suggestedUpper: string | null;
  suggestedLower: string | null;
}

interface ClinicalRow {
  id: number; patient_id: number | null; patient_name: string; patient_phone: string | null;
  chief_complaint: string | null; examination: string | null; diagnosis: string | null;
  treatment_done: string | null; next_plan: string | null; addendum: string | null;
  doctor_id: number | null; signed_at: Date | null; signed_by: string | null;
  invoice_id: number | null; arrived_at: Date;
}

interface ProcedureRow {
  catalog_code: string | null;
  plan_item_id: number | null;
  service_id: number; service_name: string; category: string | null;
  doctor_id: number | null; tooth_code: number | null; surfaces: string | null;
  quantity: number; unit_price_minor: string;
}

const toProcedureLine = (row: ProcedureRow): ProcedureLine => ({
  planItemId: row.plan_item_id,
  catalogCode: row.catalog_code,
  serviceId: row.service_id,
  serviceName: row.service_name,
  category: row.category,
  toothCode: row.tooth_code,
  surfaces: row.surfaces,
  quantity: row.quantity,
  unitPriceMinor: toMinor(row.unit_price_minor),
  totalMinor: row.quantity * toMinor(row.unit_price_minor),
  doctorId: row.doctor_id,
});

export async function getClinicalVisit(visitId: number): Promise<ClinicalVisit | null> {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query<ClinicalRow>(
    `SELECT id, patient_id, patient_name, patient_phone, chief_complaint, examination, diagnosis,
            treatment_done, next_plan, addendum, doctor_id, signed_at, signed_by,
            invoice_id, arrived_at
       FROM visits WHERE id = $1`,
    [visitId],
  );
  if (!rows[0]) return null;

  const { rows: procedureRows } = await pool.query<ProcedureRow>(
    `SELECT p.plan_item_id, p.service_id, s.name AS service_name, s.category, s.catalog_code, p.doctor_id,
            p.tooth_code, p.surfaces, p.quantity, p.unit_price_minor
       FROM visit_procedures p JOIN services s ON s.id = p.service_id
      WHERE p.visit_id = $1 ORDER BY p.id`,
    [visitId],
  );
  const procedures = procedureRows.map(toProcedureLine);
  const row = rows[0];
  const patientId = await previewPatientId(pool, row);
  const plan = await visitPlanContext(pool, patientId, procedures);
  const ortho = await visitOrthoContext(patientId);
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    chiefComplaint: row.chief_complaint,
    examination: row.examination,
    diagnosis: row.diagnosis,
    treatmentDone: row.treatment_done,
    nextPlan: row.next_plan,
    addendum: row.addendum,
    doctorId: row.doctor_id,
    status: row.signed_at ? "signed" : "open",
    signedAt: row.signed_at?.toISOString() ?? null,
    signedBy: row.signed_by,
    invoiceId: row.invoice_id,
    arrivedAt: row.arrived_at.toISOString(),
    procedures,
    totalMinor: visitTotal(procedures),
    planItemsMatched: plan.matched,
    planTitle: plan.title,
    planWarning: plan.warning,
    ortho,
  };
}

/**
 * حالة التقويم كما تُقرأ على الكرسي.
 *
 * مريض التقويم لا يأتي في زيارةٍ مستقلّة — يأتي في **الشدّة الحادية عشرة** من علاجٍ
 * بدأ قبل سنة. والطبيب يحتاج قبل أن يفتح فمه: على أيّ سلكٍ هو، وماذا عُمل آخر مرة،
 * وكم مضى منذاك. وبلا ذلك يُفتح تبويبٌ آخر ويُبحث ويُقرأ — أو، وهو الأسوأ، يُخمَّن.
 */
async function visitOrthoContext(patientId: number | null): Promise<VisitOrtho | null> {
  if (!patientId) return null;
  const today = clinicDateString(new Date(), CLINIC_TIME_ZONE);
  const open = await openOrthoCaseFor(patientId, today);
  if (!open) return null;
  const last = open.adjustments[0] ?? null;
  return {
    caseId: open.id,
    appliance: open.appliance,
    phase: open.phase,
    slot: open.slot,
    upperWire: open.upperWire,
    lowerWire: open.lowerWire,
    lastAdjustment: last?.doneOn ?? null,
    daysSinceLast: open.progress.daysSinceLast,
    lastDone: last?.done ?? null,
    elastics: last?.elastics ?? null,
    elasticNote: last?.elasticNote ?? null,
    suggestedUpper: nextWire(open.slot, open.upperWire)?.code ?? null,
    suggestedLower: nextWire(open.slot, open.lowerWire)?.code ?? null,
  };
}

/**
 * أيّ ملفٍّ **سيؤول إليه** هذا المريض عند التوقيع؟
 *
 * زيارة المريض المشي بلا `patient_id` حتى تُوقَّع، وحينها يُحلّ ملفّها بالهاتف.
 * والعرض قبل التوقيع يحتاج الجواب نفسه — بلا أن يكتب شيئًا: قراءةٌ فقط، فلا يُنشئ
 * ملفًّا ولا يربط زيارة. وبلا هذا يبقى تحذير الفوترة المزدوجة مخفيًّا عن أكثر من
 * يحتاجه: المريض الذي وصل من الباب لا من الموعد.
 */
async function previewPatientId(
  pool: Pool,
  visit: { patient_id: number | null; patient_phone?: string | null },
): Promise<number | null> {
  if (visit.patient_id) return visit.patient_id;
  const phone = visit.patient_phone ?? null;
  if (!normalizePatientPhone(phone)) return null;
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM patients WHERE phone = ANY($1::text[]) ORDER BY id LIMIT 1`,
    [phoneLookupForms(phone)],
  );
  return rows[0]?.id ?? null;
}

/**
 * ما علاقة هذه الزيارة بخطة علاج المريض؟
 *
 * جوابان مطلوبان قبل الضغط على زر التوقيع:
 *
 * ١) **أيّ بنود الخطة تشطبها هذه الزيارة** — ليرى الطبيب أن ما يعمله محسوبٌ من
 *    الاتفاق لا خارجه.
 *
 * ٢) **تحذير الفوترة المزدوجة**، وهو الأهم. خطةٌ لها جدول أقساط تُفوتَر بأقساطها؛
 *    فإن وُقّعت زيارةٌ بإجراءاتٍ من بنودها صدرت فاتورةٌ ثانية للعمل نفسه — ويُطالَب
 *    المريض بالمبلغ مرتين. ولا يُمنع هنا بالقوة: قد يكون الإجراء خارج الاتفاق فعلًا
 *    ويستحقّ فاتورته. لكنه لا يمرّ صامتًا — والصمت هو ما يُنتج مطالبةً مكرّرة يكتشفها
 *    المريض قبل المحاسب.
 */
async function visitPlanContext(
  pool: Pool,
  patientId: number | null,
  procedures: ProcedureLine[],
): Promise<{ matched: number; title: string | null; warning: string | null }> {
  if (!patientId || procedures.length === 0) return { matched: 0, title: null, warning: null };

  const { rows } = await pool.query<{
    id: number; plan_id: number; title: string; service_id: number | null;
    tooth_code: number | null; quantity: number; unit_price_minor: string;
    status: string; installments: string;
  }>(
    `SELECT i.id, i.plan_id, t.title, i.service_id, i.tooth_code, i.quantity,
            i.unit_price_minor, i.status,
            (SELECT COUNT(*) FROM plan_installments n WHERE n.plan_id = t.id)::text AS installments
       FROM plan_items i JOIN treatment_plans t ON t.id = i.plan_id
      WHERE t.patient_id = $1 AND t.status = 'active' AND t.consent_at IS NOT NULL
        AND i.status = 'planned'
      ORDER BY i.id`,
    [patientId],
  );
  if (rows.length === 0) return { matched: 0, title: null, warning: null };

  const matchedIds = matchPlanItems(
    rows.map((row) => ({
      id: row.id, serviceId: row.service_id, toothCode: row.tooth_code,
      quantity: row.quantity, unitPriceMinor: toMinor(row.unit_price_minor),
      status: row.status as PlanItemStatus,
    })),
    procedures.map((line) => ({
      serviceId: line.serviceId, toothCode: line.toothCode, quantity: line.quantity,
    })),
  );
  if (matchedIds.length === 0) return { matched: 0, title: null, warning: null };

  const matchedSet = new Set(matchedIds);
  const hit = rows.find((row) => matchedSet.has(row.id));
  const onInstalments = rows.some((row) => matchedSet.has(row.id) && Number(row.installments) > 0);

  return {
    matched: matchedIds.length,
    title: hit?.title ?? null,
    warning: onInstalments
      ? "هذه الإجراءات ضمن خطة لها جدول أقساط — يُسجّل تنفيذها دون فاتورة جديدة، ويكون التحصيل من أقساط الخطة."
      : null,
  };
}

/** حفظ التوثيق السريري قبل التوقيع — يُرفض بعده، والتصحيح بملحق. */
export async function saveClinicalNotes(input: {
  visitId: number;
  chiefComplaint: string | null;
  examination: string | null;
  diagnosis: string | null;
  treatmentDone: string | null;
  nextPlan: string | null;
  doctorId: number | null;
}): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE visits SET chief_complaint = $2::text, examination = $3::text,
            diagnosis = $4::text, treatment_done = $5::text, next_plan = $6::text,
            doctor_id = COALESCE($7::int, doctor_id)
      WHERE id = $1 AND signed_at IS NULL`,
    [input.visitId, input.chiefComplaint, input.examination, input.diagnosis,
     input.treatmentDone, input.nextPlan, input.doctorId],
  );
  return (rowCount ?? 0) > 0;
}

export async function setVisitProcedures(input: {
  visitId: number;
  procedures: VisitProcedureInput[];
  notes?: Omit<Parameters<typeof saveClinicalNotes>[0], 'visitId'>;
}): Promise<boolean> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // الحارس داخل الجملة: زيارةٌ وُقّعت بين القراءة والكتابة لا تُغيَّر إجراءاتها.
    const { rows } = await client.query<{ id: number }>(
      `SELECT id FROM visits WHERE id = $1 AND signed_at IS NULL FOR UPDATE`,
      [input.visitId],
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return false; }

    const { validateProcedures } = await import('./treatmentWorkflow');
    await validateProcedures(client, input.visitId, input.procedures);
    if (input.notes) {
      const n = input.notes;
      if(n.doctorId!==null && !(await client.query("SELECT id FROM parties WHERE id=$1 AND kind='doctor' AND is_active",[n.doctorId])).rowCount) {
        const {ClinicInputError}=await import('./treatmentWorkflow');throw new ClinicInputError('اختر طبيبًا مسجّلًا ونشطًا.');
      }
      await client.query(`UPDATE visits SET chief_complaint=$2, examination=$3, diagnosis=$4,
        treatment_done=$5, next_plan=$6, doctor_id=$7 WHERE id=$1`,
        [input.visitId,n.chiefComplaint,n.examination,n.diagnosis,n.treatmentDone,n.nextPlan,n.doctorId]);
    }
    await client.query(`DELETE FROM visit_procedures WHERE visit_id = $1`, [input.visitId]);
    for (const procedure of input.procedures) {
      await client.query(
        `INSERT INTO visit_procedures
           (visit_id, service_id, doctor_id, tooth_code, surfaces, quantity, unit_price_minor, note, plan_item_id)
         VALUES ($1, $2, $3::int, $4::int, $5::text, $6, $7, $8::text, $9::int)`,
        [input.visitId, procedure.serviceId, procedure.doctorId, procedure.toothCode,
         normalizeSurfaces(procedure.surfaces), Math.max(1, Math.round(procedure.quantity)),
         Math.max(0, Math.round(procedure.unitPriceMinor)), procedure.note, procedure.planItemId ?? null],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * توقيع الزيارة — **الحلقة التي كانت مقطوعة**.
 *
 * عملٌ واحد يُنتج ثلاثة آثار في **معاملة واحدة**: توقيع الزيارة، وفاتورةٌ من دليل
 * الخدمات، وتحديث المخطط السني بما أُنجز. إمّا كلها أو لا شيء — والدستور §٤٠.
 *
 * ولماذا معاملة واحدة لا ثلاث خطوات: لأن الفشل بين الخطوتين هو الكارثة نفسها التي
 * جاء الترابط ليمنعها — زيارةٌ موقَّعة بلا فاتورة (عملٌ ضاع)، أو فاتورةٌ بلا زيارة
 * (مطالبةٌ بلا سند)، أو مخططٌ يقول إن التاج رُكّب والفاتورة لا تعرف.
 */
export async function signClinicalVisit(input: {
  visitId: number;
  baseCurrency: Currency;
  signedBy: string;
}): Promise<{
  visit: ClinicalVisit | null;
  invoiceId: number | null;
  chartUpdates: number;
  /** بنود خطة العلاج التي شطبتها هذه الزيارة. */
  planItemsDone: number;
  reason: "not_found" | "already_signed" | "empty" | "no_patient" | null;
}> {
  const existing = await getClinicalVisit(input.visitId);
  if (!existing) return { visit: null, invoiceId: null, chartUpdates: 0, planItemsDone: 0, reason: "not_found" };
  if (existing.status === "signed") {
    return { visit: existing, invoiceId: existing.invoiceId, chartUpdates: 0, planItemsDone: 0, reason: "already_signed" };
  }
  const check = canSign({
    status: existing.status,
    procedures: existing.procedures,
    diagnosis: existing.diagnosis,
    treatmentDone: existing.treatmentDone,
  });
  if (!check.ok) return { visit: existing, invoiceId: null, chartUpdates: 0, planItemsDone: 0, reason: "empty" };

  const client = await getPool().connect();
  let released = false;
  try {
    await client.query("BEGIN");

    const { rows: locked } = await client.query<{
      id: number; patient_name: string; patient_phone: string | null; patient_id: number | null;
    }>(
      `SELECT id, patient_name, patient_phone, patient_id FROM visits
        WHERE id = $1 AND signed_at IS NULL FOR UPDATE`,
      [input.visitId],
    );
    if (!locked[0]) {
      await client.query("ROLLBACK");
      return { visit: existing, invoiceId: null, chartUpdates: 0, planItemsDone: 0, reason: "already_signed" };
    }

    /*
     * ملفُّ المريض يُحلّ هنا لا يُشترط قبلها.
     *
     * المريض المشي يصل باسمه فقط، والطبيب يعالجه ويوقّع — ورفضُ التوقيع لأنه بلا ملف
     * يعني أن يتوقّف الطبيب ليملأ نموذجًا، أو أن يخرج المريض بلا فاتورة. وكلاهما ما
     * جاء الترابط ليمنعه. فيُنشأ الملف هنا **داخل المعاملة نفسها**: إن سقط التوقيع
     * سقط الملف معه، فلا يبقى مريضٌ بلا زيارة.
     */
    const patientId = await resolveVisitPatient(client, locked[0]);
    const { rows: freshNotes } = await client.query(`SELECT diagnosis,treatment_done FROM visits WHERE id=$1`,[input.visitId]);
    const { rows: freshProcedures } = await client.query<ProcedureRow>(
      `SELECT p.plan_item_id,p.service_id,s.name AS service_name,s.category,s.catalog_code,p.doctor_id,
         p.tooth_code,p.surfaces,p.quantity,p.unit_price_minor
       FROM visit_procedures p JOIN services s ON s.id=p.service_id WHERE p.visit_id=$1 ORDER BY p.id`,[input.visitId]);
    existing.procedures=freshProcedures.map(toProcedureLine);
    existing.totalMinor=visitTotal(existing.procedures);
    if (!canSign({status:'open', procedures:existing.procedures,diagnosis:freshNotes[0].diagnosis,treatmentDone:freshNotes[0].treatment_done}).ok) {
      await client.query('ROLLBACK');
      return {visit:existing,invoiceId:null,chartUpdates:0,planItemsDone:0,reason:'empty'};
    }
    const { validateProcedures, resolveProcedureBilling } = await import('./treatmentWorkflow');
    await validateProcedures(client,input.visitId,existing.procedures.map(p=>({...p,note:null})));
    const billing = await resolveProcedureBilling(client,patientId,input.baseCurrency,existing.procedures);
    const billedLines = billing.lines;
    let invoiceId: number | null = null;
    if (billedLines.length > 0) {
      const { rows: invoiceRows } = await client.query<{ id: number }>(
        `INSERT INTO invoices (invoice_number, patient_id, base_currency, total_minor, discount_minor, note, created_by)
         VALUES ('INV-' || LPAD(nextval('invoice_number_seq')::text, 5, '0'),
                 $1, $2, $3, 0, $4::text, $5)
         RETURNING id`,
        [patientId, input.baseCurrency, visitTotal(billedLines),
         `من الزيارة رقم ${existing.id}`, input.signedBy],
      );
      invoiceId = invoiceRows[0].id;

      for (const line of billedLines) {
        await client.query(
          `INSERT INTO invoice_items
             (invoice_id, service_id, doctor_id, description, quantity, unit_price_minor, total_minor)
           VALUES ($1, $2, $3::int, $4, $5, $6, $7)`,
          [invoiceId, line.serviceId, line.doctorId,
           line.toothCode ? `${line.serviceName} — سن ${line.toothCode}` : line.serviceName,
           line.quantity, line.unitPriceMinor, line.totalMinor],
        );
      }
    }

    // المخطط السني: ما أُنجز على سن يصير حالةً منجَزة عليه — بلا تسجيل ثانٍ.
    let chartUpdates = 0;
    {
      for (const line of existing.procedures) {
        const condition = conditionForCategory(line.category, line.catalogCode);
        if (!condition || !line.toothCode) continue;
        await client.query(
          `INSERT INTO tooth_conditions
             (patient_id, tooth_code, condition, stage, surfaces, note, visit_id, recorded_by)
           VALUES ($1, $2, $3, 'completed', $4::text, $5::text, $6, $7)`,
          [patientId, line.toothCode, condition, line.surfaces,
           `من الزيارة رقم ${existing.id}`, existing.id, input.signedBy],
        );
        chartUpdates += 1;
      }
    }

    /*
     * بنود خطة العلاج تُشطب من نفسها.
     *
     * وهذا ما يفرّق بين خطةٍ حيّة وورقةٍ تُكتب وتُنسى: الطبيب يعمل في الزيارة كما
     * يعمل دائمًا، فتُعلَّم بنود الخطة التي نفّذها هذه الزيارة **منفَّذةً** ومربوطةً
     * بها. وبلا هذا يبقى على أحدٍ أن يتذكّر تحديث الخطة يدويًّا — فلا يتذكّر، فتُظهر
     * الخطة بعد سنةٍ عملًا أُنجز كأنه لم يبدأ، ويُشرح للمريض تقدّمٌ يخالف ملفّه.
     *
     * ولا يُشطب إلا من خطةٍ **موافَقٍ عليها**: المسوّدة ليست اتفاقًا بعد.
     */
    let planItemsDone = 0;
    if (billing.itemIds.length) {
      const result=await client.query(`UPDATE plan_items SET status='done',visit_id=$2,done_at=NOW() WHERE id=ANY($1::int[]) AND status='planned'`,[billing.itemIds,input.visitId]);
      planItemsDone=result.rowCount ?? 0;
    }
    await client.query(
      `UPDATE visits SET signed_at = NOW(), signed_by = $2, invoice_id = $3::int,
              status = 'done', finished_at = COALESCE(finished_at, NOW())
        WHERE id = $1`,
      [input.visitId, input.signedBy, invoiceId],
    );

    await client.query("COMMIT");
    client.release(); released = true;
    return {
      visit: await getClinicalVisit(input.visitId),
      invoiceId, chartUpdates, planItemsDone, reason: null,
    };
  } catch (error) {
    if (!released) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (!released) client.release();
  }
}

/** ملحق على زيارة موقَّعة — يُضاف ولا يمحو ما قبله. */
export async function addVisitAddendum(input: {
  visitId: number; text: string; author: string;
}): Promise<boolean> {
  await ensureSchema();
  const entry = formatAddendum({ text: input.text, author: input.author, at: new Date().toISOString() });
  const { rowCount } = await getPool().query(
    `UPDATE visits
        SET addendum = CASE WHEN addendum IS NULL OR addendum = '' THEN $2::text
                            ELSE addendum || E'\n' || $2::text END
      WHERE id = $1 AND signed_at IS NOT NULL`,
    [input.visitId, entry],
  );
  return (rowCount ?? 0) > 0;
}

// ─── مخطط الأسنان ────────────────────────────────────────────────────────────

import {
  buildChart, chartSummary, isValidTooth, normalizeSurfaces,
  type ChartSummary, type ConditionStage, type ToothCondition,
  type ToothRecord, type ToothState,
} from "./dental";

interface ToothRow {
  id: string; tooth_code: number; condition: string; stage: string;
  surfaces: string | null; note: string | null; visit_id: number | null;
  recorded_by: string; recorded_at: Date;
}

const toToothRecord = (row: ToothRow): ToothRecord => ({
  id: Number(row.id),
  toothCode: row.tooth_code,
  condition: row.condition as ToothCondition,
  stage: row.stage as ConditionStage,
  surfaces: row.surfaces,
  note: row.note,
  visitId: row.visit_id,
  recordedBy: row.recorded_by,
  recordedAt: row.recorded_at.toISOString(),
});

export async function patientChart(patientId: number): Promise<{
  records: ToothRecord[];
  chart: [number, ToothState][];
  summary: ChartSummary;
}> {
  await ensureSchema();
  const { rows } = await getPool().query<ToothRow>(
    `SELECT id, tooth_code, condition, stage, surfaces, note, visit_id, recorded_by, recorded_at
       FROM tooth_conditions WHERE patient_id = $1 ORDER BY recorded_at, id`,
    [patientId],
  );
  const records = rows.map(toToothRecord);
  const chart = buildChart(records);
  return { records, chart: [...chart.entries()], summary: chartSummary(chart) };
}

/**
 * يثبّت حالة سن.
 *
 * إضافة لا تعديل: لا دالة في البرنامج تحدّث سطرًا في هذا الجدول أو تحذف منه. وتصحيح
 * خطأ يكون بتثبيت الحالة الصحيحة فوقه — فيبقى الخطأ وتصحيحه ظاهرين، وهو ما يجعل
 * السجل السريري قابلًا للتدقيق.
 */
export async function recordToothCondition(input: {
  patientId: number;
  toothCode: number;
  condition: ToothCondition;
  stage: ConditionStage;
  surfaces?: string | null;
  note?: string | null;
  visitId?: number | null;
  recordedBy: string;
}): Promise<ToothRecord | null> {
  if (!isValidTooth(input.toothCode)) return null;
  await ensureSchema();
  const { rows } = await getPool().query<ToothRow>(
    `INSERT INTO tooth_conditions
       (patient_id, tooth_code, condition, stage, surfaces, note, visit_id, recorded_by)
     SELECT $1, $2, $3, $4, $5::text, $6::text, $7::int, $8
      WHERE EXISTS (SELECT 1 FROM patients WHERE id = $1)
     RETURNING id, tooth_code, condition, stage, surfaces, note, visit_id, recorded_by, recorded_at`,
    [
      input.patientId, input.toothCode, input.condition, input.stage,
      normalizeSurfaces(input.surfaces), input.note?.trim() || null,
      input.visitId ?? null, input.recordedBy,
    ],
  );
  return rows[0] ? toToothRecord(rows[0]) : null;
}

// ─── طبعات المستندات ─────────────────────────────────────────────────────────

/** كم مرة طُبع هذا المستند قبل الآن. */
export async function printCount(docType: string, docId: string | number): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM document_prints WHERE doc_type = $1 AND doc_id = $2::text`,
    [docType, String(docId)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * يسجّل طبعة ويعيد **عدد الطبعات السابقة**.
 *
 * السابقة لا الحالية: الجواب المطلوب هو «هل هذه إعادة طباعة؟»، وهو ما يُعرف من
 * وجود طبعةٍ قبلها لا من وجود هذه.
 */
export async function recordPrint(input: {
  docType: string; docId: string | number; printedBy: string;
}): Promise<number> {
  await ensureSchema();
  const previous = await printCount(input.docType, input.docId);
  await getPool().query(
    `INSERT INTO document_prints (doc_type, doc_id, printed_by) VALUES ($1, $2::text, $3)`,
    [input.docType, String(input.docId), input.printedBy],
  );
  return previous;
}

// ─── الأرصدة الافتتاحية للمرضى ───────────────────────────────────────────────

/**
 * الرصيد الافتتاحي: ما كان على المريض **قبل** تشغيل النظام.
 *
 * بلا هذا يبدأ كل مريض من صفر يوم التشغيل، فتضيع مديونية سنوات كاملة في يوم واحد —
 * وهو أسوأ ما يمكن أن يفعله نظام جديد بعيادة قائمة. والبديل الشائع — فتح «فاتورة
 * سابقة» بقيمة الدَّين — أسوأ: يدخل دينٌ قديم في إيراد هذا الشهر، فتظهر أرباح لم
 * تتحقق وتُحسب عمولات عن عمل قديم دُفعت عمولته أصلًا.
 *
 * فهو هنا **بندٌ مستقل**: يدخل حساب المريض ومديونيته، ويُقيَّد أصلًا افتتاحيًا مقابل
 * حقوق الملكية، ولا يمسّ الإيراد ولا العمولات بشيء.
 */
export interface OpeningBalance {
  patientId: number;
  patientName: string;
  phone: string | null;
  amountMinor: number;
  asOfDate: string;
  note: string | null;
  createdBy: string | null;
  updatedAt: string;
}

interface OpeningRow {
  patient_id: number; full_name: string; phone: string | null;
  amount_minor: string; as_of_date: Date; note: string | null;
  created_by: string | null; updated_at: Date;
}

const toOpeningBalance = (row: OpeningRow): OpeningBalance => ({
  patientId: row.patient_id,
  patientName: row.full_name,
  phone: row.phone,
  amountMinor: toMinor(row.amount_minor),
  asOfDate: dateText(row.as_of_date),
  note: row.note,
  createdBy: row.created_by,
  updatedAt: row.updated_at.toISOString(),
});

const OPENING_SELECT = `SELECT o.patient_id, p.full_name, p.phone, o.amount_minor,
                               o.as_of_date, o.note, o.created_by, o.updated_at
                          FROM patient_opening_balances o
                          JOIN patients p ON p.id = o.patient_id`;

export async function getPatientOpeningBalance(patientId: number): Promise<OpeningBalance | null> {
  await ensureSchema();
  const { rows } = await getPool().query<OpeningRow>(
    `${OPENING_SELECT} WHERE o.patient_id = $1`,
    [patientId],
  );
  return rows[0] ? toOpeningBalance(rows[0]) : null;
}

export async function listOpeningBalances(): Promise<OpeningBalance[]> {
  await ensureSchema();
  const { rows } = await getPool().query<OpeningRow>(
    `${OPENING_SELECT} ORDER BY o.amount_minor DESC LIMIT 500`,
  );
  return rows.map(toOpeningBalance);
}

/** أرصدة افتتاحية لمجموعة مرضى — للتقارير التي تقرأ مئات الصفوف بلا استعلام لكل صف. */
export async function openingBalanceAmounts(patientIds: number[]): Promise<Map<number, number>> {
  if (patientIds.length === 0) return new Map();
  await ensureSchema();
  const { rows } = await getPool().query<{ patient_id: number; amount_minor: string }>(
    `SELECT patient_id, amount_minor FROM patient_opening_balances WHERE patient_id = ANY($1::int[])`,
    [patientIds],
  );
  return new Map(rows.map((row) => [row.patient_id, toMinor(row.amount_minor)]));
}

/**
 * إثبات الرصيد الافتتاحي أو تصحيحه.
 *
 * صفٌّ واحد لكل مريض: إعادة الإدخال **تصحيح** لا إضافة، لأن رصيدًا افتتاحيًا يُدخل
 * مرتين بالخطأ يضاعف دَين المريض بصمت — وهو خطأ يقع كثيرًا يوم إدخال البيانات
 * القديمة حين يعمل أكثر من شخص على الملفات نفسها.
 */
export async function setPatientOpeningBalance(input: {
  patientId: number;
  amountMinor: number;
  asOfDate: string;
  note: string | null;
  createdBy: string;
}): Promise<OpeningBalance | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ patient_id: number }>(
    `INSERT INTO patient_opening_balances
       (patient_id, amount_minor, as_of_date, note, created_by)
     SELECT $1, $2, $3::date, $4, $5
      WHERE EXISTS (SELECT 1 FROM patients WHERE id = $1)
     ON CONFLICT (patient_id) DO UPDATE
        SET amount_minor = EXCLUDED.amount_minor,
            as_of_date   = EXCLUDED.as_of_date,
            note         = EXCLUDED.note,
            created_by   = EXCLUDED.created_by,
            updated_at   = NOW()
     RETURNING patient_id`,
    [input.patientId, input.amountMinor, input.asOfDate, input.note, input.createdBy],
  );
  return rows[0] ? getPatientOpeningBalance(rows[0].patient_id) : null;
}

export async function clearPatientOpeningBalance(patientId: number): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `DELETE FROM patient_opening_balances WHERE patient_id = $1`,
    [patientId],
  );
  return (rowCount ?? 0) > 0;
}

// ─── خطط العلاج والأقساط ─────────────────────────────────────────────────────

import {
  canConsent, canEditItems, itemsTotal, matchPlanItems, planItemsProgress, planProgress,
  splitInstallments,
  type PlanItemLike, type PlanItemStatus, type PlanItemsProgress, type PlanStatus, type PlanProgress,
} from "./plans";

export interface TreatmentPlan {
  id: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  title: string;
  totalMinor: number;
  baseCurrency: Currency;
  status: PlanStatus;
  startDate: string;
  note: string | null;
  createdAt: string;
  installments: { id: number; number: number; dueDate: string; amountMinor: number }[];
  paidMinor: number;
  progress: PlanProgress;
  items: PlanItem[];
  itemsProgress: PlanItemsProgress;
  totalFromItems: boolean;
  consentAt: string | null;
  consentBy: string | null;
  consentNote: string | null;
}

/** بندٌ في الخطة: خدمةٌ على سنّ بسعرٍ منسوخ لحظة الاتفاق. */
export interface PlanItem {
  id: number;
  serviceId: number | null;
  serviceName: string;
  category: string | null;
  toothCode: number | null;
  surfaces: string | null;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  status: PlanItemStatus;
  visitId: number | null;
  doneAt: string | null;
  note: string | null;
}

interface PlanRow {
  id: number; patient_id: number; full_name: string; phone: string | null;
  title: string; total_minor: string; base_currency: string; status: string;
  start_date: Date; note: string | null; created_at: Date; paid_minor: string;
  total_from_items: boolean; consent_at: Date | null; consent_by: string | null;
  consent_note: string | null;
}

const PLAN_SELECT = `
  SELECT t.id, t.patient_id, p.full_name, p.phone, t.title, t.total_minor, t.base_currency,
         t.status, t.start_date, t.note, t.created_at,
         t.total_from_items, t.consent_at, t.consent_by, t.consent_note,
         COALESCE((SELECT SUM(CASE WHEN y.kind = 'refund' THEN -y.base_amount_minor ELSE y.base_amount_minor END)
                     FROM payments y WHERE y.plan_id = t.id), 0) AS paid_minor
    FROM treatment_plans t JOIN patients p ON p.id = t.patient_id`;

async function hydratePlans(rows: PlanRow[], today: string): Promise<TreatmentPlan[]> {
  if (rows.length === 0) return [];
  const { rows: installmentRows } = await getPool().query<{
    id: number; plan_id: number; number: number; due_date: Date; amount_minor: string;
  }>(
    `SELECT id, plan_id, number, due_date, amount_minor FROM plan_installments
      WHERE plan_id = ANY($1::int[]) ORDER BY plan_id, number`,
    [rows.map((row) => row.id)],
  );

  const { rows: itemRows } = await getPool().query<PlanItemRow & { plan_id: number }>(
    `${PLAN_ITEM_SELECT} WHERE plan_id = ANY($1::int[]) ORDER BY plan_id, sort_order, id`,
    [rows.map((row) => row.id)],
  );
  const itemsByPlan = new Map<number, PlanItem[]>();
  for (const row of itemRows) {
    const list = itemsByPlan.get(row.plan_id) ?? [];
    list.push(toPlanItem(row));
    itemsByPlan.set(row.plan_id, list);
  }

  const byPlan = new Map<number, { id: number; number: number; dueDate: string; amountMinor: number }[]>();
  for (const row of installmentRows) {
    const list = byPlan.get(row.plan_id) ?? [];
    list.push({
      id: row.id, number: row.number,
      dueDate: dateText(row.due_date), amountMinor: toMinor(row.amount_minor),
    });
    byPlan.set(row.plan_id, list);
  }

  return rows.map((row) => {
    const installments = byPlan.get(row.id) ?? [];
    const items = itemsByPlan.get(row.id) ?? [];
    const paidMinor = toMinor(row.paid_minor);
    return {
      id: row.id,
      patientId: row.patient_id,
      patientName: row.full_name,
      patientPhone: row.phone,
      title: row.title,
      totalMinor: toMinor(row.total_minor),
      baseCurrency: row.base_currency as Currency,
      status: row.status as PlanStatus,
      startDate: dateText(row.start_date),
      note: row.note,
      createdAt: row.created_at.toISOString(),
      installments,
      paidMinor,
      progress: planProgress(
        { totalMinor: toMinor(row.total_minor), status: row.status as PlanStatus, installments },
        paidMinor,
        today,
      ),
      items,
      itemsProgress: planItemsProgress(items),
      totalFromItems: row.total_from_items,
      consentAt: row.consent_at ? row.consent_at.toISOString() : null,
      consentBy: row.consent_by,
      consentNote: row.consent_note,
    };
  });
}

interface PlanItemRow {
  id: number; service_id: number | null; service_name: string; category: string | null;
  tooth_code: number | null; surfaces: string | null; quantity: number;
  unit_price_minor: string; status: string; visit_id: number | null;
  done_at: Date | null; note: string | null;
}

const PLAN_ITEM_SELECT = `
  SELECT id, plan_id, service_id, service_name, category, tooth_code, surfaces, quantity,
         unit_price_minor, status, visit_id, done_at, note, sort_order
    FROM plan_items`;

function toPlanItem(row: PlanItemRow): PlanItem {
  const quantity = Math.max(1, row.quantity);
  const unitPriceMinor = toMinor(row.unit_price_minor);
  return {
    id: row.id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    category: row.category,
    toothCode: row.tooth_code,
    surfaces: row.surfaces,
    quantity,
    unitPriceMinor,
    totalMinor: quantity * unitPriceMinor,
    status: row.status as PlanItemStatus,
    visitId: row.visit_id,
    doneAt: row.done_at ? row.done_at.toISOString() : null,
    note: row.note,
  };
}

export async function listPatientPlans(patientId: number, today: string): Promise<TreatmentPlan[]> {
  await ensureSchema();
  const { rows } = await getPool().query<PlanRow>(
    `${PLAN_SELECT} WHERE t.patient_id = $1 ORDER BY t.created_at DESC`, [patientId],
  );
  return hydratePlans(rows, today);
}

export async function getPlan(id: number, today: string): Promise<TreatmentPlan | null> {
  await ensureSchema();
  const { rows } = await getPool().query<PlanRow>(`${PLAN_SELECT} WHERE t.id = $1`, [id]);
  const plans = await hydratePlans(rows, today);
  return plans[0] ?? null;
}

/** الخطط الجارية — لقائمة الأقساط المستحقة والمتأخرة. */
export async function listActivePlans(today: string): Promise<TreatmentPlan[]> {
  await ensureSchema();
  const { rows } = await getPool().query<PlanRow>(
    `${PLAN_SELECT} WHERE t.status = 'active' ORDER BY t.created_at DESC LIMIT 300`,
  );
  return hydratePlans(rows, today);
}

/**
 * ينشئ خطة بجدول أقساطها في معاملة واحدة.
 *
 * الخطة بلا أقساط اتفاقٌ بلا مواعيد — وهو ما كان يحدث على الورق: سعرٌ متفق عليه ولا
 * أحد يعرف متى يُدفع، فيُسأل المريض في كل زيارة «كم تدفع اليوم؟».
 */
export async function createPlan(input: {
  patientId: number;
  title: string;
  totalMinor: number;
  baseCurrency: Currency;
  startDate: string;
  note: string | null;
  createdBy: string;
  installments: { number: number; dueDate: string; amountMinor: number }[];
}): Promise<number | null> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO treatment_plans (patient_id, title, total_minor, base_currency, start_date, note, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6::text, $7) RETURNING id`,
      [input.patientId, input.title, input.totalMinor, input.baseCurrency,
       input.startDate, input.note, input.createdBy],
    );
    for (const installment of input.installments) {
      await client.query(
        `INSERT INTO plan_installments (plan_id, number, due_date, amount_minor)
         VALUES ($1, $2, $3::date, $4)`,
        [rows[0].id, installment.number, installment.dueDate, installment.amountMinor],
      );
    }
    await client.query("COMMIT");
    return rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function setPlanStatus(id: number, status: PlanStatus): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE treatment_plans SET status = $2 WHERE id = $1`, [id, status],
  );
  return (rowCount ?? 0) > 0;
}

/* ────────────────── بنود الخطة السريرية وموافقتها ────────────────── */

type PlanGuard = { ok: true } | { ok: false; message: string };

/** حالة الخطة كما تحتاجها الحُرّاس — تُقرأ مع قفلٍ كي لا تتغيّر بين الفحص والتنفيذ. */
async function lockPlan(client: PoolClient, planId: number): Promise<{
  id: number; patientId: number; status: PlanStatus; consentAt: Date | null;
  baseCurrency: Currency; totalFromItems: boolean;
} | null> {
  const { rows } = await client.query<{
    id: number; patient_id: number; status: string; consent_at: Date | null;
    base_currency: string; total_from_items: boolean;
  }>(
    `SELECT id, patient_id, status, consent_at, base_currency, total_from_items
       FROM treatment_plans WHERE id = $1 FOR UPDATE`,
    [planId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id, patientId: row.patient_id, status: row.status as PlanStatus,
    consentAt: row.consent_at, baseCurrency: row.base_currency as Currency,
    totalFromItems: row.total_from_items,
  };
}

/**
 * يعيد حساب إجمالي الخطة من بنودها.
 *
 * يُستدعى بعد كل تغيّر في البنود — وهو ما يجعل «الإجمالي» و«مجموع البنود» رقمًا
 * واحدًا لا رقمين يفترقان بعد أول تعديل يُنسى.
 */
async function recomputePlanTotal(client: PoolClient, planId: number): Promise<number> {
  const { rows } = await client.query<{ id: number; quantity: number; unit_price_minor: string; status: string }>(
    `SELECT id, quantity, unit_price_minor, status FROM plan_items WHERE plan_id = $1`, [planId],
  );
  const total = itemsTotal(rows.map((row): PlanItemLike => ({
    serviceId: null, toothCode: null,
    quantity: row.quantity, unitPriceMinor: toMinor(row.unit_price_minor),
    status: row.status as PlanItemStatus,
  })));
  await client.query(
    `UPDATE treatment_plans SET total_minor = $2, total_from_items = TRUE WHERE id = $1`,
    [planId, total],
  );
  return total;
}

export async function addPlanItem(input: {
  planId: number;
  serviceId: number | null;
  serviceName: string;
  category: string | null;
  toothCode: number | null;
  surfaces: string | null;
  quantity: number;
  unitPriceMinor: number;
  note: string | null;
}): Promise<PlanGuard & { totalMinor?: number }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const plan = await lockPlan(client, input.planId);
    if (!plan) { await client.query("ROLLBACK"); return { ok: false, message: "الخطة غير موجودة." }; }

    const allowed = canEditItems({ status: plan.status, consentAt: plan.consentAt?.toISOString() ?? null });
    if (!allowed.ok) { await client.query("ROLLBACK"); return allowed; }
    if((await client.query('SELECT id FROM plan_installments WHERE plan_id=$1 LIMIT 1',[plan.id])).rowCount){await client.query('ROLLBACK');return {ok:false,message:'للخطة أقساط قائمة؛ لا تغيّر بنود اتفاقها المالي.'};}

    if (input.toothCode !== null && !isValidTooth(input.toothCode)) {
      await client.query("ROLLBACK");
      return { ok: false, message: "رقم سنّ غير صحيح بالترقيم الدولي." };
    }

    await client.query(
      `INSERT INTO plan_items
         (plan_id, service_id, service_name, category, tooth_code, surfaces,
          quantity, unit_price_minor, note, sort_order)
       VALUES ($1, $2, $3, $4::text, $5, $6::text, $7, $8, $9::text,
               COALESCE((SELECT MAX(sort_order) + 1 FROM plan_items WHERE plan_id = $1), 100))`,
      [
        input.planId, input.serviceId, input.serviceName.trim(), input.category,
        input.toothCode, normalizeSurfaces(input.surfaces),
        Math.max(1, Math.round(input.quantity)), Math.max(0, Math.round(input.unitPriceMinor)),
        input.note?.trim() || null,
      ],
    );
    const totalMinor = await recomputePlanTotal(client, input.planId);
    await client.query("COMMIT");
    return { ok: true, totalMinor };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * يحذف بندًا **قبل** الموافقة فقط.
 *
 * ما قبل الموافقة مسوّدة يُصحَّح فيها بحرّية، وما بعدها وثيقةٌ وقّعها المريض. ولذلك
 * لا يوجد «حذف بند» بعد الموافقة أصلًا — لا إلغاء ولا شطب: الوثيقة تبقى كما وُقّعت،
 * والمستجدّ يُوثَّق بخطةٍ جديدة.
 */
export async function removePlanItem(planId: number, itemId: number): Promise<PlanGuard> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const plan = await lockPlan(client, planId);
    if (!plan) { await client.query("ROLLBACK"); return { ok: false, message: "الخطة غير موجودة." }; }

    const allowed = canEditItems({ status: plan.status, consentAt: plan.consentAt?.toISOString() ?? null });
    if (!allowed.ok) { await client.query("ROLLBACK"); return allowed; }
    if((await client.query('SELECT id FROM plan_installments WHERE plan_id=$1 LIMIT 1',[plan.id])).rowCount){await client.query('ROLLBACK');return {ok:false,message:'للخطة أقساط قائمة؛ لا تغيّر بنود اتفاقها المالي.'};}

    const { rowCount } = await client.query(
      `DELETE FROM plan_items WHERE id = $1 AND plan_id = $2`, [itemId, planId],
    );
    if ((rowCount ?? 0) === 0) { await client.query("ROLLBACK"); return { ok: false, message: "البند غير موجود." }; }

    await recomputePlanTotal(client, planId);
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * يسجّل موافقة المريض — وهي اللحظة التي تصير فيها المسوّدة اتفاقًا.
 *
 * وفيها تنتقل بنود الخطة إلى **المخطط السني** بوصفها حالاتٍ مخطَّطة: قبل الموافقة
 * كانت نيّةً في رأس الطبيب، وبعدها صارت عملًا متفَقًا عليه يجب أن يراه كل من يفتح
 * ملف المريض — بما فيهم طبيبٌ آخر يستلم الحالة غدًا.
 */
export async function recordPlanConsent(input: {
  planId: number;
  actor: string;
  note: string | null;
  schedule?: {count:number;everyDays:number;firstDueDate:string};
}): Promise<PlanGuard & { itemCount?: number; totalMinor?: number }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const plan = await lockPlan(client, input.planId);
    if (!plan) { await client.query("ROLLBACK"); return { ok: false, message: "الخطة غير موجودة." }; }

    const { rows: itemRows } = await client.query<{
      id: number; category: string | null; catalog_code: string | null; tooth_code: number | null;
      surfaces: string | null; quantity: number; unit_price_minor: string; status: string;
    }>(
      `SELECT i.id,i.category,s.catalog_code,i.tooth_code,i.surfaces,i.quantity,i.unit_price_minor,i.status
         FROM plan_items i LEFT JOIN services s ON s.id=i.service_id WHERE i.plan_id=$1 ORDER BY i.sort_order,i.id`,
      [input.planId],
    );

    const guard = canConsent({
      status: plan.status,
      consentAt: plan.consentAt?.toISOString() ?? null,
      items: itemRows.map((row) => ({
        serviceId: null, toothCode: row.tooth_code,
        quantity: row.quantity, unitPriceMinor: toMinor(row.unit_price_minor),
        status: row.status as PlanItemStatus,
      })),
    });
    if (!guard.ok) { await client.query("ROLLBACK"); return guard; }

    const totalMinor = await recomputePlanTotal(client, input.planId);
    if(input.schedule) {
      const {count,everyDays,firstDueDate}=input.schedule;
      if(!Number.isSafeInteger(count)||count<1||count>60||!Number.isSafeInteger(everyDays)||everyDays<1||everyDays>365||totalMinor<=0) {
        await client.query('ROLLBACK');return {ok:false,message:'راجع عدد الأقساط ومدتها وإجمالي الخطة.'};
      }
      if((await client.query('SELECT id FROM plan_installments WHERE plan_id=$1 LIMIT 1',[input.planId])).rowCount){await client.query('ROLLBACK');return {ok:false,message:'للخطة جدول أقساط قائم.'};}
      for(const item of splitInstallments(totalMinor,count,firstDueDate,everyDays)) {
        await client.query('INSERT INTO plan_installments(plan_id,number,due_date,amount_minor) VALUES($1,$2,$3::date,$4)',[input.planId,item.number,item.dueDate,item.amountMinor]);
      }
    }
    await client.query(
      `UPDATE treatment_plans SET consent_at = NOW(), consent_by = $2, consent_note = $3::text
         WHERE id = $1`,
      [input.planId, input.actor, input.note?.trim() || null],
    );

    // البنود على المخطط: حالاتٌ مخطَّطة لا منجَزة — والفرق بينهما نصف قيمة المخطط.
    let charted = 0;
    for (const row of itemRows) {
      const condition = conditionForCategory(row.category, row.catalog_code);
      if (!condition || row.tooth_code === null) continue;
      await client.query(
        `INSERT INTO tooth_conditions
           (patient_id, tooth_code, condition, stage, surfaces, note, recorded_by)
         VALUES ($1, $2, $3, 'planned', $4::text, $5::text, $6)`,
        [
          plan.patientId, row.tooth_code, condition, normalizeSurfaces(row.surfaces),
          `من خطة العلاج رقم ${input.planId}`, input.actor,
        ],
      );
      charted += 1;
    }

    await client.query("COMMIT");
    void recordAudit({
      action: "plan.consent",
      entity: "treatment_plans",
      entityId: input.planId,
      entityLabel: `خطة رقم ${input.planId}`,
      details: { البنود: itemRows.length, "على المخطط": charted },
      actor: input.actor,
    });
    return { ok: true, itemCount: itemRows.length, totalMinor };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * يبني جدول الأقساط لخطةٍ موافَقٍ عليها.
 *
 * ولا يُبنى قبل الموافقة عمدًا: الأقساط تُشتقّ من الإجمالي، والإجمالي لا يستقرّ إلا
 * بالموافقة. وجدولٌ يُبنى على رقمٍ ما زال يتغيّر جدولٌ يُعاد بناؤه — وكل إعادةٍ فرصةٌ
 * لأن يبقى قسطٌ قديمٌ معلّقًا في مكانٍ ما.
 */
export async function schedulePlanInstallments(input: {
  planId: number;
  count: number;
  everyDays: number;
  firstDueDate: string;
}): Promise<PlanGuard & { count?: number }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const plan = await lockPlan(client, input.planId);
    if (!plan) { await client.query("ROLLBACK"); return { ok: false, message: "الخطة غير موجودة." }; }
    if (!plan.consentAt) {
      await client.query("ROLLBACK");
      return { ok: false, message: "سجّل موافقة المريض قبل جدولة الأقساط." };
    }

    const { rows: existing } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM plan_installments WHERE plan_id = $1`, [input.planId],
    );
    if (Number(existing[0].count) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, message: "للخطة جدول أقساط سلفًا." };
    }

    const billed=await client.query(`SELECT 1 FROM plan_items i JOIN visits v ON v.id=i.visit_id
      WHERE i.plan_id=$1 AND v.invoice_id IS NOT NULL LIMIT 1`,[input.planId]);
    if (billed.rowCount) {await client.query('ROLLBACK');return {ok:false,message:'نُفّذت وفُوترت بنود من الخطة. لا يمكن تحويلها إلى أقساط تُصدر فواتير مكررة؛ حصّل دفعاتها من حساب المريض.'};}
    const { rows: totals } = await client.query<{ total_minor: string }>(
      `SELECT total_minor FROM treatment_plans WHERE id = $1`, [input.planId],
    );
    const totalMinor = toMinor(totals[0].total_minor);
    if (totalMinor <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, message: "لا يمكن جدولة أقساط لخطة بلا مبلغ." };
    }

    const parts = splitInstallments(totalMinor, input.count, input.firstDueDate, input.everyDays);
    for (const part of parts) {
      await client.query(
        `INSERT INTO plan_installments (plan_id, number, due_date, amount_minor)
         VALUES ($1, $2, $3::date, $4)`,
        [input.planId, part.number, part.dueDate, part.amountMinor],
      );
    }
    await client.query("COMMIT");
    return { ok: true, count: parts.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * يسجّل قسطًا: فاتورة بقيمته ودفعة عليها، في معاملة واحدة داخل الوردية المفتوحة.
 *
 * **الإيراد يُثبت مع القسط لا مع الاتفاق.** فوترةُ الخطة كاملة يوم توقيعها تجعل
 * المريض «مدينًا بمليون» من أول يوم وتُثبت إيرادًا لعلاج لم يُقدَّم بعد — وهو مخالف
 * لمعيار إثبات الإيراد على مدى تقديم الخدمة. فكل قسط فاتورته يوم يُقبض.
 *
 * والاثنان في معاملة واحدة: فاتورةٌ بلا دفعتها تجعل المريض مدينًا بمبلغ دفعه للتو،
 * ودفعةٌ بلا فاتورتها تجعل له رصيدًا عندنا بلا سبب.
 */
export async function recordPlanInstallment(input: {
  planId: number;
  patientId: number;
  installmentNumber: number;
  planTitle: string;
  amountMinor: number;
  currency: Currency;
  baseCurrency: Currency;
  exchangeRate: number;
  method: string;
  note: string | null;
  createdBy: string;
}): Promise<{ invoiceId: number; paymentId: number } | { reason: "no_shift" | "invalid_plan" | "exceeds_balance" }> {
  await ensureSchema();
  const baseAmount = toBaseAmount(
    input.amountMinor, input.currency, input.baseCurrency, input.exchangeRate,
  );

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rows: shifts } = await client.query<{ id: number }>(
      `SELECT id FROM cashier_shifts WHERE status = 'open' LIMIT 1 FOR UPDATE`,
    );
    if (!shifts[0]) { await client.query("ROLLBACK"); return { reason: "no_shift" }; }

    const agreement=(await client.query(`SELECT * FROM treatment_plans WHERE id=$1 FOR UPDATE`,[input.planId])).rows[0];
    const schedule=(await client.query(`SELECT amount_minor FROM plan_installments WHERE plan_id=$1 ORDER BY number`,[input.planId])).rows;
    if(!agreement||agreement.patient_id!==input.patientId||agreement.status!=='active'||agreement.base_currency!==input.baseCurrency||!schedule.length||!Number.isSafeInteger(baseAmount)||baseAmount<=0) {
      await client.query('ROLLBACK');return {reason:'invalid_plan'};
    }
    const paid=Number((await client.query(`SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -base_amount_minor ELSE base_amount_minor END),0) paid FROM payments WHERE plan_id=$1`,[input.planId])).rows[0].paid);
    if(baseAmount>Number(agreement.total_minor)-paid){await client.query('ROLLBACK');return {reason:'exceeds_balance'};}
    let cumulative=0,installmentNumber=schedule.length;
    for(const [index,entry] of schedule.entries()){cumulative+=Number(entry.amount_minor);if(paid<cumulative){installmentNumber=index+1;break;}}
    const description = `${agreement.title} — قسط ${installmentNumber}`;
    const { rows: invoices } = await client.query<{ id: number }>(
      `INSERT INTO invoices (invoice_number, patient_id, total_minor, discount_minor, base_currency, note, created_by, plan_id)
       VALUES (
         'INV-' || LPAD(nextval('invoice_number_seq')::text, 5, '0'),
         $1, $2, 0, $3, $4::text, $5, $6)
       RETURNING id`,
      [input.patientId, baseAmount, input.baseCurrency, input.note, input.createdBy, input.planId],
    );
    const invoiceId = invoices[0].id;

    await client.query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_minor, total_minor)
       VALUES ($1, $2, 1, $3, $3)`,
      [invoiceId, description, baseAmount],
    );

    const { rows: payments } = await client.query<{ id: number }>(
      `INSERT INTO payments (
         receipt_number, patient_id, invoice_id, shift_id, kind, amount_minor, currency,
         exchange_rate, base_amount_minor, base_currency, method, note, created_by, plan_id)
       VALUES (
         'R-' || LPAD(nextval('receipt_number_seq')::text, 5, '0'),
         $1, $2, $3, 'payment', $4, $5, $6, $7, $8, $9, $10::text, $11, $12)
       RETURNING id`,
      [
        input.patientId, invoiceId, shifts[0].id, input.amountMinor, input.currency,
        input.exchangeRate, baseAmount, input.baseCurrency, input.method, input.note,
        input.createdBy, input.planId,
      ],
    );

    await client.query(
      `UPDATE invoices SET status = 'paid' WHERE id = $1`, [invoiceId],
    );

    await client.query("COMMIT");
    return { invoiceId, paymentId: payments[0].id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── الأشعة والمستندات ───────────────────────────────────────────────────────

import { type DocumentKind } from "./storage";

/**
 * وصفُ ملفٍّ في سجل المريض — والملفّ نفسه على القرص لا هنا.
 */
export interface PatientDocument {
  id: number;
  patientId: number;
  visitId: number | null;
  kind: DocumentKind;
  title: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  note: string | null;
  takenOn: string | null;
  uploadedBy: string;
  uploadedAt: string;
  removedAt: string | null;
  removedBy: string | null;
  removedNote: string | null;
  /** بالبكسل — تدخل نسبتُها في حساب كل زاوية سيفالومترية. `null` لما لا يُقرأ. */
  imageWidth: number | null;
  imageHeight: number | null;
}

interface DocumentRow {
  id: number; patient_id: number; visit_id: number | null; kind: string; title: string;
  mime_type: string; size_bytes: string; note: string | null; taken_on: Date | null;
  uploaded_by: string; uploaded_at: Date; removed_at: Date | null;
  removed_by: string | null; removed_note: string | null;
  image_width: number | null; image_height: number | null;
}

const toDocument = (row: DocumentRow): PatientDocument => ({
  id: row.id,
  patientId: row.patient_id,
  visitId: row.visit_id,
  kind: row.kind as DocumentKind,
  title: row.title,
  mimeType: row.mime_type,
  sizeBytes: toMinor(row.size_bytes),
  isImage: row.mime_type.startsWith("image/"),
  note: row.note,
  takenOn: row.taken_on ? dateText(row.taken_on) : null,
  uploadedBy: row.uploaded_by,
  uploadedAt: row.uploaded_at.toISOString(),
  removedAt: row.removed_at ? row.removed_at.toISOString() : null,
  removedBy: row.removed_by,
  removedNote: row.removed_note,
  imageWidth: row.image_width ?? null,
  imageHeight: row.image_height ?? null,
});

const DOCUMENT_COLUMNS = `id, patient_id, visit_id, kind, title, mime_type, size_bytes,
       note, taken_on, uploaded_by, uploaded_at, removed_at, removed_by, removed_note,
       image_width, image_height`;

/**
 * ملفّات المريض.
 *
 * المخفيّة تُعرض للمدير وحده ومعلَّمةً بذلك: إخفاءُ صورةٍ قرارٌ يُراجَع، وإخفاؤها
 * عن المراجِع نفسه يجعل الإخفاء محوًا.
 */
export async function listPatientDocuments(
  patientId: number,
  includeRemoved = false,
): Promise<PatientDocument[]> {
  await ensureSchema();
  const { rows } = await getPool().query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM patient_documents
      WHERE patient_id = $1 ${includeRemoved ? "" : "AND removed_at IS NULL"}
      ORDER BY COALESCE(taken_on, uploaded_at::date) DESC, id DESC`,
    [patientId],
  );
  return rows.map(toDocument);
}

/** الوصف مع مفتاح التخزين — للتنزيل وحده، ولا يخرج المفتاح إلى المتصفّح أبدًا. */
/** مستندٌ واحد بعينه — للتقرير الذي يُطبع عنه. */
export async function getPatientDocument(id: number): Promise<PatientDocument | null> {
  await ensureSchema();
  const { rows } = await getPool().query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM patient_documents WHERE id = $1 AND removed_at IS NULL`,
    [id],
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

export async function getDocumentForDownload(id: number): Promise<
  { document: PatientDocument; storageKey: string } | null
> {
  await ensureSchema();
  const { rows } = await getPool().query<DocumentRow & { storage_key: string }>(
    `SELECT ${DOCUMENT_COLUMNS}, storage_key FROM patient_documents WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { document: toDocument(rows[0]), storageKey: rows[0].storage_key };
}

export async function recordDocument(input: {
  patientId: number;
  visitId: number | null;
  kind: DocumentKind;
  title: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  note: string | null;
  takenOn: string | null;
  uploadedBy: string;
  /** من ترويسة الملف. الغياب مقبول: مستندٌ PDF لا أبعادَ صورةٍ له. */
  imageWidth?: number | null;
  imageHeight?: number | null;
}): Promise<PatientDocument> {
  await ensureSchema();
  const { rows } = await getPool().query<DocumentRow>(
    `INSERT INTO patient_documents
       (patient_id, visit_id, kind, title, mime_type, size_bytes, sha256, storage_key,
        note, taken_on, uploaded_by, image_width, image_height)
     VALUES ($1, $2::int, $3, $4, $5, $6, $7, $8, $9::text, $10::date, $11, $12::int, $13::int)
     RETURNING ${DOCUMENT_COLUMNS}`,
    [
      input.patientId, input.visitId, input.kind, input.title.trim(), input.mimeType,
      input.sizeBytes, input.sha256, input.storageKey,
      input.note?.trim() || null, input.takenOn, input.uploadedBy,
      input.imageWidth ?? null, input.imageHeight ?? null,
    ],
  );
  return toDocument(rows[0]);
}

/**
 * أبعاد صورةٍ سُجّلت قبل أن تُحفظ الأبعاد — تُملأ مرّةً من ترويسة الملف.
 *
 * ولا تُكتب فوق قيمةٍ موجودة: الملء علاجٌ للماضي لا مصدرٌ ثانٍ للحقيقة.
 */
export async function backfillDocumentSize(input: {
  id: number; width: number; height: number;
}): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE patient_documents SET image_width = $2, image_height = $3
      WHERE id = $1 AND (image_width IS NULL OR image_height IS NULL)`,
    [input.id, input.width, input.height],
  );
}

/**
 * إخفاء مستند — لا محوه.
 *
 * السجل الطبي شهادة، ومن يمحو بصمت يمكن أن يمحو بعد شكوى. فيبقى الصف ويبقى
 * الملف، ويُسجَّل من أخفاه ومتى **ولماذا** — والسبب إلزامي: «أُخفي بلا سبب» ليس
 * تفسيرًا يُقرأ بعد سنة.
 */
export async function removeDocument(input: {
  id: number; actor: string; note: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  const reason = input.note.trim();
  if (reason.length < 3) return { ok: false, message: "اكتب سبب الإخفاء." };
  const { rowCount } = await getPool().query(
    `UPDATE patient_documents SET removed_at = NOW(), removed_by = $2, removed_note = $3
      WHERE id = $1 AND removed_at IS NULL`,
    [input.id, input.actor, reason],
  );
  if ((rowCount ?? 0) === 0) return { ok: false, message: "المستند غير موجود أو مخفيٌّ سلفًا." };
  return { ok: true };
}

/** كل المستندات القائمة مع ما يكفي لتسميتها في الأرشيف بلا البرنامج. */
export async function documentsForArchive(): Promise<{
  id: number; patientNumber: string; patientName: string; kind: string;
  title: string; takenOn: string | null; uploadedAt: Date; storageKey: string;
}[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    id: number; patient_number: string; full_name: string; kind: string;
    title: string; taken_on: Date | null; uploaded_at: Date; storage_key: string;
  }>(
    `SELECT d.id, p.patient_number, p.full_name, d.kind, d.title, d.taken_on,
            d.uploaded_at, d.storage_key
       FROM patient_documents d JOIN patients p ON p.id = d.patient_id
      WHERE d.removed_at IS NULL
      ORDER BY p.patient_number, d.id`,
  );
  return rows.map((row) => ({
    id: row.id,
    patientNumber: row.patient_number,
    patientName: row.full_name,
    kind: row.kind,
    title: row.title,
    takenOn: row.taken_on ? dateText(row.taken_on) : null,
    uploadedAt: row.uploaded_at,
    storageKey: row.storage_key,
  }));
}

// ─── التقويم ─────────────────────────────────────────────────────────────────

import {
  canComplete, caseProgress, dueState, followUpSummary, latenessDays,
  nextFollowUpDue, nextWire, sortByLateness,
  type Appliance, type Arches, type CaseProgress, type CaseStatus,
  type ElasticClass, type FollowUpCase, type OrthoPhase, type RetainerType, type SlotSize,
} from "./ortho";

export interface OrthoCase {
  id: number;
  patientId: number;
  patientName: string;
  /** للمتابعة: قائمةُ من انقطع بلا رقمٍ يُتّصل به قائمةٌ تُقرأ ولا تُنفَّذ. */
  patientPhone: string | null;
  appliance: Appliance;
  arches: Arches;
  slot: SlotSize;
  bracketSystem: string | null;
  status: CaseStatus;
  phase: OrthoPhase;
  startDate: string;
  plannedMonths: number;
  upperWire: string | null;
  lowerWire: string | null;
  planId: number | null;
  retainer: RetainerType | null;
  retainerOn: string | null;
  note: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closedNote: string | null;
  adjustments: OrthoAdjustment[];
  progress: CaseProgress;
}

export interface OrthoAdjustment {
  id: number;
  visitId: number | null;
  doneOn: string;
  phase: OrthoPhase | null;
  upperWire: string | null;
  lowerWire: string | null;
  elastics: ElasticClass;
  elasticNote: string | null;
  done: string | null;
  nextWeeks: number;
  note: string | null;
  recordedBy: string;
}

interface CaseRow {
  id: number; patient_id: number; full_name: string; phone: string | null;
  appliance: string; arches: string;
  slot: string; bracket_system: string | null; status: string; phase: string;
  start_date: Date; planned_months: number; upper_wire: string | null;
  lower_wire: string | null; plan_id: number | null; retainer: string | null;
  retainer_on: Date | null; note: string | null; closed_at: Date | null;
  closed_by: string | null; closed_note: string | null;
}

interface AdjustmentRow {
  id: number; case_id: number; visit_id: number | null; done_on: Date; phase: string | null;
  upper_wire: string | null; lower_wire: string | null; elastics: string;
  elastic_note: string | null; done: string | null; next_weeks: number;
  note: string | null; recorded_by: string;
}

const CASE_SELECT = `
  SELECT c.id, c.patient_id, p.full_name, p.phone, c.appliance, c.arches, c.slot, c.bracket_system,
         c.status, c.phase, c.start_date, c.planned_months, c.upper_wire, c.lower_wire,
         c.plan_id, c.retainer, c.retainer_on, c.note, c.closed_at, c.closed_by, c.closed_note
    FROM ortho_cases c JOIN patients p ON p.id = c.patient_id`;

const toAdjustment = (row: AdjustmentRow): OrthoAdjustment => ({
  id: row.id,
  visitId: row.visit_id,
  doneOn: dateText(row.done_on),
  phase: (row.phase as OrthoPhase) ?? null,
  upperWire: row.upper_wire,
  lowerWire: row.lower_wire,
  elastics: row.elastics as ElasticClass,
  elasticNote: row.elastic_note,
  done: row.done,
  nextWeeks: row.next_weeks,
  note: row.note,
  recordedBy: row.recorded_by,
});

async function hydrateCases(rows: CaseRow[], today: string): Promise<OrthoCase[]> {
  if (rows.length === 0) return [];
  const { rows: adjustmentRows } = await getPool().query<AdjustmentRow>(
    `SELECT id, case_id, visit_id, done_on, phase, upper_wire, lower_wire, elastics,
            elastic_note, done, next_weeks, note, recorded_by
       FROM ortho_adjustments WHERE case_id = ANY($1::int[])
      ORDER BY case_id, done_on DESC, id DESC`,
    [rows.map((row) => row.id)],
  );
  const byCase = new Map<number, OrthoAdjustment[]>();
  for (const row of adjustmentRows) {
    const list = byCase.get(row.case_id) ?? [];
    list.push(toAdjustment(row));
    byCase.set(row.case_id, list);
  }

  return rows.map((row) => {
    const adjustments = byCase.get(row.id) ?? [];
    return {
      id: row.id,
      patientId: row.patient_id,
      patientName: row.full_name,
      patientPhone: row.phone,
      appliance: row.appliance as Appliance,
      arches: row.arches as Arches,
      slot: row.slot as SlotSize,
      bracketSystem: row.bracket_system,
      status: row.status as CaseStatus,
      phase: row.phase as OrthoPhase,
      startDate: dateText(row.start_date),
      plannedMonths: row.planned_months,
      upperWire: row.upper_wire,
      lowerWire: row.lower_wire,
      planId: row.plan_id,
      retainer: (row.retainer as RetainerType) ?? null,
      retainerOn: row.retainer_on ? dateText(row.retainer_on) : null,
      note: row.note,
      closedAt: row.closed_at ? row.closed_at.toISOString() : null,
      closedBy: row.closed_by,
      closedNote: row.closed_note,
      adjustments,
      progress: caseProgress({
        startDate: dateText(row.start_date),
        plannedMonths: row.planned_months,
        adjustments: adjustments.length,
        lastAdjustmentDate: adjustments[0]?.doneOn ?? null,
        today,
      }),
    };
  });
}

export async function listPatientOrthoCases(patientId: number, today: string): Promise<OrthoCase[]> {
  await ensureSchema();
  const { rows } = await getPool().query<CaseRow>(
    `${CASE_SELECT} WHERE c.patient_id = $1 ORDER BY c.created_at DESC`, [patientId],
  );
  return hydrateCases(rows, today);
}

export interface OrthoFollowUp extends FollowUpCase {
  patientId: number;
  patientPhone: string | null;
  phase: OrthoPhase;
  lastAdjustment: string | null;
  daysSinceLast: number | null;
  upperWire: string | null;
  lowerWire: string | null;
}

/**
 * حالات التقويم مرتَّبةً بالانقطاع — ومن يُشتقّ منها العدّاد.
 *
 * وتُبنى على `listOrthoCases` نفسها لا باستعلامٍ ثانٍ: القائمة هنا والقائمة في
 * ملفّ المريض يجب أن تقولا الشيء نفسه عن الحالة نفسها. والحالات مئاتٌ في مركزٍ
 * بكرسيين — لا تنمو مع الأيام كما تنمو الفواتير — فقراءتها كاملةً أرخص من قاعدةٍ
 * ثانية تفترق عن الأولى بصمت.
 *
 * والموعد من **مهلة آخر شدّة كما حدّدها الطبيب** (`nextWeeks`)، لا من متوسّطٍ عام:
 * قولُه لحالته أدقّ من أي رقمٍ نضعه له. والافتراضي من الإعدادات حين لا يقول.
 */
export async function listOrthoFollowUp(input: {
  today: string; adjustWeeks: number; retentionWeeks: number;
}): Promise<OrthoFollowUp[]> {
  // بلا اقتطاع: من يسقط بالحدّ هو الأقدم، وهو أولى من يتأخّر.
  const cases = await listOrthoCases(input.today, undefined, 5000);
  return sortByLateness(cases.map((one) => {
    const last = one.adjustments[0] ?? null;
    const dueOn = nextFollowUpDue({
      status: one.status,
      startDate: one.startDate,
      // التثبيت يُقاس من تسليم المثبّت لا من مهلة آخر شدّة قبل نزع الجهاز.
      retainerOn: one.retainerOn,
      lastAdjustment: last?.doneOn ?? null,
      lastNextWeeks: last?.nextWeeks ?? null,
      adjustWeeks: input.adjustWeeks,
      retentionWeeks: input.retentionWeeks,
    });
    return {
      id: one.id,
      patientId: one.patientId,
      patientName: one.patientName,
      patientPhone: one.patientPhone,
      status: one.status,
      phase: one.phase,
      dueOn,
      due: dueState(dueOn, input.today),
      lateDays: latenessDays(dueOn, input.today),
      lastAdjustment: one.progress.lastAdjustment,
      daysSinceLast: one.progress.daysSinceLast,
      upperWire: one.upperWire,
      lowerWire: one.lowerWire,
    };
  }));
}

/** أرقام العدّاد — من القائمة نفسها التي تُعرض، لا من عدٍّ ثانٍ. */
export async function orthoCounts(input: {
  today: string; adjustWeeks: number; retentionWeeks: number;
}): Promise<{ overdue: number; dueThisWeek: number; retentionDue: number }> {
  return followUpSummary(await listOrthoFollowUp(input));
}

export async function getOrthoCase(id: number, today: string): Promise<OrthoCase | null> {
  await ensureSchema();
  const { rows } = await getPool().query<CaseRow>(`${CASE_SELECT} WHERE c.id = $1`, [id]);
  return (await hydrateCases(rows, today))[0] ?? null;
}

/** الحالة المفتوحة لمريض — لشاشة الزيارة، فيرى الطبيب السلك قبل أن يبدأ. */
export async function openOrthoCaseFor(patientId: number, today: string): Promise<OrthoCase | null> {
  await ensureSchema();
  const { rows } = await getPool().query<CaseRow>(
    `${CASE_SELECT} WHERE c.patient_id = $1 AND c.status IN ('active','retention')
      ORDER BY c.created_at DESC LIMIT 1`,
    [patientId],
  );
  return (await hydrateCases(rows, today))[0] ?? null;
}

/**
 * حالات التقويم.
 *
 * و`limit` يُرفع للمتابعة عمدًا: الترتيب `start_date DESC` يجعل حدَّ الثلاثمئة يقطع
 * **الأقدم** — وهم أولى من يتأخّر عن شدّته. فقائمةُ المتأخّرين كانت ستُسقط أحقّ
 * الناس بالظهور فيها، بلا أن تقول إنها أسقطت أحدًا.
 */
export async function listOrthoCases(
  today: string, status?: CaseStatus, limit = 300,
): Promise<OrthoCase[]> {
  await ensureSchema();
  const cap = Math.max(1, Math.min(5000, Math.round(limit)));
  const { rows } = await getPool().query<CaseRow>(
    status
      ? `${CASE_SELECT} WHERE c.status = $1 ORDER BY c.start_date DESC LIMIT ${cap}`
      : `${CASE_SELECT} WHERE c.status IN ('active','retention') ORDER BY c.start_date DESC LIMIT ${cap}`,
    status ? [status] : [],
  );
  return hydrateCases(rows, today);
}

export async function createOrthoCase(input: {
  patientId: number;
  appliance: Appliance;
  arches: Arches;
  slot: SlotSize;
  bracketSystem: string | null;
  startDate: string;
  plannedMonths: number;
  planId: number | null;
  note: string | null;
  createdBy: string;
}): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();
  try {
    const { rows } = await getPool().query<{ id: number }>(
      `INSERT INTO ortho_cases
         (patient_id, appliance, arches, slot, bracket_system, start_date,
          planned_months, plan_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5::text, $6::date, $7, $8::int, $9::text, $10)
       RETURNING id`,
      [
        input.patientId, input.appliance, input.arches, input.slot,
        input.bracketSystem?.trim() || null, input.startDate,
        Math.max(1, Math.min(120, Math.round(input.plannedMonths))),
        input.planId, input.note?.trim() || null, input.createdBy,
      ],
    );
    return { ok: true, id: rows[0].id };
  } catch (error) {
    // الفهرس الفريد يمنع حالتين مفتوحتين — والرسالة تقول السبب لا رقم الخطأ.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "للمريض حالة تقويم مفتوحة سلفًا. أغلقها قبل فتح حالة جديدة." };
    }
    throw error;
  }
}

/**
 * يسجّل شدّةً، ويحدّث سلك الحالة في المعاملة نفسها.
 *
 * السلك الحالي يُقرأ من صفّ الحالة لا يُحسب من السجل — فيُعرض على شاشة الزيارة بلا
 * استعلامٍ ثانٍ. وثمن ذلك أن يبقى الاثنان متّفقين، ولذلك يُكتبان معًا: شدّةٌ تُسجَّل
 * بلا تحديث السلك تجعل الشاشة تقول سلكًا والسجل يقول آخر.
 */
export async function recordAdjustment(input: {
  caseId: number;
  visitId: number | null;
  doneOn: string;
  phase: OrthoPhase | null;
  upperWire: string | null;
  lowerWire: string | null;
  elastics: ElasticClass;
  elasticNote: string | null;
  done: string | null;
  nextWeeks: number;
  note: string | null;
  recordedBy: string;
}): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cases } = await client.query<{ status: string; upper_wire: string | null; lower_wire: string | null }>(
      `SELECT status, upper_wire, lower_wire FROM ortho_cases WHERE id = $1 FOR UPDATE`,
      [input.caseId],
    );
    if (!cases[0]) { await client.query("ROLLBACK"); return { ok: false, message: "الحالة غير موجودة." }; }
    if (cases[0].status === "completed" || cases[0].status === "discontinued") {
      await client.query("ROLLBACK");
      return { ok: false, message: "الحالة مغلقة — لا تُسجَّل عليها شدّات." };
    }

    // سلكٌ لم يُغيَّر يبقى كما هو: الطبيب يترك الحقل فارغًا حين لا يبدّل السلك،
    // وتفسيرُ الفراغ «أُزيل السلك» يمحو الحقيقة بصمت.
    const upper = input.upperWire?.trim() || cases[0].upper_wire;
    const lower = input.lowerWire?.trim() || cases[0].lower_wire;

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO ortho_adjustments
         (case_id, visit_id, done_on, phase, upper_wire, lower_wire, elastics,
          elastic_note, done, next_weeks, note, recorded_by)
       VALUES ($1, $2::int, $3::date, $4::text, $5::text, $6::text, $7, $8::text,
               $9::text, $10, $11::text, $12)
       RETURNING id`,
      [
        input.caseId, input.visitId, input.doneOn, input.phase, upper, lower,
        input.elastics, input.elasticNote?.trim() || null, input.done?.trim() || null,
        Math.max(1, Math.min(52, Math.round(input.nextWeeks))),
        input.note?.trim() || null, input.recordedBy,
      ],
    );

    await client.query(
      `UPDATE ortho_cases SET upper_wire = $2::text, lower_wire = $3::text,
              phase = COALESCE($4::text, phase)
        WHERE id = $1`,
      [input.caseId, upper, lower, input.phase],
    );
    await client.query("COMMIT");
    return { ok: true, id: rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function setOrthoPhase(id: number, phase: OrthoPhase): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE ortho_cases SET phase = $2 WHERE id = $1 AND status IN ('active','retention')`,
    [id, phase],
  );
  return (rowCount ?? 0) > 0;
}

/** يسجّل المثبّت — وهو شرط إغلاق الحالة. */
export async function setRetainer(input: {
  id: number; retainer: RetainerType; deliveredOn: string | null;
}): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE ortho_cases SET retainer = $2, retainer_on = $3::date,
            status = CASE WHEN status = 'active' THEN 'retention' ELSE status END
      WHERE id = $1 AND status IN ('active','retention')`,
    [input.id, input.retainer, input.deliveredOn],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * يُغلق الحالة.
 *
 * ويشترط المثبّت: حالةٌ تُغلق بلا مثبّت هي أكثر ما يُفسد نتيجة سنتين — الأسنان
 * ترتدّ، ويعود المريض بعد عامٍ فيجد النتيجة ضاعت فيلوم المركز بحق.
 */
export async function closeOrthoCase(input: {
  id: number; status: "completed" | "discontinued"; actor: string; note: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string; retainer: string | null }>(
      `SELECT status, retainer FROM ortho_cases WHERE id = $1 FOR UPDATE`, [input.id],
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return { ok: false, message: "الحالة غير موجودة." }; }

    // التوقّف غير الإكمال: مريضٌ سافر أو انقطع تُغلق حالته بلا مثبّت — والشرط
    // على الإكمال وحده، لأنه الادّعاء بأن العلاج انتهى كما يجب.
    if (input.status === "completed") {
      const guard = canComplete({
        status: rows[0].status as CaseStatus,
        retainer: (rows[0].retainer as RetainerType) ?? null,
      });
      if (!guard.ok) { await client.query("ROLLBACK"); return guard; }
    } else if (rows[0].status === "completed" || rows[0].status === "discontinued") {
      await client.query("ROLLBACK");
      return { ok: false, message: "الحالة مغلقة سلفًا." };
    }

    await client.query(
      `UPDATE ortho_cases SET status = $2, closed_at = NOW(), closed_by = $3, closed_note = $4::text
        WHERE id = $1`,
      [input.id, input.status, input.actor, input.note?.trim() || null],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── التتبّع السيفالومتري ────────────────────────────────────────────────────

import {
  DEFAULT_NORMS, analyse, isLandmarkCode,
  type Analysis, type Calibration, type Norm, type Tracing,
} from "./ceph";

export interface CephTracing {
  id: number;
  documentId: number;
  patientId: number;
  points: Tracing;
  calibration: Calibration | null;
  note: string | null;
  tracedBy: string;
  tracedAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  /** يُشتقّ عند كل قراءة — ولا يُخزَّن. */
  analysis: Analysis;
}

/**
 * يُطهّر النقاط الآتية من المتصفّح.
 *
 * الرمز يجب أن يكون من القائمة المغلقة، والإحداثي كسرًا بين صفر وواحد. ونقطةٌ
 * خارج الصورة أو برمزٍ مخترَع تُهمَل بلا ضجيج — لأن نصف تتبّعٍ سليم خيرٌ من رفض
 * التتبّع كلّه بسبب حقلٍ واحد أفسده خللٌ في الشاشة.
 */
function sanitizeTracing(raw: unknown): Tracing {
  const points: Tracing = {};
  if (!raw || typeof raw !== "object") return points;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLandmarkCode(code) || !value || typeof value !== "object") continue;
    const x = Number((value as { x?: unknown }).x);
    const y = Number((value as { y?: unknown }).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    points[code] = { x, y };
  }
  return points;
}

function sanitizeCalibration(raw: unknown): Calibration | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const from = sanitizeTracing({ S: source.from }).S;
  const to = sanitizeTracing({ S: source.to }).S;
  const millimetres = Number(source.millimetres);
  if (!from || !to || !Number.isFinite(millimetres) || millimetres <= 0) return null;
  // طرفان على نقطةٍ واحدة ليسا معايرة: التحليل يرفضها عند الحساب، لكن تخزينها
  // يجعل الشاشة تقول «معايَرة» وهي ليست كذلك — فتُردّ عند الباب لا بعده.
  if (from.x === to.x && from.y === to.y) return null;
  return { from, to, millimetres };
}

const toTracing = (row: {
  id: number; document_id: number; patient_id: number; points: unknown;
  calibration: unknown; note: string | null; traced_by: string; traced_at: Date;
  updated_by: string | null; updated_at: Date | null; aspect?: number;
  norms?: Record<string, Norm>; ageYears?: number | null;
}): CephTracing => {
  const points = sanitizeTracing(row.points);
  const calibration = sanitizeCalibration(row.calibration);
  return {
    id: row.id,
    documentId: row.document_id,
    patientId: row.patient_id,
    points,
    calibration,
    note: row.note,
    tracedBy: row.traced_by,
    tracedAt: row.traced_at.toISOString(),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    analysis: analyse({
      tracing: points, calibration, aspect: row.aspect, norms: row.norms,
      ageYears: row.ageYears ?? null,
    }),
  };
};

const TRACING_COLUMNS = `id, document_id, patient_id, points, calibration, note,
       traced_by, traced_at, updated_by, updated_at`;

/* ─── المجموعات المرجعية ─────────────────────────────────────────────────── */

export type ReferenceSex = "any" | "male" | "female";

export interface ReferenceValue {
  measurement: string;
  /** `any` عامّة، وما عداها يخصّ جنسًا — والخاصّ يسبق العامّ عند القراءة. */
  sex: ReferenceSex;
  mean: number;
  tolerance: number;
  source: string;
}

export interface ReferenceSet {
  id: number;
  name: string;
  source: string;
  note: string | null;
  isDefault: boolean;
  archived: boolean;
  values: ReferenceValue[];
}

/**
 * تُنشأ المجموعة الافتراضية مرّةً، وتُملأ فجواتُها دائمًا.
 *
 * وكان الزرعُ مشروطًا بخلوّ الجدول كلّه — فمنع عودةَ القيم الأصلية فوق تعديل
 * المالك، وهو مقصود. لكنه منع معه شيئًا آخر لم يكن مقصودًا: **كلَّ معيارٍ يُضاف
 * بعد أوّل تشغيل**. أُضيفت تسعةُ معايير في دفعةٍ لاحقة، فبقيت قاعدةُ التطوير بلا
 * صفوفها — فلا يراها المالك في شاشته ولا يستطيع تعديلها، ويسقط التحليل صامتًا إلى
 * المعيار المدمج في الكود. وهو بالضبط ما بُنيت المجموعات لإخراجه منه.
 *
 * فصار الشرطان منفصلين: المجموعة تُنشأ إن لم توجد، والقيم تُدرَج دائمًا بـ
 * `DO NOTHING` — فتُملأ الفجوة ولا يُمسّ ما عدّله المالك.
 */
async function ensureReferenceSeed(): Promise<void> {
  const pool = getPool();

  /*
   * وWits وحده يُزرع بقيمتين — لأنه وحده ممّا عندنا يفرّق بالجنس في مرجعه.
   * وزرعُ صفَّين لكل قياسٍ كان سيملأ الجدول بأرقامٍ متطابقة تُوهم بتفريقٍ لا وجود له.
   */
  const bySex: Record<string, { sex: string; mean: number; tolerance: number }[]> = {
    WITS: [
      { sex: "male", mean: 1, tolerance: 2 },
      { sex: "female", mean: 0, tolerance: 2 },
    ],
  };
  const entries = Object.entries(DEFAULT_NORMS).flatMap(([key, norm]) =>
    (bySex[key] ?? [{ sex: "any", mean: norm.mean, tolerance: norm.tolerance }])
      .map((row) => ({ key, sex: row.sex, mean: row.mean, tolerance: row.tolerance, source: norm.source })));

  const { rows: existing } = await pool.query<{ id: number }>(
    `SELECT id FROM ceph_reference_sets WHERE is_default AND NOT archived LIMIT 1`,
  );
  let setId = existing[0]?.id;

  if (!setId) {
    const { rows: created } = await pool.query<{ id: number }>(
      `INSERT INTO ceph_reference_sets (name, source, note, is_default, created_by)
       VALUES ($1, $2, $3, TRUE, $4) RETURNING id`,
      [
        "المعايير الكلاسيكية",
        "Steiner · Tweed · Downs · Jarabak · Jacobson · Ricketts",
        "القيم المنشورة الأوسع استعمالًا، كلٌّ بمرجعه. وهي مأخوذة من مجتمعاتٍ غير يمنية — فتُقرأ مع الوجه لا وحدها، وللمدير أن يضيف مجموعةً محلّية ويجعلها الافتراضية.",
        "النظام",
      ],
    );
    setId = created[0].id;
  }

  await pool.query(
    `INSERT INTO ceph_reference_values (set_id, measurement, sex, mean, tolerance, source)
     SELECT $1, m, x, v, t, s
       FROM UNNEST($2::text[], $3::text[], $4::float8[], $5::float8[], $6::text[]) AS u(m, x, v, t, s)
     ON CONFLICT (set_id, measurement, sex) DO NOTHING`,
    [
      setId,
      entries.map((entry) => entry.key),
      entries.map((entry) => entry.sex),
      entries.map((entry) => entry.mean),
      entries.map((entry) => entry.tolerance),
      entries.map((entry) => entry.source),
    ],
  );
}

const toReferenceSet = (row: Record<string, unknown>, values: ReferenceValue[]): ReferenceSet => ({
  id: row.id as number,
  name: row.name as string,
  source: row.source as string,
  note: (row.note as string | null) ?? null,
  isDefault: Boolean(row.is_default),
  archived: Boolean(row.archived),
  values,
});

export async function listReferenceSets(): Promise<ReferenceSet[]> {
  await ensureSchema();
  await ensureReferenceSeed();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, source, note, is_default, archived FROM ceph_reference_sets
      ORDER BY is_default DESC, archived, id`,
  );
  const { rows: values } = await pool.query<ReferenceValue & { set_id: number }>(
    `SELECT set_id, measurement, sex, mean, tolerance, source FROM ceph_reference_values
      ORDER BY set_id, measurement, sex`,
  );
  return rows.map((row) => toReferenceSet(
    row, values.filter((value) => value.set_id === row.id)
      .map(({ measurement, sex, mean, tolerance, source }) =>
        ({ measurement, sex, mean: Number(mean), tolerance: Number(tolerance), source })),
  ));
}

/**
 * معايير المجموعة الافتراضية، بالشكل الذي يقرأه التحليل.
 *
 * ولا تُخبَّأ في الذاكرة: تعديلُ المدير يجب أن يظهر في القراءة التالية لا بعد
 * إعادة تشغيل — والقراءة صفٌّ واحدٌ من عشرة، لا حملَ فيها.
 *
 * والخاصُّ بالجنس يسبق العامّ: يُقرأ الصفّان معًا ثم يغلب صفُّ المريض. ولو رُشّح
 * بالجنس في الاستعلام وحده لَسقط كلُّ قياسٍ عامٍّ عن مريضٍ معروف الجنس — فيبقى
 * بلا معيار وهو له معيار.
 */
export async function referenceNorms(sex?: string | null): Promise<Record<string, Norm>> {
  await ensureSchema();
  await ensureReferenceSeed();
  const { rows } = await getPool().query<{ measurement: string; sex: string; mean: string; tolerance: string; source: string }>(
    `SELECT v.measurement, v.sex, v.mean, v.tolerance, v.source
       FROM ceph_reference_values v
       JOIN ceph_reference_sets s ON s.id = v.set_id
      WHERE s.is_default AND NOT s.archived
        AND (v.sex = 'any' OR v.sex = $1)
      -- العامّ أولًا ثم الخاصّ، فيكتب الخاصُّ فوقه.
      ORDER BY (v.sex <> 'any')`,
    [sex === "male" || sex === "female" ? sex : "any"],
  );
  const norms: Record<string, Norm> = {};
  for (const row of rows) {
    norms[row.measurement] = { mean: Number(row.mean), tolerance: Number(row.tolerance), source: row.source };
  }
  return norms;
}

/** تعديل قيمة في مجموعة — للمدير وحده، ومُسجَّلٌ باسمه. */
export async function setReferenceValue(input: {
  setId: number; measurement: string; sex?: string;
  mean: number; tolerance: number; source: string; actor: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  if (!Number.isFinite(input.mean)) return { ok: false, message: "المتوسط رقمٌ مطلوب." };
  if (!(input.tolerance > 0)) return { ok: false, message: "الانحراف يجب أن يكون أكبر من صفر." };
  if (!input.source.trim()) return { ok: false, message: "اكتب مرجع القيمة — رقمٌ بلا مرجع لا يُراجَع." };

  const sex = input.sex === "male" || input.sex === "female" ? input.sex : "any";
  const { rowCount } = await getPool().query(
    `INSERT INTO ceph_reference_values (set_id, measurement, sex, mean, tolerance, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (set_id, measurement, sex)
     DO UPDATE SET mean = EXCLUDED.mean, tolerance = EXCLUDED.tolerance, source = EXCLUDED.source`,
    [input.setId, input.measurement, sex, input.mean, input.tolerance, input.source.trim()],
  );
  if (!rowCount) return { ok: false, message: "المجموعة المرجعية غير موجودة." };
  await getPool().query(
    `UPDATE ceph_reference_sets SET updated_by = $2, updated_at = NOW() WHERE id = $1`,
    [input.setId, input.actor],
  );
  return { ok: true };
}

export async function getCephTracing(documentId: number, aspect?: number): Promise<CephTracing | null> {
  await ensureSchema();
  // جنس المريض يدخل اختيار المعيار — ومعيار Wits ذكورًا غيرُه إناثًا بمليمتر،
  // ومليمترٌ هنا يقلب حكمًا. فيُقرأ من ملفّه لا يُسأل عنه الطبيب من جديد.
  const { rows } = await getPool().query<{
    gender: string; birth_year: number | null;
    image_width: number | null; image_height: number | null;
  }>(
    `SELECT p.gender, p.birth_year, d.image_width, d.image_height FROM ceph_tracings t
       JOIN patients p ON p.id = t.patient_id
       JOIN patient_documents d ON d.id = t.document_id
      WHERE t.document_id = $1`,
    [documentId],
  );
  const [{ rows: tracings }, norms] = await Promise.all([
    getPool().query(`SELECT ${TRACING_COLUMNS} FROM ceph_tracings WHERE document_id = $1`, [documentId]),
    referenceNorms(rows[0]?.gender ?? null),
  ]);
  /*
   * النسبة من المتصفّح إن أرسلها، وإلّا من أبعاد الصورة المحفوظة.
   *
   * والشاشة ترسلها لأنها حمّلت الصورة؛ **وصفحة الطباعة لا ترسلها** — فكانت
   * تُحسب على ١ فتخرج على الورقة زوايا غير التي على الشاشة. والاحتياطُ هنا هو
   * ما يجعل الرقمين واحدًا: مصدرٌ واحد للنسبة مهما كان المستدعي.
   */
  const stored = aspectOf({
    width: rows[0]?.image_width ?? null, height: rows[0]?.image_height ?? null,
  });
  const effective = aspect && aspect > 0 ? aspect : stored;
  const ageYears = ageFromBirthYear(
    rows[0]?.birth_year ?? null,
    clinicDateString(new Date(), CLINIC_TIME_ZONE),
  );
  return tracings[0]
    ? toTracing({ ...tracings[0], aspect: effective, norms, ageYears })
    : null;
}

/** جنس صاحب الصورة — تختاره الشاشة به معيارها كما يختاره الخادم. */
export async function patientSexForDocument(documentId: number): Promise<string | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ gender: string }>(
    `SELECT p.gender FROM patient_documents d
       JOIN patients p ON p.id = d.patient_id
      WHERE d.id = $1`,
    [documentId],
  );
  return rows[0]?.gender ?? null;
}

export async function listPatientTracings(patientId: number): Promise<CephTracing[]> {
  await ensureSchema();
  const [{ rows }, norms] = await Promise.all([
    getPool().query(
      `SELECT ${TRACING_COLUMNS} FROM ceph_tracings WHERE patient_id = $1
        ORDER BY traced_at DESC`,
      [patientId],
    ),
    referenceNorms(),
  ]);
  return rows.map((row) => toTracing({ ...row, norms }));
}

/**
 * يحفظ التتبّع — إنشاءً أو تصحيحًا.
 *
 * والتصحيح يُسجَّل باسمه ووقته: موضعُ نقطةٍ يُغيّر التشخيص، ومن غيّرها بعد أن
 * بُنيت عليها خطة يجب أن يكون معروفًا.
 */
export async function saveCephTracing(input: {
  documentId: number;
  points: unknown;
  calibration: unknown;
  note: string | null;
  actor: string;
}): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();
  const { rows: documents } = await getPool().query<{ patient_id: number; mime_type: string }>(
    `SELECT patient_id, mime_type FROM patient_documents
      WHERE id = $1 AND removed_at IS NULL`,
    [input.documentId],
  );
  if (!documents[0]) return { ok: false, message: "الصورة غير موجودة." };
  if (!documents[0].mime_type.startsWith("image/")) {
    return { ok: false, message: "التتبّع يكون على صورة أشعة لا على مستند." };
  }

  const points = sanitizeTracing(input.points);
  const calibration = sanitizeCalibration(input.calibration);

  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO ceph_tracings (document_id, patient_id, points, calibration, note, traced_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::text, $6)
     ON CONFLICT (document_id) DO UPDATE
       SET points = EXCLUDED.points, calibration = EXCLUDED.calibration,
           note = EXCLUDED.note, updated_by = EXCLUDED.traced_by, updated_at = NOW()
     RETURNING id`,
    [
      input.documentId, documents[0].patient_id, JSON.stringify(points),
      calibration ? JSON.stringify(calibration) : null,
      input.note?.trim() || null, input.actor,
    ],
  );
  return { ok: true, id: rows[0].id };
}

// ─── المخزون ─────────────────────────────────────────────────────────────────

import {
  deriveBalance, inventorySummary, isItemCategory, needsAttention, signedQty,
  stockStatus, validateMovement,
  type ItemCategory, type MovementKind, type StockStatus,
} from "./inventory";

export interface InventoryItem {
  id: number;
  name: string;
  category: ItemCategory;
  unit: string;
  minLevel: number;
  note: string | null;
  isActive: boolean;
  /** مشتقٌّ من الحركات — لا عمود له في الجدول. */
  balance: number;
  status: StockStatus;
  /** أقرب صلاحيةٍ لدفعةٍ بقي منها شيء — لا أقرب صلاحيةٍ دخلت يومًا. */
  nearestExpiry: string | null;
}

export interface InventoryMovement {
  id: number;
  itemId: number;
  kind: MovementKind;
  qty: number;
  expiryDate: string | null;
  isReturn: boolean;
  reason: string | null;
  visitId: number | null;
  patientId: number | null;
  createdBy: string;
  createdAt: string;
}

const toItem = (row: Record<string, unknown>): InventoryItem => {
  const balance = Number(row.balance ?? 0);
  const minLevel = Number(row.min_level ?? 0);
  return {
    id: row.id as number,
    name: row.name as string,
    category: isItemCategory(row.category) ? row.category : "other",
    unit: row.unit as string,
    minLevel,
    note: (row.note as string | null) ?? null,
    isActive: Boolean(row.is_active),
    balance,
    status: stockStatus(balance, minLevel),
    nearestExpiry: row.nearest_expiry ? (row.nearest_expiry as Date).toISOString().slice(0, 10) : null,
  };
};

/**
 * البنود ومعها أرصدتها.
 *
 * والرصيد يُحسب في القاعدة بجملةٍ واحدة لا بحلقةٍ في التطبيق: قراءةُ كل الحركات
 * إلى الذاكرة ثم جمعُها تكبر مع كل صرفٍ يُسجَّل، والجمع في القاعدة يبقى ثابتًا.
 */
export async function listInventory(includeInactive = false): Promise<InventoryItem[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    // أقرب صلاحيةٍ باقية تُحسب في القاعدة كذلك: المصروف يُوزَّع على الدفعات بترتيب
    // الصلاحية، فتُستبعد دفعةٌ استُهلكت وإن مضى تاريخها. ونظيرتها في
    // `lib/inventory.ts#nearestExpiry` — و`scripts/verify-inventory.mjs` يقابل
    // بينهما على قاعدةٍ حقيقية كي لا تفترقا بصمت.
    `WITH consumed AS (
       SELECT item_id,
              GREATEST(SUM(CASE WHEN kind = 'out' THEN ABS(qty)
                                WHEN kind = 'adjust' AND qty < 0 THEN -qty
                                -- الردّ يُنقص المستهلك: المادّة عادت إلى دفعتها،
                                -- فتعود صلاحيتها معها. ولو حُسب إدخالًا جديدًا لبدا
                                -- بندٌ رجع إلى الرفّ وهو على وشك الانتهاء سليمًا.
                                WHEN kind = 'in' AND is_return THEN -ABS(qty)
                                ELSE 0 END), 0) AS used
         FROM inventory_movements GROUP BY item_id
     ),
     batches AS (
       SELECT item_id, expiry_date,
              SUM(ABS(qty)) OVER (PARTITION BY item_id ORDER BY expiry_date, id
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative
         FROM inventory_movements
        WHERE kind = 'in' AND NOT is_return AND expiry_date IS NOT NULL
     ),
     remaining AS (
       SELECT b.item_id, MIN(b.expiry_date) AS nearest_expiry
         FROM batches b
         LEFT JOIN consumed c ON c.item_id = b.item_id
        WHERE b.cumulative > COALESCE(c.used, 0)
        GROUP BY b.item_id
     )
     SELECT i.id, i.name, i.category, i.unit, i.min_level, i.note, i.is_active,
            r.nearest_expiry,
            COALESCE(SUM(CASE m.kind WHEN 'out' THEN -ABS(m.qty)
                                     WHEN 'adjust' THEN m.qty
                                     ELSE ABS(m.qty) END), 0) AS balance
       FROM inventory_items i
       LEFT JOIN inventory_movements m ON m.item_id = i.id
       LEFT JOIN remaining r ON r.item_id = i.id
      ${includeInactive ? "" : "WHERE i.is_active"}
      GROUP BY i.id, r.nearest_expiry
      ORDER BY i.is_active DESC, i.name`,
  );
  return rows.map(toItem);
}

/**
 * أرقام العدّاد: كم بندًا يحتاج تصرّفًا اليوم.
 *
 * وتُحسب من `listInventory` نفسها لا بجملةٍ ثانية تكرّر منطقها. وجملتان لقاعدةٍ
 * واحدة تفترقان بصمت — وقد وقع ذلك في هذا الملف مرّة: نسخةٌ للصلاحية في SQL وأخرى
 * في التطبيق، ولولا فحصٌ يقابل بينهما لَما ظهر. وبنود المخزون عشراتٌ لا تنمو مع
 * الأيام كما تنمو الفواتير، فجرُّها كلّها مرّةً في الدقيقة ثمنٌ زهيد مقابل ألّا
 * يقول العدّادُ شيئًا وتقول الشاشة غيره.
 *
 * واليوم يُمرَّر ولا يُقرأ هنا: اليمن UTC+3، ودالّةٌ تقرأ ساعة الخادم تُنهي صلاحية
 * دفعةٍ قبل أوانها كل مساء.
 */
export async function inventoryCounts(today: string): Promise<{
  out: number; low: number; expiring: number; attention: number;
}> {
  const items = await listInventory();
  return {
    ...inventorySummary(items, today),
    attention: items.filter((item) => needsAttention(item, today)).length,
  };
}

export async function createInventoryItem(input: {
  name: string; category: string; unit: string; minLevel: number;
  note: string | null; actor: string;
}): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();
  const name = input.name.trim();
  if (!name) return { ok: false, message: "اسم البند مطلوب." };
  if (!(input.minLevel >= 0)) return { ok: false, message: "حدّ الطلب لا يكون سالبًا." };

  try {
    const { rows } = await getPool().query<{ id: number }>(
      `INSERT INTO inventory_items (name, category, unit, min_level, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        name,
        isItemCategory(input.category) ? input.category : "other",
        input.unit.trim() || "وحدة",
        input.minLevel,
        input.note?.trim() || null,
        input.actor,
      ],
    );
    return { ok: true, id: rows[0].id };
  } catch (error) {
    // الفهرس الفريد يمنع بندين بالاسم نفسه — والرسالة تقول ذلك بالعربية.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "يوجد بندٌ بهذا الاسم — استعمله بدل إنشاء ثانٍ يقسم رصيده." };
    }
    throw error;
  }
}

/**
 * تعديل بند — ويشمل إيقافه.
 *
 * والإيقاف لا يحذف: حركات البند سجلٌّ لما صُرف على مرضى، وحذفه يمحو تفسير رصيدٍ
 * سابق. فيُخفى البند من الشاشة ويبقى سجلّه — ولذلك كان الفهرس الفريد على النشط
 * وحده، كي يُعاد إنشاء بندٍ باسمٍ أُوقف.
 */
export async function updateInventoryItem(input: {
  id: number; name?: string; category?: string; unit?: string;
  minLevel?: number; note?: string | null; isActive?: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, message: "اسم البند مطلوب." };
    push("name", name);
  }
  if (input.category !== undefined) push("category", isItemCategory(input.category) ? input.category : "other");
  if (input.unit !== undefined) push("unit", input.unit.trim() || "وحدة");
  if (input.minLevel !== undefined) {
    if (!(input.minLevel >= 0)) return { ok: false, message: "حدّ الطلب لا يكون سالبًا." };
    push("min_level", input.minLevel);
  }
  if (input.note !== undefined) push("note", input.note?.trim() || null);
  if (input.isActive !== undefined) push("is_active", input.isActive);
  if (sets.length === 0) return { ok: false, message: "لا تغيير مطلوب." };

  values.push(input.id);
  try {
    const { rowCount } = await getPool().query(
      `UPDATE inventory_items SET ${sets.join(", ")} WHERE id = $${values.length}`, values,
    );
    if (!rowCount) return { ok: false, message: "البند غير موجود." };
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "يوجد بندٌ بهذا الاسم — استعمله بدل إنشاء ثانٍ يقسم رصيده." };
    }
    throw error;
  }
}

/**
 * يسجّل حركة — والرصيد يُفحص **بعد قفل صفّ البند**.
 *
 * وهذا هو موضع الخطر كلّه: موظفان يصرفان آخر علبتين في اللحظة نفسها، كلاهما يقرأ
 * رصيدًا يكفيه، فيخرج الرصيد سالبًا وقد صُرف ما لا يوجد. فيُقفل صفّ البند، ثم
 * يُحسب الرصيد داخل القفل، ثم يُفحص — فيُنتظر الثاني حتى ينتهي الأول ويُردّ.
 */
export async function recordMovement(input: {
  itemId: number; kind: MovementKind; qty: number;
  expiryDate: string | null; reason: string | null;
  visitId: number | null; patientId: number | null; actor: string;
  /** ردُّ ما صُرف على هذه الزيارة — لا إدخالٌ جديد. يلزمه `visitId`. */
  isReturn?: boolean;
}): Promise<{ ok: true; id: number; balance: number } | { ok: false; message: string }> {
  await ensureSchema();
  const isReturn = Boolean(input.isReturn);
  if (isReturn && (input.kind !== "in" || !input.visitId)) {
    return { ok: false, message: "الردّ لا يكون إلا إدخالًا على زيارةٍ صُرف عليها." };
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    /*
     * الزيارة تُقفل أوّلًا وتُفحص.
     *
     * والشاشة تمنع الصرف على زيارةٍ موقَّعة — لكنها تمنعه بما **حمّلته** لا بما هو
     * الآن: يوقّعها زميلٌ من جهازٍ آخر، فتبقى شاشة الطبيب تظنّها مفتوحة فتصرف
     * عليها. فتُلحق مادّةٌ بزيارةٍ أُغلقت وحُوسبت — وحارسٌ في الواجهة وحدها ليس
     * حارسًا. والقفل هنا يمنع كذلك أن يقع التوقيع بين الفحص والكتابة.
     */
    if (input.visitId) {
      const { rows: visits } = await client.query<{ signed_at: Date | null }>(
        `SELECT signed_at FROM visits WHERE id = $1 FOR UPDATE`, [input.visitId],
      );
      if (!visits[0]) {
        await client.query("ROLLBACK");
        return { ok: false, message: "الزيارة غير موجودة." };
      }
      if (visits[0].signed_at) {
        await client.query("ROLLBACK");
        return { ok: false, message: "الزيارة موقَّعة — لا تُسجَّل عليها مواد بعد التوقيع." };
      }
    }

    const { rows: items } = await client.query<{ id: number; is_active: boolean }>(
      `SELECT id, is_active FROM inventory_items WHERE id = $1 FOR UPDATE`,
      [input.itemId],
    );
    if (!items[0]) {
      await client.query("ROLLBACK");
      return { ok: false, message: "البند غير موجود." };
    }
    if (!items[0].is_active) {
      await client.query("ROLLBACK");
      return { ok: false, message: "البند موقوف — أعِد تفعيله قبل تسجيل حركة عليه." };
    }

    const { rows: sums } = await client.query<{ balance: string }>(
      `SELECT COALESCE(SUM(CASE kind WHEN 'out' THEN -ABS(qty)
                                     WHEN 'adjust' THEN qty
                                     ELSE ABS(qty) END), 0) AS balance
         FROM inventory_movements WHERE item_id = $1`,
      [input.itemId],
    );
    const balance = Number(sums[0]?.balance ?? 0);

    const check = validateMovement(input.kind, input.qty, input.reason, balance);
    if (!check.ok) {
      await client.query("ROLLBACK");
      return { ok: false, message: check.message ?? "حركة غير صالحة." };
    }

    /*
     * لا يُردّ أكثر مما صُرف — ويُحسب الباقي **تحت القفل**.
     *
     * وصفُّ الصرف يبقى في السجلّ بعد ردّه، فزرُّ الردّ يُضغط عليه مرّة بعد مرّة —
     * أو من لسانين معًا — فيدخل المخزنَ في كلّ ضغطةٍ ما لم يخرج منه. **ومخزونٌ
     * يُصنع من العدم نقيضُ ما بُنيت عليه الوحدة كلّها**، وإخفاء الزرّ في الواجهة
     * لا يمنعه: الواجهةُ تُخفي، والقفل يمنع.
     */
    if (isReturn) {
      const { rows: sums } = await client.query<{ outstanding: string }>(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'out' THEN ABS(qty)
                                  WHEN kind = 'in' AND is_return THEN -ABS(qty)
                                  ELSE 0 END), 0) AS outstanding
           FROM inventory_movements WHERE visit_id = $1 AND item_id = $2`,
        [input.visitId, input.itemId],
      );
      const outstanding = Number(sums[0]?.outstanding ?? 0);
      if (Math.abs(input.qty) > outstanding) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          message: outstanding > 0
            ? `لا يُردّ أكثر مما صُرف — الباقي ${outstanding}.`
            : "لا شيء يُردّ — رُدَّ كلّ ما صُرف على هذه الزيارة.",
        };
      }
    }

    const { rows: created } = await client.query<{ id: number }>(
      `INSERT INTO inventory_movements
         (item_id, kind, qty, expiry_date, reason, visit_id, patient_id, is_return, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        input.itemId, input.kind, Math.abs(input.qty) * (input.kind === "adjust" ? Math.sign(input.qty) : 1),
        // الردّ لا يحمل صلاحية: هو ليس دفعةً جديدة بل رجوعٌ إلى دفعته الأولى.
        input.kind === "in" && !isReturn ? input.expiryDate : null,
        input.reason?.trim() || null,
        input.visitId, input.patientId, isReturn, input.actor,
      ],
    );
    await client.query("COMMIT");
    return { ok: true, id: created[0].id, balance: balance + signedQty(input.kind, input.qty) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listMovements(itemId: number, limit = 100): Promise<InventoryMovement[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, item_id, kind, qty, expiry_date, is_return, reason, visit_id, patient_id,
            created_by, created_at
       FROM inventory_movements WHERE item_id = $1
      ORDER BY id DESC LIMIT $2`,
    [itemId, Math.min(500, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: row.id as number,
    itemId: row.item_id as number,
    kind: row.kind as MovementKind,
    qty: Number(row.qty),
    expiryDate: row.expiry_date ? (row.expiry_date as Date).toISOString().slice(0, 10) : null,
    isReturn: Boolean(row.is_return),
    reason: (row.reason as string | null) ?? null,
    visitId: (row.visit_id as number | null) ?? null,
    patientId: (row.patient_id as number | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export interface VisitMaterial {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  kind: MovementKind;
  qty: number;
  isReturn: boolean;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

/**
 * ما صُرف على زيارةٍ بعينها — ومعه ما رُدّ منه.
 *
 * والمردود يُعرض ولا يُطرح صامتًا: «صُرفت علبتان ورُدّت واحدة» تُقرأ وتُراجَع،
 * و«صُرفت واحدة» تخفي أن اثنتين خرجتا من المخزن يومًا. وهو نفس سبب منع حذف الحركات.
 */
export async function listVisitMaterials(visitId: number): Promise<VisitMaterial[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT m.id, m.item_id, i.name AS item_name, i.unit, m.kind, m.qty, m.is_return,
            m.reason, m.created_by, m.created_at
       FROM inventory_movements m
       JOIN inventory_items i ON i.id = m.item_id
      WHERE m.visit_id = $1
      ORDER BY m.id`,
    [visitId],
  );
  return rows.map((row) => ({
    id: row.id as number,
    itemId: row.item_id as number,
    itemName: row.item_name as string,
    unit: row.unit as string,
    kind: row.kind as MovementKind,
    qty: Number(row.qty),
    isReturn: Boolean(row.is_return),
    reason: (row.reason as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

/** حركاتُ بندٍ بشكلها المجرّد — للاشتقاق في الاختبارات وفي الفحص. */
export async function inventoryBalance(itemId: number): Promise<number> {
  const movements = await listMovements(itemId, 500);
  return deriveBalance(movements);
}

// ─── الرسائل الداخلية ────────────────────────────────────────────────────────

export interface StaffMessage {
  id: number;
  senderId: number;
  senderName: string;
  recipientId: number | null;
  kind: "text" | "voice";
  body: string | null;
  voiceMs: number | null;
  createdAt: string;
}

const MESSAGE_SELECT = `
  SELECT m.id, m.sender_id, u.display_name AS sender_name, m.recipient_id,
         m.kind, m.body, m.voice_ms, m.created_at
    FROM staff_messages m
    JOIN users u ON u.id = m.sender_id`;

function toStaffMessage(row: Record<string, unknown>): StaffMessage {
  return {
    id: row.id as number,
    senderId: row.sender_id as number,
    senderName: row.sender_name as string,
    recipientId: (row.recipient_id as number | null) ?? null,
    kind: row.kind as "text" | "voice",
    body: (row.body as string | null) ?? null,
    voiceMs: row.voice_ms === null || row.voice_ms === undefined ? null : Number(row.voice_ms),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * إرسال رسالة.
 *
 * جسم التسجيل لا يمرّ من هنا — يُكتب على القرص في المسار ويصل مفتاحُه. وترتيب
 * ذلك مقصود: ملفٌّ بلا صفٍّ نفايةٌ صامتة، وصفٌّ بلا ملفّ رسالةٌ تُفتح فلا يُسمع
 * منها شيء — والثاني أسوأ لأن أحدًا انتظر جوابها.
 */
export async function sendStaffMessage(input: {
  senderId: number;
  recipientId: number | null;
  kind: "text" | "voice";
  body: string | null;
  voiceKey: string | null;
  voiceMime: string | null;
  voiceMs: number | null;
  voiceBytes: number | null;
}): Promise<StaffMessage> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO staff_messages
       (sender_id, recipient_id, kind, body, voice_key, voice_mime, voice_ms, voice_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.senderId, input.recipientId, input.kind, input.body,
      input.voiceKey, input.voiceMime, input.voiceMs, input.voiceBytes],
  );
  const { rows: full } = await getPool().query(`${MESSAGE_SELECT} WHERE m.id = $1`, [rows[0].id]);
  return toStaffMessage(full[0]);
}

/**
 * محادثةٌ بين اثنين — بالاتجاهين.
 *
 * والشرط على الزوج لا على «مُرسِلي أو مُستقبِلي»: بلا ذلك تظهر في محادثتي مع
 * زميلٍ رسائلي إلى زميلٍ آخر.
 */
export async function directMessages(
  userId: number, otherId: number, limit = 200,
): Promise<StaffMessage[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `${MESSAGE_SELECT}
      WHERE (m.sender_id = $1 AND m.recipient_id = $2)
         OR (m.sender_id = $2 AND m.recipient_id = $1)
      ORDER BY m.id DESC LIMIT $3`,
    [userId, otherId, limit],
  );
  return rows.map(toStaffMessage).reverse();
}

/** رسائل الفريق — صفوفٌ مستقبِلُها فارغ، يراها الجميع. */
export async function broadcastMessages(limit = 200): Promise<StaffMessage[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `${MESSAGE_SELECT} WHERE m.recipient_id IS NULL ORDER BY m.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toStaffMessage).reverse();
}

export interface StaffConversation {
  userId: number | null;
  displayName: string;
  role: string | null;
  lastAt: string | null;
  lastKind: "text" | "voice" | null;
  lastBody: string | null;
  lastVoiceMs: number | null;
  unread: number;
}

/**
 * قائمة المحادثات — كلّ زميلٍ نشط، ومعهم صندوق الفريق.
 *
 * وتُعرض المحادثات التي لم تبدأ بعد أيضًا: قائمةٌ لا تُظهر إلا من سبقت مراسلتُه
 * تجعل أول رسالةٍ إلى زميلٍ جديد بحثًا عن زرٍّ لا يوجد.
 *
 * وغيرُ المقروء يُشتقّ من غياب صفٍّ في `staff_message_reads` — لا من عمودٍ يُحدَّث
 * مع كل قراءة فيفترق عن سجلّه.
 */
export async function staffConversations(userId: number): Promise<StaffConversation[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `WITH visible AS (
       SELECT m.*,
              CASE WHEN m.recipient_id IS NULL THEN NULL
                   WHEN m.sender_id = $1 THEN m.recipient_id
                   ELSE m.sender_id END AS peer_id
         FROM staff_messages m
        WHERE m.recipient_id IS NULL OR m.sender_id = $1 OR m.recipient_id = $1
     ),
     latest AS (
       SELECT DISTINCT ON (peer_id) peer_id, kind, body, voice_ms, created_at
         FROM visible ORDER BY peer_id, id DESC
     ),
     unread AS (
       SELECT v.peer_id, COUNT(*)::int AS n
         FROM visible v
        WHERE v.sender_id <> $1
          AND NOT EXISTS (
                SELECT 1 FROM staff_message_reads r
                 WHERE r.message_id = v.id AND r.user_id = $1)
        GROUP BY v.peer_id
     )
     SELECT u.id AS user_id, u.display_name, u.role,
            l.created_at, l.kind, l.body, l.voice_ms,
            COALESCE(n.n, 0) AS unread
       FROM users u
       LEFT JOIN latest l ON l.peer_id = u.id
       LEFT JOIN unread n ON n.peer_id = u.id
      WHERE u.is_active AND u.id <> $1
      UNION ALL
     SELECT NULL AS user_id, 'الفريق كلّه' AS display_name, NULL AS role,
            l.created_at, l.kind, l.body, l.voice_ms,
            COALESCE(n.n, 0) AS unread
       FROM (SELECT 1) AS one
       LEFT JOIN latest l ON l.peer_id IS NULL
       LEFT JOIN unread n ON n.peer_id IS NULL`,
    [userId],
  );
  return rows.map((row) => ({
    userId: (row.user_id as number | null) ?? null,
    displayName: row.display_name as string,
    role: (row.role as string | null) ?? null,
    lastAt: row.created_at ? (row.created_at as Date).toISOString() : null,
    lastKind: (row.kind as "text" | "voice" | null) ?? null,
    lastBody: (row.body as string | null) ?? null,
    lastVoiceMs: row.voice_ms === null || row.voice_ms === undefined ? null : Number(row.voice_ms),
    unread: Number(row.unread),
  }));
}

/** عدد ما لم يُقرأ — عدّاد القشرة. رسائلي إليّ لا تُعدّ. */
export async function unreadStaffMessages(userId: number): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT COUNT(*)::int AS n
       FROM staff_messages m
      WHERE m.sender_id <> $1
        AND (m.recipient_id = $1 OR m.recipient_id IS NULL)
        AND NOT EXISTS (
              SELECT 1 FROM staff_message_reads r
               WHERE r.message_id = m.id AND r.user_id = $1)`,
    [userId],
  );
  return Number(rows[0].n);
}

/**
 * تعليم محادثةٍ مقروءة.
 *
 * `ON CONFLICT DO NOTHING` يحفظ **أول** قراءة: إعادةُ فتح المحادثة لا تزيح وقت
 * القراءة الأولى إلى الآن، ومن يسأل «متى رآها» يسأل عن الأولى.
 */
export async function markConversationRead(
  userId: number, scope: { withUserId: number } | { broadcast: true },
): Promise<number> {
  await ensureSchema();
  const broadcast = "broadcast" in scope;
  const { rowCount } = await getPool().query(
    `INSERT INTO staff_message_reads (message_id, user_id)
     SELECT m.id, $1 FROM staff_messages m
      WHERE m.sender_id <> $1
        AND (($2::boolean AND m.recipient_id IS NULL)
          OR (NOT $2::boolean AND m.sender_id = $3 AND m.recipient_id = $1))
     ON CONFLICT DO NOTHING`,
    [userId, broadcast, broadcast ? null : scope.withUserId],
  );
  return rowCount ?? 0;
}

/**
 * مفتاح التسجيل على القرص — بعد التثبّت من حقّ القارئ.
 *
 * والحارس هنا لا في الواجهة: رابط التشغيل رقمٌ متسلسل، ومن يبدّله برقمٍ آخر
 * يسمع رسالةً ليست له. فيُشترط أن يكون المستمع مُرسِلَها أو مُستقبِلَها أو أن
 * تكون رسالةَ فريق.
 */
export async function staffMessageVoice(
  messageId: number, userId: number,
): Promise<{ key: string; mime: string } | null> {
  await ensureSchema();
  const { rows } = await getPool().query<{ voice_key: string | null; voice_mime: string | null }>(
    `SELECT voice_key, voice_mime FROM staff_messages
      WHERE id = $1 AND kind = 'voice'
        AND (recipient_id IS NULL OR sender_id = $2 OR recipient_id = $2)`,
    [messageId, userId],
  );
  const row = rows[0];
  if (!row?.voice_key) return null;
  return { key: row.voice_key, mime: row.voice_mime ?? "application/octet-stream" };
}

// ─── الدراسة السيفالومترية ───────────────────────────────────────────────────

import { aspectOf } from "./imageSize";
import {
  checkApproval, canTransition, isStudyPhase, nextRevision, tracingFingerprint,
  transitionRefusal, type StudyPhase, type StudyStatus,
} from "./cephStudy";

export interface CephStudy {
  id: number;
  patientId: number;
  patientName: string;
  documentId: number;
  documentTitle: string;
  orthoCaseId: number | null;
  phase: StudyPhase;
  status: StudyStatus;
  revision: number;
  title: string | null;
  takenOn: string | null;
  note: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  /** عدد المعالم في المصدر الذي تُقرأ منه هذه الدراسة. */
  landmarks: number;
  /**
   * أتغيّر التتبّع الحيّ عمّا اعتُمد؟
   *
   * لا يُحسب إلّا للمعتمدة — والمسودّة **هي** التتبّع الحيّ فلا فرق يُقاس.
   */
  drifted: boolean;
}

const STUDY_SELECT = `
  SELECT s.id, s.patient_id, p.full_name AS patient_name, p.gender, p.birth_year, s.document_id,
         d.title AS document_title, s.ortho_case_id, s.phase, s.status, s.revision,
         s.title, s.taken_on, s.note, s.snapshot_points, s.snapshot_calibration,
         s.approved_by, s.approved_at, s.created_by, s.created_at,
         d.image_width, d.image_height,
         t.points AS live_points, t.calibration AS live_calibration
    FROM ceph_studies s
    JOIN patients p ON p.id = s.patient_id
    JOIN patient_documents d ON d.id = s.document_id
    LEFT JOIN ceph_tracings t ON t.document_id = s.document_id`;

/**
 * اليوم الذي تُنسب إليه الدراسة — يوم التصوير إن سُجّل، وإلّا يوم إنشائها.
 *
 * ولا يُشتقّ من `created_at` بـ`toISOString`: العيادة على ‎+٣‎، فما بعد التاسعة
 * مساءً يُحسب اليوم التالي بتوقيت UTC. والسنة وحدها هي المطلوبة هنا، لكن
 * الانزياح يقع على رأس السنة فيخطئ العمر سنةً كاملة.
 */
const studyDateString = (row: Record<string, unknown>): string | null => {
  const taken = row.taken_on;
  if (taken instanceof Date) return clinicDateString(taken, CLINIC_TIME_ZONE);
  if (typeof taken === "string" && taken.length >= 4) return taken;
  const created = row.created_at;
  return created instanceof Date ? clinicDateString(created, CLINIC_TIME_ZONE) : null;
};

/** النسبة التي تُحسب بها زوايا الدراسة — من أبعاد أشعّتها المحفوظة. */
const studyAspect = (row: Record<string, unknown>): number => aspectOf({
  width: (row.image_width as number | null) ?? null,
  height: (row.image_height as number | null) ?? null,
});

function toStudy(row: Record<string, unknown>): CephStudy {
  const approved = row.status === "approved" || row.status === "archived";
  const snapshot = sanitizeTracing(row.snapshot_points);
  const live = sanitizeTracing(row.live_points);
  const points = approved && row.snapshot_points ? snapshot : live;
  const drifted = approved && row.snapshot_points
    ? tracingFingerprint(snapshot, sanitizeCalibration(row.snapshot_calibration))
      !== tracingFingerprint(live, sanitizeCalibration(row.live_calibration))
    : false;
  return {
    id: row.id as number,
    patientId: row.patient_id as number,
    patientName: row.patient_name as string,
    documentId: row.document_id as number,
    documentTitle: row.document_title as string,
    orthoCaseId: (row.ortho_case_id as number | null) ?? null,
    phase: row.phase as StudyPhase,
    status: row.status as StudyStatus,
    revision: Number(row.revision),
    title: (row.title as string | null) ?? null,
    takenOn: row.taken_on ? dateText(row.taken_on as Date) : null,
    note: (row.note as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : null,
    createdBy: row.created_by as string,
    createdAt: (row.created_at as Date).toISOString(),
    landmarks: Object.keys(points).length,
    drifted,
  };
}

/** دراسات المريض — ملفّه السيفالومتري كلّه في قائمة. */
export async function listPatientStudies(patientId: number): Promise<CephStudy[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `${STUDY_SELECT} WHERE s.patient_id = $1 ORDER BY s.id DESC`, [patientId]);
  return rows.map(toStudy);
}

/** دراسات حالة تقويمٍ بعينها — ما بُني عليه علاجُها. */
export async function listCaseStudies(orthoCaseId: number): Promise<CephStudy[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `${STUDY_SELECT} WHERE s.ortho_case_id = $1 ORDER BY s.id DESC`, [orthoCaseId]);
  return rows.map(toStudy);
}

export async function getCephStudy(id: number): Promise<CephStudy | null> {
  await ensureSchema();
  const { rows } = await getPool().query(`${STUDY_SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ? toStudy(rows[0]) : null;
}

/**
 * قراءةُ الدراسة بتحليلها.
 *
 * والمصدر يتبع الحالة: المعتمدة تُقرأ من لقطتها، والمسودّة من التتبّع الحيّ.
 * ولو قُرئت المعتمدة من الحيّ لتغيّرت أرقامُ وثيقةٍ موقَّعة كلّما صحّح أحدٌ نقطة.
 */
export async function cephStudyAnalysis(id: number): Promise<
  {
    study: CephStudy; points: Tracing; calibration: Calibration | null;
    aspect: number; analysis: Analysis;
  } | null
> {
  await ensureSchema();
  const { rows } = await getPool().query(`${STUDY_SELECT} WHERE s.id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  /*
   * المعايير تُختار بجنس المريض — كما تُختار في `getCephTracing`.
   *
   * ومعيار Wits ذكورًا ‏١ وإناثًا ‏٠، ومليمترٌ هنا يقلب حكمًا. وكانت تُقرأ بلا
   * جنس فيسقط صفُّ الإناث فيُطبَّق معيار الذكور على مريضةٍ في ورقةٍ موقَّعة.
   */
  const norms = await referenceNorms((row.gender as string | null) ?? null);
  const study = toStudy(row);
  const frozen = study.status !== "draft" && row.snapshot_points;
  const points = sanitizeTracing(frozen ? row.snapshot_points : row.live_points);
  const calibration = sanitizeCalibration(frozen ? row.snapshot_calibration : row.live_calibration);
  return {
    study, points, calibration,
    // النسبة تخرج مع القراءة: التراكب يحتاجها كما يحتاجها التحليل، ولا تُحسب
    // مرّتين من مصدرين فتفترقا.
    aspect: studyAspect(row),
    analysis: analyse({
      tracing: points, calibration, norms, aspect: studyAspect(row),
      /*
       * العمر يوم الأشعّة لا اليوم — دراسةٌ قديمة لطفلٍ صار بالغًا تبقى دراسة
       * طفل، وإعادة قراءتها بعمره الحالي تُلبسها أحكامًا لم تكن لها.
       */
      ageYears: ageFromBirthYear(
        (row.birth_year as number | null) ?? null,
        studyDateString(row),
      ),
    }),
  };
}

/**
 * إنشاء دراسة على صورة.
 *
 * والصورة يجب أن تكون أشعّةً للمريض نفسه: دراسةٌ على صورة مريضٍ آخر خطأٌ لا
 * يُكتشف إلّا بعد أن يُبنى عليها. والمرحلة تُقرأ هنا لا تُخمَّن.
 */
export async function createCephStudy(input: {
  documentId: number;
  phase: unknown;
  orthoCaseId: number | null;
  title: string | null;
  takenOn: string | null;
  note: string | null;
  actor: string;
}): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();
  if (!isStudyPhase(input.phase)) {
    return { ok: false, message: "اختر مرحلة الدراسة من العلاج." };
  }
  const { rows: documents } = await getPool().query<{
    patient_id: number; mime_type: string; taken_on: Date | null; title: string;
  }>(
    `SELECT patient_id, mime_type, taken_on, title FROM patient_documents
      WHERE id = $1 AND removed_at IS NULL`,
    [input.documentId],
  );
  const document = documents[0];
  if (!document) return { ok: false, message: "الصورة غير موجودة." };
  if (!document.mime_type.startsWith("image/")) {
    return { ok: false, message: "الدراسة تكون على صورة أشعة لا على مستند." };
  }

  if (input.orthoCaseId !== null) {
    const { rows: cases } = await getPool().query<{ patient_id: number }>(
      `SELECT patient_id FROM ortho_cases WHERE id = $1`, [input.orthoCaseId]);
    if (!cases[0]) return { ok: false, message: "حالة التقويم غير موجودة." };
    // حالةٌ لمريضٍ آخر: الربط الخاطئ يضع أشعّة مريضٍ في ملف علاج غيره.
    if (cases[0].patient_id !== document.patient_id) {
      return { ok: false, message: "حالة التقويم ليست لهذا المريض." };
    }
  }

  const { rows: existing } = await getPool().query<{ revision: number; status: string }>(
    `SELECT revision, status FROM ceph_studies WHERE document_id = $1`, [input.documentId]);
  if (existing.some((row) => row.status === "draft")) {
    return { ok: false, message: "على هذه الأشعّة مسودّةُ دراسةٍ مفتوحة — أكملها أو اعتمدها." };
  }

  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO ceph_studies
       (patient_id, document_id, ortho_case_id, phase, revision, title, taken_on, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9) RETURNING id`,
    [
      document.patient_id, input.documentId, input.orthoCaseId, input.phase,
      nextRevision(existing.map((row) => ({ revision: Number(row.revision) }))),
      input.title?.trim() || document.title,
      input.takenOn ?? (document.taken_on ? dateText(document.taken_on) : null),
      input.note?.trim() || null, input.actor,
    ],
  );
  return { ok: true, id: rows[0].id };
}

/**
 * اعتماد الدراسة — وهو **توقيع**.
 *
 * ولحظتَه تُنسخ المعالم والمعايرة إلى الدراسة، فتنفصل عن التتبّع الحيّ إلى
 * الأبد. وبعدها من يصحّح نقطةً على الصورة لا يمسّ ما وُقِّع — تظهر الدراسة
 * «تغيّر تتبّعها» وتُنشأ منها إصدارةٌ جديدة إن أُريد.
 *
 * والصفّ يُقفل قبل القراءة: اعتمادان في اللحظة نفسها كانا سيكتبان لقطتين.
 */
export async function approveCephStudy(input: { id: number; actor: string }): Promise<
  { ok: true } | { ok: false; message: string }
> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      status: StudyStatus; document_id: number;
    }>(`SELECT status, document_id FROM ceph_studies WHERE id = $1 FOR UPDATE`, [input.id]);
    const study = rows[0];
    if (!study) {
      await client.query("ROLLBACK");
      return { ok: false, message: "الدراسة غير موجودة." };
    }
    const { rows: tracings } = await client.query<{ points: unknown; calibration: unknown }>(
      `SELECT points, calibration FROM ceph_tracings WHERE document_id = $1`,
      [study.document_id],
    );
    const points = sanitizeTracing(tracings[0]?.points);
    const calibration = sanitizeCalibration(tracings[0]?.calibration);

    const verdict = checkApproval({ status: study.status, points });
    if (!verdict.ok) {
      await client.query("ROLLBACK");
      return { ok: false, message: verdict.message ?? "لا تُعتمد هذه الدراسة." };
    }

    await client.query(
      `UPDATE ceph_studies
          SET status = 'approved', snapshot_points = $2::jsonb,
              snapshot_calibration = $3::jsonb, approved_by = $4, approved_at = NOW()
        WHERE id = $1`,
      [
        input.id, JSON.stringify(points),
        calibration ? JSON.stringify(calibration) : null, input.actor,
      ],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** أرشفة الدراسة — تُبطَل ولا تُمحى، فيبقى في الملف أنها كانت. */
export async function archiveCephStudy(input: { id: number }): Promise<
  { ok: true } | { ok: false; message: string }
> {
  await ensureSchema();
  const { rows } = await getPool().query<{ status: StudyStatus }>(
    `SELECT status FROM ceph_studies WHERE id = $1`, [input.id]);
  if (!rows[0]) return { ok: false, message: "الدراسة غير موجودة." };
  if (!canTransition(rows[0].status, "archived")) {
    return { ok: false, message: transitionRefusal(rows[0].status, "archived") };
  }
  await getPool().query(
    `UPDATE ceph_studies SET status = 'archived', archived_at = NOW() WHERE id = $1`,
    [input.id],
  );
  return { ok: true };
}

/** ربط الدراسة بحالة تقويم — أو فكّه. */
export async function linkStudyToCase(input: {
  id: number; orthoCaseId: number | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  const { rows } = await getPool().query<{ patient_id: number; status: StudyStatus }>(
    `SELECT patient_id, status FROM ceph_studies WHERE id = $1`, [input.id]);
  if (!rows[0]) return { ok: false, message: "الدراسة غير موجودة." };
  if (rows[0].status === "archived") {
    return { ok: false, message: "الدراسة مؤرشفة — لا تُغيَّر." };
  }
  if (input.orthoCaseId !== null) {
    const { rows: cases } = await getPool().query<{ patient_id: number }>(
      `SELECT patient_id FROM ortho_cases WHERE id = $1`, [input.orthoCaseId]);
    if (!cases[0]) return { ok: false, message: "حالة التقويم غير موجودة." };
    if (cases[0].patient_id !== rows[0].patient_id) {
      return { ok: false, message: "حالة التقويم ليست لهذا المريض." };
    }
  }
  await getPool().query(
    `UPDATE ceph_studies SET ortho_case_id = $2 WHERE id = $1`, [input.id, input.orthoCaseId]);
  return { ok: true };
}

// ─── الوصفات الطبية ──────────────────────────────────────────────────────────

import {
  isInstructionsLang, sanitizeRxItems,
  type InstructionsLang, type Prescription, type PrescriptionDraft, type RxItem,
} from "./prescription";

/*
 * لا `JOIN patients` هنا.
 *
 * فاسم المريض ورقم ملفّه وتنبيهه الطبي **محفوظةٌ في الوصفة** يوم صدرت. وقراءتها
 * من الملف الحيّ تجعل وثيقةً موقَّعة تتغيّر بتعديلٍ في شاشةٍ أخرى.
 */
const RX_SELECT = `
  SELECT r.id, r.patient_id, r.patient_name, r.patient_number,
         r.patient_birth_year, r.patient_gender, r.medical_alert,
         r.visit_id, r.diagnosis, r.notes, r.instructions_lang, r.items,
         r.issued_by, r.issued_at, r.voided_by, r.voided_at, r.void_reason
    FROM prescriptions r`;

/**
 * صفٌّ من القاعدة إلى وصفة.
 *
 * والأدوية تمرّ بالمُنقّي من جديد وإن كُتبت به عند الحفظ: صفٌّ قديم قد يكون
 * حُفظ قبل أن يوجد المُنقّي، وقراءةٌ تثق بما في القاعدة تطبع ما لا شكل له.
 */
const toPrescription = (row: Record<string, unknown>): Prescription => ({
  id: row.id as number,
  patientId: row.patient_id as number,
  patientName: (row.patient_name as string | null) ?? "",
  patientNumber: String(row.patient_number ?? ""),
  birthYear: (row.patient_birth_year as number | null) ?? null,
  gender: (row.patient_gender as string | null) ?? "unspecified",
  medicalAlert: (row.medical_alert as string | null) ?? null,
  visitId: (row.visit_id as number | null) ?? null,
  diagnosis: (row.diagnosis as string | null) ?? "",
  notes: (row.notes as string | null) ?? "",
  instructionsLang: isInstructionsLang(row.instructions_lang)
    ? (row.instructions_lang as InstructionsLang) : "both",
  items: sanitizeRxItems(row.items),
  issuedBy: row.issued_by as string,
  issuedAt: (row.issued_at as Date).toISOString(),
  voidedBy: (row.voided_by as string | null) ?? null,
  voidedAt: row.voided_at ? (row.voided_at as Date).toISOString() : null,
  voidReason: (row.void_reason as string | null) ?? null,
});

/** يصدر وصفة. والإصدار نهائي: لا تعديل بعده، وإنما إبطالٌ مُعلَّل. */
export async function createPrescription(
  draft: PrescriptionDraft, actor: string,
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();

  const { rows: patients } = await getPool().query<{
    id: number; full_name: string; patient_number: string;
    birth_year: number | null; gender: string; medical_alert: string | null;
  }>(
    `SELECT id, full_name, patient_number, birth_year, gender, medical_alert
       FROM patients WHERE id = $1`, [draft.patientId]);
  const patient = patients[0];
  if (!patient) return { ok: false, message: "المريض غير موجود." };

  if (draft.visitId !== null) {
    const { rows: visits } = await getPool().query<{ patient_id: number }>(
      `SELECT patient_id FROM visits WHERE id = $1`, [draft.visitId]);
    if (!visits[0]) return { ok: false, message: "الزيارة غير موجودة." };
    /*
     * زيارةُ مريضٍ آخر: الوصفة تُنسب إلى زيارةٍ ليست له، فتظهر في ملف غيره.
     * وهذا خطأٌ لا يُكتشف إلّا بعد أن يُبنى عليه.
     */
    if (visits[0].patient_id !== draft.patientId) {
      return { ok: false, message: "الزيارة ليست لهذا المريض." };
    }
  }

  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO prescriptions
       (patient_id, visit_id, diagnosis, notes, instructions_lang, items, issued_by,
        patient_name, patient_number, patient_birth_year, patient_gender, medical_alert)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      draft.patientId, draft.visitId, draft.diagnosis, draft.notes,
      draft.instructionsLang, JSON.stringify(draft.items), actor,
      // اللقطة تُؤخذ هنا مرّةً واحدة — وما بعدها من تعديلٍ على الملف لا يمسّها.
      patient.full_name, patient.patient_number, patient.birth_year,
      patient.gender, patient.medical_alert,
    ],
  );
  return { ok: true, id: rows[0].id };
}

/** وصفاتُ مريض — الأحدث أوّلًا، والمُبطَلة تبقى فيها ولا تُخفى. */
export async function listPatientPrescriptions(patientId: number): Promise<Prescription[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `${RX_SELECT} WHERE r.patient_id = $1 ORDER BY r.issued_at DESC, r.id DESC`, [patientId]);
  return rows.map(toPrescription);
}

export async function getPrescription(id: number): Promise<Prescription | null> {
  await ensureSchema();
  const { rows } = await getPool().query(`${RX_SELECT} WHERE r.id = $1`, [id]);
  return rows[0] ? toPrescription(rows[0]) : null;
}

/**
 * يُبطل وصفة.
 *
 * والشرط `voided_at IS NULL` في الجملة نفسها لا قبلها: قراءةٌ ثم كتابة تسمح
 * لطلبين متزامنين أن يُبطلا الوصفة مرّتين، فيُكتب آخرُهما فوق سبب أوّلهما.
 */
export async function voidPrescription(input: {
  id: number; reason: string; actor: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE prescriptions
        SET voided_at = NOW(), voided_by = $2, void_reason = $3
      WHERE id = $1 AND voided_at IS NULL`,
    [input.id, input.actor, input.reason],
  );
  if (!rowCount) return { ok: false, message: "الوصفة غير موجودة أو مُبطَلة أصلًا." };
  return { ok: true };
}

/**
 * أدويةٌ سبق أن وُصفت — تُقترح على من يكتب وصفةً جديدة.
 *
 * ومشتقّةٌ من الوصفات لا مكتوبةٌ في قائمةٍ ثابتة: قائمةٌ ثابتة تشيخ ولا تعرف
 * ما يصفه هذا الطبيب فعلًا، والمشتقّة تتعلّم من عمله ويقلّ بها النقر.
 */
export async function prescribedBefore(limit = 60): Promise<RxItem[]> {
  await ensureSchema();
  const { rows } = await getPool().query<{ items: unknown }>(
    `SELECT items FROM prescriptions
      WHERE voided_at IS NULL ORDER BY issued_at DESC LIMIT 200`);
  const seen = new Map<string, RxItem>();
  for (const row of rows) {
    for (const item of sanitizeRxItems(row.items)) {
      // الاسم مفتاحًا بلا حالة أحرف: `Augmentin` و`augmentin` دواءٌ واحد.
      const key = item.name.toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, item);
      if (seen.size >= limit) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

/**
 * ينسب أمر مختبرٍ إلى طبيب — أو يرفع النسبة.
 *
 * وهو المخرج من «تكلفةٌ بلا طبيب»: أوامرُ ما قبل هذا الحقل لا طبيب لها،
 * وتنبيهٌ يطلب نسبتها بلا سبيلٍ إلى ذلك تنبيهٌ لا يُغلق أبدًا.
 *
 * ويُتحقّق أنّه طبيبٌ مسجَّل: رقمُ جهةٍ أخرى يخصم تكلفةً من عمولة من ليس طبيبًا.
 */
export async function setLabOrderDoctor(
  id: number, doctorPartyId: number | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  if (doctorPartyId !== null) {
    const { rows } = await getPool().query<{ id: number }>(
      `SELECT id FROM parties WHERE id = $1 AND kind = 'doctor'`, [doctorPartyId]);
    if (!rows[0]) return { ok: false, message: "اختر الطبيب من قائمة الأطباء." };
  }
  const { rowCount } = await getPool().query(
    `UPDATE lab_orders SET doctor_party_id = $2 WHERE id = $1`, [id, doctorPartyId]);
  if (!rowCount) return { ok: false, message: "العمل غير موجود." };
  return { ok: true };
}
// ─── كتالوج أعمال المختبر وأسعارها ───────────────────────────────────────────

import {
  isLabCategory, overlaps, planReplacement, priceOn,
  type LabCategory, type LabPrice, type LabService, type ServiceDraft,
} from "./labCatalog";

const toLabService = (row: Record<string, unknown>): LabService => ({
  id: row.id as number,
  name: row.name as string,
  category: isLabCategory(row.category) ? (row.category as LabCategory) : "prostho",
  defaultDays: Number(row.default_days),
  requiresShade: Boolean(row.requires_shade),
  isActive: Boolean(row.is_active),
  sortOrder: Number(row.sort_order),
});

/** أعمال المختبر — المتوقّفة تبقى للتقارير القديمة ولا تُعرض في النموذج. */
export async function listLabServices(includeInactive = false): Promise<LabService[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, name, category, default_days, requires_shade, is_active, sort_order
       FROM lab_services
      ${includeInactive ? "" : "WHERE is_active"}
      ORDER BY is_active DESC, sort_order, name`,
  );
  return rows.map(toLabService);
}

export async function createLabService(
  draft: ServiceDraft, actor: string,
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureSchema();
  try {
    const { rows } = await getPool().query<{ id: number }>(
      `INSERT INTO lab_services (name, category, default_days, requires_shade, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [draft.name, draft.category, draft.defaultDays, draft.requiresShade, draft.sortOrder, actor],
    );
    return { ok: true, id: rows[0].id };
  } catch (error) {
    // اسمٌ مكرّر: الفهرس الفريد يمنعه، والرسالة تقول ما وقع لا «تعذّر الحفظ».
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "هذا العمل مسجَّل بالفعل." };
    }
    throw error;
  }
}

export async function updateLabService(
  id: number, draft: ServiceDraft,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  try {
    const { rowCount } = await getPool().query(
      `UPDATE lab_services
          SET name = $2, category = $3, default_days = $4, requires_shade = $5, sort_order = $6
        WHERE id = $1`,
      [id, draft.name, draft.category, draft.defaultDays, draft.requiresShade, draft.sortOrder],
    );
    if (!rowCount) return { ok: false, message: "العمل غير موجود." };
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "الاسم مستعمَل في عملٍ آخر." };
    }
    throw error;
  }
}

/**
 * يوقف عملًا ولا يحذفه.
 *
 * فالأوامر القديمة تشير إليه، وحذفُه يترك تقاريرها بلا اسمٍ للعمل — أو يمنع
 * الحذف بقيد المفتاح الأجنبي فتظهر رسالةٌ لا يفهمها المستخدم.
 */
export async function deactivateLabService(id: number): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE lab_services SET is_active = FALSE WHERE id = $1`, [id]);
  return Boolean(rowCount);
}

const toLabPrice = (row: Record<string, unknown>): LabPrice => ({
  id: row.id as number,
  partyId: row.party_id as number,
  serviceId: row.service_id as number,
  costMinor: Number(row.cost_minor),
  currency: row.currency as string,
  effectiveFrom: dateText(row.effective_from as Date),
  effectiveTo: row.effective_to ? dateText(row.effective_to as Date) : null,
});

/** أسعار مختبرٍ — أو أسعار الجميع حين لا يُذكر. */
export async function listLabPrices(partyId?: number): Promise<LabPrice[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, party_id, service_id, cost_minor, currency, effective_from, effective_to
       FROM lab_prices
      ${partyId ? "WHERE party_id = $1" : ""}
      ORDER BY party_id, service_id, effective_from DESC`,
    partyId ? [partyId] : [],
  );
  return rows.map(toLabPrice);
}

/**
 * يضيف سعرًا بعد فحص التداخل — **والتسلسل من القاعدة لا من الفحص.**
 *
 * وقفلُ الصفوف وحده لا يكفي: `FOR UPDATE` لا يقفل إلّا ما وُجد. فأوّلُ سعرٍ
 * لمختبرٍ وخدمة يقرأه طلبان متزامنان مجموعةً فارغة، فيمرّ كلاهما من الفحص
 * ويُدخلان مدّتين متداخلتين — وهي الحالة التي كُتب الفحص لمنعها. ولا صفَّ
 * يُقفل ولا قيدَ فريد يمنع (المدد ليست قيمةً واحدة تتكرّر).
 *
 * فقفلٌ استشاريّ على مستوى المعاملة بمفتاح الزوج (المختبر، الخدمة): طلبان
 * على الزوج نفسه يتسلسلان، والثاني يقرأ ما أدخله الأوّل فيُردّ «يتداخل».
 * ويُختار على قيد `EXCLUDE` لأنّ الأخير يحتاج امتداد `btree_gist` — وامتدادٌ
 * غير مثبَّت على قاعدة الإنتاج يجعل المخطط لا يُبنى أصلًا، وهو ثمنٌ أغلى من
 * القفل. ويُرفع القفل بانتهاء المعاملة نجحت أو فشلت، فلا يبقى معلّقًا.
 *
 * و`replacePrevious` هو استبدال السعر النافذ: يُغلق ما بدأ قبل الجديد في
 * اليوم السابق له، ثم يُدخل الجديد — في المعاملة نفسها وتحت القفل نفسه، فلا
 * تبقى لحظةٌ بلا سعرٍ ولا لحظةٌ بسعرين.
 */
export async function createLabPrice(input: {
  partyId: number; serviceId: number; costMinor: number; currency: string;
  effectiveFrom: string; effectiveTo: string | null; note: string | null; actor: string;
  replacePrevious?: boolean;
}): Promise<{ ok: true; id: number; closedIds: number[] } | { ok: false; message: string }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // قبل القراءة لا بعدها: قفلٌ بعد القراءة يترك الفجوة التي وقع فيها العطب.
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [input.partyId, input.serviceId]);
    const { rows: existing } = await client.query(
      `SELECT id, party_id, service_id, cost_minor, currency, effective_from, effective_to
         FROM lab_prices WHERE party_id = $1 AND service_id = $2 FOR UPDATE`,
      [input.partyId, input.serviceId],
    );
    const candidate = {
      partyId: input.partyId, serviceId: input.serviceId,
      effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
    };
    const current = existing.map(toLabPrice);

    let closedIds: number[] = [];
    let closeOn = "";
    let after = current;
    if (input.replacePrevious) {
      const plan = planReplacement(current, candidate);
      if (plan.blocking) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          message: `يوجد سعرٌ يبدأ في ${plan.blocking.effectiveFrom} — والاستبدال يُغلق ما بدأ قبل`
            + ` ${input.effectiveFrom} وحده. اختر تاريخ بدءٍ بعد ${plan.blocking.effectiveFrom}.`,
        };
      }
      closedIds = plan.closeIds;
      closeOn = plan.closeOn;
      after = plan.remaining;
    }

    const verdict = overlaps(after, candidate);
    if (!verdict.ok) {
      await client.query("ROLLBACK");
      return { ok: false, message: verdict.message };
    }
    if (closedIds.length > 0) {
      await client.query(
        `UPDATE lab_prices SET effective_to = $2::date WHERE id = ANY($1::int[])`,
        [closedIds, closeOn],
      );
    }
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO lab_prices
         (party_id, service_id, cost_minor, currency, effective_from, effective_to, note, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8) RETURNING id`,
      [
        input.partyId, input.serviceId, input.costMinor, input.currency,
        input.effectiveFrom, input.effectiveTo, input.note, input.actor,
      ],
    );
    await client.query("COMMIT");
    return { ok: true, id: rows[0].id, closedIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** يُغلق سعرًا ساريًا بتاريخ نهاية — فيبقى تاريخًا ولا يُحذف. */
export async function closeLabPrice(
  id: number, effectiveTo: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE lab_prices SET effective_to = $2::date
      WHERE id = $1 AND (effective_to IS NULL OR effective_to > $2::date)
        AND effective_from <= $2::date`,
    [id, effectiveTo],
  );
  if (!rowCount) {
    return { ok: false, message: "تاريخ الإغلاق قبل بدء السريان، أو السعر مُغلق أصلًا." };
  }
  return { ok: true };
}

/** السعر المتّفق عليه لعملٍ عند مختبرٍ يوم كذا — أو لا شيء. */
export async function agreedLabPrice(
  partyId: number, serviceId: number, onDate: string,
): Promise<LabPrice | null> {
  return priceOn(await listLabPrices(partyId), partyId, serviceId, onDate);
}

/**
 * وقائع الجاهزية — تُقرأ كلُّها من مصدرها لا من ظنّ.
 *
 * والحكم عليها في `lib/readiness.ts` وحده: هنا القراءة، وهناك القول أيهما يمنع
 * وأيهما يُنبَّه عليه. وخلطُ الاثنين يجعل تغيير حدٍّ يمرّ بلا اختبار.
 *
 * وسعرُ الصرف يُؤرَّخ بـ`settings.updated_at` لكلّ مفتاحِ سعرٍ **على حدة**: تعديلُ
 * اسم المركز لا يجعل السعر حديثًا، وتصحيحُ الدولار اليوم لا يجعل السعوديّ حديثًا.
 * والصفُّ الغائب `null` — مفتاحٌ لم يُحفظ قطّ يعني قيمةً افتراضيّة من الكود.
 */
export async function readinessFacts(): Promise<ReadinessFacts> {
  await ensureSchema();
  const settings = await getSettingsSafe();
  const today = clinicDateString(new Date(), CLINIC_TIME_ZONE);
  const zone = CLINIC_TIME_ZONE;

  const { rows } = await getPool().query<{
    sar_rate_on: string | null;
    usd_rate_on: string | null;
    users_by_role: Record<string, number> | null;
    doctors: string;
    doctors_no_percent: string;
    labs: string;
    services: string;
    services_priced: string;
    backup_on: string | null;
    open_shift_days: string | null;
    lab_orders_no_doctor: string;
  }>(
    // `key` مفتاحٌ أوّليّ، فصفٌّ واحد لكلّ سعر أو لا صفّ — ولا حاجة إلى `MAX`،
    // بل هو ما كان يستر الأقدم خلف الأحدث.
    `SELECT
       (SELECT (updated_at AT TIME ZONE $1)::date::text FROM settings
         WHERE key = 'finance.rate.SAR')                                   AS sar_rate_on,
       (SELECT (updated_at AT TIME ZONE $1)::date::text FROM settings
         WHERE key = 'finance.rate.USD')                                   AS usd_rate_on,
       (SELECT jsonb_object_agg(role, n) FROM
          (SELECT role, COUNT(*)::int AS n FROM users WHERE is_active GROUP BY role) r)
                                                                          AS users_by_role,
       (SELECT COUNT(*) FROM parties WHERE kind = 'doctor' AND is_active)  AS doctors,
       (SELECT COUNT(*) FROM parties
         WHERE kind = 'doctor' AND is_active AND commission_percent <= 0)  AS doctors_no_percent,
       (SELECT COUNT(*) FROM parties WHERE kind = 'lab' AND is_active)     AS labs,
       (SELECT COUNT(*) FROM services WHERE is_active)                     AS services,
       -- والمسعَّرة وحدها تصلح لزيارة: validateProcedures يردّ ما عداها.
       (SELECT COUNT(*) FROM services WHERE is_active AND price_configured) AS services_priced,
       -- backup.complete لا backup.download: الثاني يُكتب قبل أوّل بايت،
       -- ويكتبه أرشيفُ الأشعّة وحده أيضًا. والأوّل بعد اكتمال البثّ ولا شيء غيره.
       (SELECT MAX((created_at AT TIME ZONE $1)::date)::text FROM audit_log
         WHERE action = 'backup.complete')                                 AS backup_on,
       -- فرقُ تاريخَي العيادة لا طرحُ ثوانٍ: وردية أمس مساءً عبرت يومًا وإن لم
       -- يمضِ عليها أربعٌ وعشرون ساعة. واليمن على +٣ فالتحويل بمنطقة العيادة.
       (SELECT (((NOW() AT TIME ZONE $1)::date - (opened_at AT TIME ZONE $1)::date))::text
          FROM cashier_shifts WHERE status = 'open' LIMIT 1)               AS open_shift_days,
       (SELECT COUNT(*) FROM lab_orders
         WHERE doctor_party_id IS NULL AND COALESCE(cost_minor, 0) > 0)    AS lab_orders_no_doctor`,
    [zone],
  );
  const row = rows[0];

  return {
    clinicName: settings["clinic.name"] ?? "",
    clinicPhone: settings["clinic.phone"] ?? "",
    baseCurrency: settings["finance.base_currency"] ?? "",
    ratesUpdatedOn: { SAR: row?.sar_rate_on ?? null, USD: row?.usd_rate_on ?? null },
    activeUsersByRole: row?.users_by_role ?? {},
    doctorCount: Number(row?.doctors ?? 0),
    doctorsWithoutPercent: Number(row?.doctors_no_percent ?? 0),
    labPartyCount: Number(row?.labs ?? 0),
    serviceCount: Number(row?.services ?? 0),
    servicesPriced: Number(row?.services_priced ?? 0),
    lastBackupOn: row?.backup_on ?? null,
    setupTokenLive: setupTokenIsLive(process.env.SETUP_TOKEN),
    openShiftAgeDays: row?.open_shift_days === null || row?.open_shift_days === undefined
      ? null : Number(row.open_shift_days),
    labOrdersWithoutDoctor: Number(row?.lab_orders_no_doctor ?? 0),
    today,
  };
}

/**
 * مواعيد المريض من تاريخٍ فصاعدًا — لبطاقته.
 *
 * والتاريخ يُمرَّر ولا يُؤخذ من `CURRENT_DATE`: تلك تاريخُ خادم القاعدة بتوقيت UTC،
 * واليمن على +٣. فبطاقةٌ تُطبع بعد التاسعة مساءً تُسقط موعد الغد أو تُبقي موعد
 * أمس، والفرقُ لا يظهر إلّا مساءً فيُقرأ عطلًا عشوائيًّا.
 *
 * والتصفية بالحالة في `lib/patientCard.ts` لا هنا: القراءة تجلب، والحكمُ يُختبر.
 */
export async function patientAppointmentsFrom(
  patientId: number,
  fromDate: string,
): Promise<Appointment[]> {
  await ensureSchema();
  const { rows } = await getPool().query<AppointmentRow>(
    `${APPOINTMENT_SELECT}
      WHERE a.patient_id = $1 AND a.scheduled_date >= $2
      ORDER BY a.scheduled_date, a.scheduled_time`,
    [patientId, fromDate],
  );
  return rows.map(toAppointment);
}
