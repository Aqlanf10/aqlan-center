#!/usr/bin/env node
import { pgConnection } from "../lib/pgConnection.ts";
import "./load-env.mjs";
import { Client } from "pg";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePng } from "./journeys/png.mjs";

/**
 * هل الدراسة السيفالومترية وثيقةٌ يُعتمد عليها؟
 *
 * والسؤال الحاكم واحد: **هل تتغيّر الدراسة المعتمدة تحت من اعتمدها؟**
 *
 * قبل هذا الكيان كان التتبّع صفًّا واحدًا لكل صورة يُكتب فوقه: من يصحّح نقطةً
 * اليوم يغيّر — بأثرٍ رجعي وبلا أثرٍ في السجل — الأرقامَ التي بُنيت عليها خطّةُ
 * علاجٍ قبل سنة. فالخطّة تبقى في الملف، والأرقام التي بُرِّرت بها تصير غيرها.
 *
 * ثم ثلاثةٌ بعده: أتُعتمد دراسةٌ ناقصة؟ أتُربط بحالة تقويم مريضٍ آخر؟ وهل يبقى
 * القياس **مشتقًّا** بعد التجميد — أم صار للحقيقة مصدران؟
 */

const source = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!source.trim()) { console.error("خطأ: SOURCE_DATABASE_URL غير مضبوط."); process.exit(1); }

const withDatabase = (url, name) => {
  const parsed = new URL(url); parsed.pathname = `/${name}`; return parsed.toString();
};

const temporary = `ceph_study_check_${Date.now()}`;
process.env.DATABASE_URL = withDatabase(source, temporary);
const store = mkdtempSync(join(tmpdir(), "ceph-study-"));
process.env.DOCUMENTS_DIR = store;

const admin = new Client(pgConnection(source));
let failed = false;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

/** وجهٌ سويّ محسوب: A وB على شعاعين يبعدان ٨٢° و٨٠° عن شعاع N→S. */
const NORMAL = {
  S: { x: 0.34, y: 0.235 },
  N: { x: 0.62, y: 0.26 },
  A: { x: 0.5588, y: 0.5230 },
  B: { x: 0.5158, y: 0.6462 },
  Or: { x: 0.40, y: 0.40 }, Po: { x: 0.25, y: 0.42 },
  Go: { x: 0.30, y: 0.70 }, Me: { x: 0.55, y: 0.80 },
  Gn: { x: 0.54, y: 0.78 }, Pog: { x: 0.53, y: 0.75 },
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${temporary}`);
  const db = await import("../lib/db.ts");
  const files = await import("../lib/files.ts");
  await db.ensureSchema();

  const patient = await db.createPatient({
    fullName: "مريضة الدراسة", phone: "770556677", altPhone: null, gender: "female",
    birthYear: 2010, address: null, medicalAlert: null, note: null,
  });
  const other = await db.createPatient({
    fullName: "مريض آخر", phone: "770998877", altPhone: null, gender: "male",
    birthYear: 2008, address: null, medicalAlert: null, note: null,
  });
  const stored = await files.putFile(PNG, "png");
  const xray = await db.recordDocument({
    patientId: patient.id, visitId: null, kind: "xray", title: "سيفالومتري جانبي",
    mimeType: "image/png", sizeBytes: stored.sizeBytes, sha256: stored.sha256,
    storageKey: stored.key, note: null, takenOn: "2026-08-01", uploadedBy: "فحص",
  });
  const report = await db.recordDocument({
    patientId: patient.id, visitId: null, kind: "report", title: "تقرير",
    mimeType: "application/pdf", sizeBytes: 10, sha256: "c".repeat(64),
    storageKey: "cc/cc/" + "c".repeat(64) + ".pdf", note: null, takenOn: null, uploadedBy: "فحص",
  });
  const ourCase = await db.createOrthoCase({
    patientId: patient.id, appliance: "fixed", arches: "both", slot: "022",
    bracketSystem: null, startDate: "2026-01-05", plannedMonths: 18,
    planId: null, note: null, createdBy: "فحص",
  });
  const strangerCase = await db.createOrthoCase({
    patientId: other.id, appliance: "fixed", arches: "both", slot: "022",
    bracketSystem: null, startDate: "2026-02-05", plannedMonths: 18,
    planId: null, note: null, createdBy: "فحص",
  });

  await db.saveCephTracing({
    documentId: xray.id, points: NORMAL, calibration: null, note: null, actor: "فحص",
  });

  console.log("\n  ── الدراسة تُنشأ على أشعّةٍ للمريض نفسه ──");

  const onReport = await db.createCephStudy({
    documentId: report.id, phase: "pre", orthoCaseId: null,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  check("لا دراسة على مستندٍ ليس صورة", !onReport.ok, onReport.message ?? "");

  const badPhase = await db.createCephStudy({
    documentId: xray.id, phase: "during", orthoCaseId: null,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  check("ولا مرحلةَ علاجٍ مخترَعة", !badPhase.ok, badPhase.message ?? "");

  const strangerLink = await db.createCephStudy({
    documentId: xray.id, phase: "pre", orthoCaseId: strangerCase.id,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  check("ولا ربطَ بحالة تقويمٍ لمريضٍ آخر — الربط الخاطئ يضع أشعّةً في ملف علاج غيره",
    !strangerLink.ok, strangerLink.message ?? "");

  const made = await db.createCephStudy({
    documentId: xray.id, phase: "pre", orthoCaseId: ourCase.id,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  check("وأُنشئت الدراسة", made.ok, made.ok ? `رقم ${made.id}` : made.message);
  const studyId = made.id;

  const second = await db.createCephStudy({
    documentId: xray.id, phase: "pre", orthoCaseId: null,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  check("ومسودّةٌ ثانية على الأشعّة نفسها مرفوضة — طبيبان على نسختين لا يعرف أحدهما بالآخر",
    !second.ok, second.message ?? "");

  console.log("\n  ── الاعتماد توقيعٌ لا حفظ ──");

  const beforeApproval = await db.getCephStudy(studyId);
  check("المسودّة تُقرأ من التتبّع الحيّ", beforeApproval.landmarks === 10, `${beforeApproval.landmarks} معلمًا`);
  check("ولا انحرافَ يُحسب لها — هي التتبّع نفسه", beforeApproval.drifted === false);

  const approved = await db.approveCephStudy({ id: studyId, actor: "د. عقلان" });
  check("اعتُمدت", approved.ok, approved.message ?? "");

  const again = await db.approveCephStudy({ id: studyId, actor: "د. عقلان" });
  check("ولا تُعتمد مرّتين", !again.ok, again.message ?? "");

  const signed = await db.getCephStudy(studyId);
  check("وباسم من وقّعها", signed.approvedBy === "د. عقلان", signed.approvedBy ?? "");

  const analysisBefore = await db.cephStudyAnalysis(studyId);
  const snaBefore = analysisBefore.analysis.measurements.find((m) => m.key === "SNA").value;
  check("وقياسُها SNA ٨٢", Math.abs(snaBefore - 82) < 0.1, snaBefore.toFixed(2));

  console.log("\n  ── ثم يُصحَّح التتبّع بعد سنة ──");

  await db.saveCephTracing({
    documentId: xray.id,
    // A تتحرّك: SNA يتغيّر — وهذا هو بالضبط ما كان يعيد كتابة الماضي.
    points: { ...NORMAL, A: { x: 0.60, y: 0.50 } },
    calibration: null, note: null, actor: "زميل",
  });

  const live = await db.getCephTracing(xray.id);
  const snaLive = live.analysis.measurements.find((m) => m.key === "SNA").value;
  check("التتبّع الحيّ تغيّر", Math.abs(snaLive - snaBefore) > 1,
    `${snaBefore.toFixed(2)} ← ${snaLive.toFixed(2)}`);

  const analysisAfter = await db.cephStudyAnalysis(studyId);
  const snaAfter = analysisAfter.analysis.measurements.find((m) => m.key === "SNA").value;
  check("**والدراسة المعتمدة لم تتغيّر** — أرقامُها أرقامُ يوم اعتُمدت",
    Math.abs(snaAfter - snaBefore) < 0.001, snaAfter.toFixed(2));

  const drifted = await db.getCephStudy(studyId);
  check("والشاشة تُعلم أن التتبّع تغيّر بعدها — لا تكتمه",
    drifted.drifted === true);

  console.log("\n  ── القياس يبقى مشتقًّا: لقطةُ معالمَ لا زوايا ──");

  const { rows: columns } = await db.getPool().query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'ceph_studies'`);
  const names = columns.map((row) => row.column_name);
  check("الجدول موجود — وإلّا لمرّ الفحص التالي بلا شيء", names.length > 0, `${names.length} عمودًا`);
  // بالاسم الكامل لا بجزءٍ منه: `snapshot_points` يبدأ بـ«sna» فيُمسك بالخطأ،
  // فيسقط فحصٌ سليم — وفحصٌ يسقط بلا سبب يُعلَّم من يقرأه أن يتجاهله.
  const derivedColumns = ["sna", "snb", "anb", "angles", "measurements", "analysis"];
  check("ولا عمودَ لزاويةٍ أو قياسٍ محفوظ — اللقطة معالمُ لا أرقام",
    !names.some((name) => derivedColumns.includes(name)),
    names.filter((name) => name.startsWith("snapshot")).join("، "));

  console.log("\n  ── الإصدار التالي ──");

  const revision = await db.createCephStudy({
    documentId: xray.id, phase: "pre", orthoCaseId: ourCase.id,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  check("تُنشأ مسودّةٌ جديدة بعد أن اعتُمدت الأولى", revision.ok, revision.message ?? "");
  const all = await db.listPatientStudies(patient.id);
  check("وترقيمُها اثنان — الإصدارات تتراكم ولا تُستبدل",
    all.find((study) => study.id === revision.id)?.revision === 2);
  check("والأولى باقيةٌ معتمدة",
    all.find((study) => study.id === studyId)?.status === "approved");

  const revisionAnalysis = await db.cephStudyAnalysis(revision.id);
  const snaRevision = revisionAnalysis.analysis.measurements.find((m) => m.key === "SNA").value;
  check("والإصدار الجديد يقرأ التتبّع الحالي لا القديم",
    Math.abs(snaRevision - snaLive) < 0.001, snaRevision.toFixed(2));

  console.log("\n  ── الأرشفة والربط ──");

  const archived = await db.archiveCephStudy({ id: revision.id });
  check("تُؤرشف المسودّة", archived.ok, archived.message ?? "");
  const reArchive = await db.archiveCephStudy({ id: revision.id });
  check("ولا تُؤرشف مرّتين", !reArchive.ok, reArchive.message ?? "");
  const archivedApprove = await db.approveCephStudy({ id: revision.id, actor: "فحص" });
  check("ولا تُعتمد المؤرشفة", !archivedApprove.ok, archivedApprove.message ?? "");

  const wrongLink = await db.linkStudyToCase({ id: studyId, orthoCaseId: strangerCase.id });
  check("ولا تُربط بحالةِ مريضٍ آخر بعد الإنشاء أيضًا", !wrongLink.ok, wrongLink.message ?? "");
  const unlink = await db.linkStudyToCase({ id: studyId, orthoCaseId: null });
  check("ويُفكّ الربط", unlink.ok);
  const relink = await db.linkStudyToCase({ id: studyId, orthoCaseId: ourCase.id });
  check("ويُعاد", relink.ok);

  const caseStudies = await db.listCaseStudies(ourCase.id);
  check("وحالةُ التقويم تعرف دراساتها كلَّها — الترابط في الاتجاهين",
    caseStudies.length === 2
      && caseStudies.some((study) => study.id === studyId)
      && caseStudies.some((study) => study.id === revision.id),
    `${caseStudies.length} دراسة`);
  check("ولا تُرى فيها دراسةُ حالةٍ أخرى",
    (await db.listCaseStudies(strangerCase.id)).length === 0);

  console.log("\n  ── نسبةُ الأشعّة تدخل الحساب: الورقة تقول ما تقوله الشاشة ──");

  /*
   * أخطرُ ما في هذا الملف.
   *
   * المعالم كسورٌ من العرض والارتفاع، فنسبةُ الصورة تدخل حساب الزاوية. والشاشة
   * تعرفها لأن المتصفّح حمّل الصورة؛ **وصفحة الطباعة لا ترسلها** — فكانت تُحسب
   * على ١. وعلى أشعّةٍ ٤:٥ تُقاس FMA ‏٣٦٫٠° على الشاشة و‏٢٩٫٤° على الورقة، وستّ
   * درجاتٍ ونصف هي الفرق بين نمطٍ عمودي مرتفع ونمطٍ سويّ.
   *
   * والفحص القديم كان يمرّ **بالصدفة**: صورته مربّعة فالنسبة ١ فيتطابق الرقمان.
   * فالصورة هنا ٢٠٠٠×٢٥٠٠ عمدًا.
   */
  const tall = makePng(200, 250);
  const tallStored = await files.putFile(tall, "png");
  const tallXray = await db.recordDocument({
    patientId: patient.id, visitId: null, kind: "xray", title: "أشعّة غير مربّعة",
    mimeType: "image/png", sizeBytes: tallStored.sizeBytes, sha256: tallStored.sha256,
    storageKey: tallStored.key, note: null, takenOn: "2026-09-01", uploadedBy: "فحص",
    imageWidth: 200, imageHeight: 250,
  });
  await db.saveCephTracing({
    documentId: tallXray.id, points: NORMAL, calibration: null, note: null, actor: "فحص",
  });

  const onScreen = await db.getCephTracing(tallXray.id, 200 / 250);
  const onPaper = await db.getCephTracing(tallXray.id);
  const pick = (reading, key) => reading.analysis.measurements.find((m) => m.key === key).value;

  check("النسبة المحفوظة تُقرأ من الملف", tallXray.imageWidth === 200 && tallXray.imageHeight === 250,
    `${tallXray.imageWidth}×${tallXray.imageHeight}`);
  for (const key of ["SNA", "SNB", "ANB", "FMA"]) {
    check(`${key}: الورقة تقول ما تقوله الشاشة`,
      Math.abs(pick(onPaper, key) - pick(onScreen, key)) < 0.001,
      `${pick(onScreen, key).toFixed(2)} = ${pick(onPaper, key).toFixed(2)}`);
  }

  const asSquare = await db.getCephTracing(tallXray.id, 1);
  check("ولولا النسبة لاختلفتا — وهذا هو العطل الذي أُصلح",
    Math.abs(pick(asSquare, "FMA") - pick(onPaper, "FMA")) > 3,
    `مربّعة ${pick(asSquare, "FMA").toFixed(2)}° مقابل ${pick(onPaper, "FMA").toFixed(2)}°`);

  const tallStudy = await db.createCephStudy({
    documentId: tallXray.id, phase: "post", orthoCaseId: null,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  await db.approveCephStudy({ id: tallStudy.id, actor: "د. عقلان" });
  const tallAnalysis = await db.cephStudyAnalysis(tallStudy.id);
  const studyFma = tallAnalysis.analysis.measurements.find((m) => m.key === "FMA").value;
  check("ولقطةُ الدراسة تُحسب بالنسبة نفسها",
    Math.abs(studyFma - pick(onScreen, "FMA")) < 0.001, studyFma.toFixed(2));

  console.log("\n  ── دراسةٌ ناقصة لا تُعتمد ──");

  const bare = await files.putFile(Buffer.concat([PNG, Buffer.from([0])]), "png");
  const secondXray = await db.recordDocument({
    patientId: patient.id, visitId: null, kind: "xray", title: "أشعّة ثانية",
    mimeType: "image/png", sizeBytes: bare.sizeBytes, sha256: bare.sha256,
    storageKey: bare.key, note: null, takenOn: "2026-09-01", uploadedBy: "فحص",
  });
  await db.saveCephTracing({
    documentId: secondXray.id, points: { S: NORMAL.S, N: NORMAL.N, A: NORMAL.A },
    calibration: null, note: null, actor: "فحص",
  });
  const thin = await db.createCephStudy({
    documentId: secondXray.id, phase: "mid", orthoCaseId: null,
    title: null, takenOn: null, note: null, actor: "فحص",
  });
  const thinApproval = await db.approveCephStudy({ id: thin.id, actor: "فحص" });
  check("ثلاث نقاطٍ لا تُعتمد — والرسالة تقول كم ينقص",
    !thinApproval.ok && /\d/.test(thinApproval.message ?? ""), thinApproval.message ?? "");

  await db.getPool().end();
} catch (error) {
  console.error(`فشل: ${error.message}`);
  failed = true;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${temporary}`).catch(() => {});
  await admin.end().catch(() => {});
  rmSync(store, { recursive: true, force: true });
}
console.log(failed
  ? "\nسقط الفحص."
  : "\nالدراسة وثيقة: المعتمدة لا تتغيّر تحت من اعتمدها، والقياس يبقى مشتقًّا.");
process.exit(failed ? 1 : 0);
