#!/usr/bin/env node
import { Client } from "pg";

/**
 * هل يُبنى المخطط من الصفر؟
 *
 * السؤال الذي لا يجيب عنه أي اختبار وحدة، ولا تكشفه أي قاعدة قائمة: الجدول الناقص
 * موجودٌ فيها من قبل، فيمرّ الخلل صامتًا إلى أن يُنشأ نظام جديد — عند مزوّد جديد، أو
 * في بيئة تجربة، أو يوم استعادة من نسخة احتياطية بعد كارثة. وأسوأ وقت لاكتشاف أن
 * برنامجك لا يُثبَّت هو اليوم الذي تحتاج فيه إلى تثبيته.
 *
 * يبني قاعدة مؤقتة، ينشئ المخطط فيها، يتحقق من الجداول، ثم يحذفها.
 *
 *   الاستعمال: DATABASE_URL=postgresql://… node scripts/verify-schema.mjs
 */

const source = process.env.DATABASE_URL ?? "";
if (!source.trim()) {
  console.error("خطأ: DATABASE_URL غير مضبوط.");
  process.exit(1);
}

// جداول يجب أن توجد كلها بعد الإنشاء — أي نقص يعني مخططًا لم يكتمل.
const REQUIRED = [
  "visits", "patients", "appointments", "booking_requests", "lab_orders",
  "settings", "users", "services", "cashier_shifts", "invoices", "invoice_items",
  "payments", "parties", "expenses", "payables", "journal_manual",
  "journal_manual_lines", "treatment_plans", "plan_installments",
  "patient_opening_balances",
];

const temporary = `schema_check_${Date.now()}`;
const admin = new Client({ connectionString: source, ssl: sslFor(source) });

function sslFor(url) {
  const lowered = url.toLowerCase();
  if (lowered.includes("sslmode=disable")) return false;
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(lowered)) return false;
  return { rejectUnauthorized: false };
}

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

let failed = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${temporary}`);
  console.log(`أُنشئت قاعدة مؤقتة: ${temporary}`);

  const target = withDatabase(source, temporary);
  process.env.DATABASE_URL = target;
  const { ensureSchema, getPool } = await import("../lib/db.ts");

  await ensureSchema();
  console.log("نجح إنشاء المخطط من الصفر.");

  const { rows } = await getPool().query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const found = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED.filter((name) => !found.has(name));
  if (missing.length > 0) {
    console.error(`جداول ناقصة: ${missing.join("، ")}`);
    failed = true;
  } else {
    console.log(`كل الجداول المطلوبة موجودة (${REQUIRED.length}).`);
  }
  await getPool().end();
} catch (error) {
  console.error(`فشل إنشاء المخطط: ${error.message}`);
  failed = true;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${temporary}`).catch(() => {});
  await admin.end().catch(() => {});
  console.log(`حُذفت القاعدة المؤقتة: ${temporary}`);
}
process.exit(failed ? 1 : 0);
