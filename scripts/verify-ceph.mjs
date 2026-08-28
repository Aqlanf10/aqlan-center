#!/usr/bin/env node
import "./load-env.mjs";
import { Client } from "pg";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * هل التتبّع السيفالومتري سجلٌّ يُعتمد عليه؟
 *
 * السؤال الحاكم: **هل تُشتقّ القياسات من النقاط في كل قراءة؟** لو خُزّنت الزوايا
 * لصار للحقيقة مصدران — يُصحَّح موضع نقطةٍ بعد مراجعة، فتبقى الزاوية القديمة في
 * الجدول وتُبنى عليها خطة علاجٍ لسنتين. وهذا الفحص يحرّك نقطةً ويشترط أن يتغيّر
 * التصنيف تبعًا لها.
 */

const source = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!source.trim()) { console.error("خطأ: SOURCE_DATABASE_URL غير مضبوط."); process.exit(1); }

const sslFor = (url) => {
  const l = url.toLowerCase();
  if (l.includes("sslmode=disable")) return false;
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(l)) return false;
  return { rejectUnauthorized: false };
};
const withDatabase = (url, name) => {
  const parsed = new URL(url); parsed.pathname = `/${name}`; return parsed.toString();
};

const temporary = `ceph_check_${Date.now()}`;
process.env.DATABASE_URL = withDatabase(source, temporary);
const store = mkdtempSync(join(tmpdir(), "ceph-"));
process.env.DOCUMENTS_DIR = store;

const admin = new Client({ connectionString: source, ssl: sslFor(source) });
let failed = false;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

// وجهٌ سويّ محسوب: A وB على شعاعين يبعدان ٨٢° و٨٠° عن شعاع N→S.
const NORMAL = {
  S: { x: 0.34, y: 0.235 },
  N: { x: 0.62, y: 0.26 },
  A: { x: 0.5588, y: 0.5230 },
  B: { x: 0.5158, y: 0.6462 },
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${temporary}`);
  const db = await import("../lib/db.ts");
  const files = await import("../lib/files.ts");
  await db.ensureSchema();

  const patient = await db.createPatient({
    fullName: "مريض السيفالو", phone: "770223344", altPhone: null, gender: "female",
    birthYear: 2010, address: null, medicalAlert: null, note: null,
  });
  const stored = await files.putFile(PNG, "png");
  const xray = await db.recordDocument({
    patientId: patient.id, visitId: null, kind: "xray", title: "سيفالومتري جانبي",
    mimeType: "image/png", sizeBytes: stored.sizeBytes, sha256: stored.sha256,
    storageKey: stored.key, note: null, takenOn: "2026-08-01", uploadedBy: "فحص",
  });
  const pdf = await db.recordDocument({
    patientId: patient.id, visitId: null, kind: "report", title: "تقرير",
    mimeType: "application/pdf", sizeBytes: 10, sha256: "b".repeat(64),
    storageKey: "bb/bb/" + "b".repeat(64) + ".pdf", note: null, takenOn: null, uploadedBy: "فحص",
  });

  console.log("\n  ── التتبّع يُحفظ والقياس يُشتقّ ──");

  const saved = await db.saveCephTracing({
    documentId: xray.id, points: NORMAL, calibration: null, note: null, actor: "فحص",
  });
  check("حُفظ التتبّع", saved.ok, saved.ok ? `رقم ${saved.id}` : saved.message);

  const read = await db.getCephTracing(xray.id);
  check("النقاط الأربع محفوظة", Object.keys(read.points).length === 4);
  const sna = read.analysis.measurements.find((m) => m.key === "SNA");
  const snb = read.analysis.measurements.find((m) => m.key === "SNB");
  const anb = read.analysis.measurements.find((m) => m.key === "ANB");
  check("SNA ٨٢", Math.abs(sna.value - 82) < 0.1, sna.value.toFixed(2));
  check("SNB ٨٠", Math.abs(snb.value - 80) < 0.1, snb.value.toFixed(2));
  check("ANB ٢ والتصنيف الأول",
    Math.abs(anb.value - 2) < 0.1 && read.analysis.skeletal.klass === "I", anb.value.toFixed(2));

  const { rows: columns } = await db.getPool().query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ceph_tracings' AND column_name IN ('sna','snb','anb','angles','measurements')`,
  );
  check("ولا عمود للزوايا في الجدول — تُشتقّ لا تُخزَّن", columns.length === 0,
    columns.map((c) => c.column_name).join("، ") || "لا شيء");

  console.log("\n  ── تصحيح نقطةٍ يُغيّر التحليل كلّه ──");

  const moved = { ...NORMAL, B: { x: 0.44, y: 0.66 } };
  await db.saveCephTracing({
    documentId: xray.id, points: moved, calibration: null, note: "صُحّح موضع B", actor: "مراجِع",
  });
  const after = await db.getCephTracing(xray.id);
  check("التصنيف تبع النقطة", after.analysis.skeletal.klass === "II",
    `ANB ${after.analysis.skeletal.anb.toFixed(2)}`);
  check("وتتبّعٌ واحد للصورة لا اثنان",
    (await db.listPatientTracings(patient.id)).length === 1);
  check("والتصحيح مسجَّل باسمه", after.updatedBy === "مراجِع" && after.tracedBy === "فحص");

  console.log("\n  ── الحراسة ──");

  const onPdf = await db.saveCephTracing({
    documentId: pdf.id, points: NORMAL, calibration: null, note: null, actor: "فحص",
  });
  check("لا تتبّع على مستند غير صورة", !onPdf.ok, onPdf.ok ? "" : onPdf.message);

  const ghost = await db.saveCephTracing({
    documentId: 99999, points: NORMAL, calibration: null, note: null, actor: "فحص",
  });
  check("ولا على صورة غير موجودة", !ghost.ok);

  await db.saveCephTracing({
    documentId: xray.id, actor: "فحص", note: null, calibration: null,
    points: { ...NORMAL, ZZ: { x: 0.5, y: 0.5 }, S: { x: 9, y: -3 } },
  });
  const cleaned = await db.getCephTracing(xray.id);
  check("رمزٌ مخترَع يُهمَل", !("ZZ" in cleaned.points));
  check("ونقطةٌ خارج الصورة تُهمَل", !cleaned.points.S);
  check("وما سواها يبقى", Object.keys(cleaned.points).length === 3,
    Object.keys(cleaned.points).join("، "));

  console.log("\n  ── المعايرة ──");

  await db.saveCephTracing({
    documentId: xray.id, points: NORMAL, actor: "فحص", note: null,
    calibration: { from: { x: 0.1, y: 0.9 }, to: { x: 0.3, y: 0.9 }, millimetres: 20 },
  });
  const calibrated = await db.getCephTracing(xray.id);
  check("المعايرة محفوظة ومقبولة", calibrated.analysis.calibrated);

  await db.saveCephTracing({
    documentId: xray.id, points: NORMAL, actor: "فحص", note: null,
    calibration: { from: { x: 0.1, y: 0.9 }, to: { x: 0.1, y: 0.9 }, millimetres: 20 },
  });
  const bad = await db.getCephTracing(xray.id);
  check("ومعايرةٌ بطول صفر تُرفض", !bad.analysis.calibrated && bad.calibration === null);

  console.log("\n  ── حذف الصورة يحذف تتبّعها ──");

  await db.getPool().query(`DELETE FROM patient_documents WHERE id = $1`, [xray.id]);
  check("لم يبقَ تتبّعٌ يتيم", (await db.listPatientTracings(patient.id)).length === 0);

  await db.getPool().end();
} catch (error) {
  console.error(`فشل: ${error.message}`);
  failed = true;
} finally {
  rmSync(store, { recursive: true, force: true });
  await admin.query(`DROP DATABASE IF EXISTS ${temporary}`).catch(() => {});
  await admin.end().catch(() => {});
}
console.log(failed
  ? "\nسقط الفحص."
  : "\nالتتبّع سليم: النقاط تُحفظ، والقياس يُشتقّ منها في كل قراءة لا يُخزَّن بجانبها.");
process.exit(failed ? 1 : 0);
