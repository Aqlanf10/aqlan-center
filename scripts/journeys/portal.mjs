#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";

/**
 * رحلة بوابة المريض — من هاتف المريض لا من جهاز المركز.
 *
 * وتفحص ما لا يفحصه اختبار وحدة ولا فحص قاعدة: أن مريضًا يفتح الرابط على هاتفه
 * فيدخل بعاملين يحفظهما، فيرى **رقمه** ومواعيده، ويؤكّد حضوره بضغطةٍ واحدة —
 * ثم لا يُعرض له الزرّ ثانية.
 *
 * وتفحص العزل من الجهة الأخرى كذلك: **جلسة البوابة في سياق متصفّح منفصل**، ولا
 * تفتح شيئًا من شاشات المركز.
 *
 *   الاستعمال: node scripts/journeys/portal.mjs <مجلد-الصور>
 */

const OUT = process.argv[2] ?? ".";
const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const chromium = await loadChromium();

const b = await chromium.launch({ executablePath });
let failed = false;
const say = (label, ok, extra = "") => {
  console.log(`   ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

// ١) الطاقم يُنشئ المريض وموعده — كما يقع في المركز.
const staff = await (await b.newContext({ locale: "ar" })).newPage();
await login(staff, { base: BASE, user: USER, pass: PASS });

const stamp = Date.now().toString();
const name = "مريضة البوابة " + stamp.slice(-4);
const phone = "77" + stamp.slice(-7);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const seeded = await staff.evaluate(async ({ patientName, patientPhone, date }) => {
  const made = await fetch("/api/patients", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: patientName, phone: patientPhone, gender: "female" }),
  });
  if (!made.ok) return { ok: false, step: "patient", status: made.status };
  const patient = await made.json();
  const booked = await fetch("/api/appointments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId: patient.id, date, time: "10:00", durationMinutes: 30 }),
  });
  return {
    ok: booked.ok, step: "appointment", status: booked.status,
    patientNumber: patient.patientNumber, patientId: patient.id,
  };
}, { patientName: name, patientPhone: phone, date: tomorrow });
console.log("1) الطاقم أنشأ الملف والموعد:", seeded.ok ? `✓ ${seeded.patientNumber}` : `✗ (${seeded.step} ${seeded.status})`);

// ٢) المريض على هاتفه — سياق متصفّح منفصل تمامًا، بلا كوكي الطاقم.
const phoneContext = await b.newContext({
  viewport: { width: 390, height: 844 }, locale: "ar",
});
const patientPage = await phoneContext.newPage();
await patientPage.goto(BASE + "/portal", { waitUntil: "networkidle" });
await patientPage.waitForTimeout(1500);
say("البوابة تُفتح بلا جلسة وتطلب الدخول",
  (await patientPage.getByLabel("رقم الملف").count()) > 0);

// دخولٌ خاطئ أوّلًا: الرسالة لا تقول أين الخطأ.
await patientPage.getByLabel("رقم الجوال").fill(phone);
await patientPage.getByLabel("رقم الملف").fill("P-99999");
await patientPage.getByRole("button", { name: "دخول" }).click();
await patientPage.waitForTimeout(2000);
const refused = await patientPage.getByRole("alert").first().innerText()
  .catch((error) => "تعذّر: " + String(error).slice(0, 80));
say("ودخولٌ خاطئ يُردّ بلا أن يقول أيّ العاملين أخطأ",
  /البيانات غير مطابقة/.test(refused) && !/الملف غير موجود|الهاتف/.test(refused), refused.slice(0, 70));

await patientPage.getByLabel("رقم الملف").fill(seeded.patientNumber);
await patientPage.getByRole("button", { name: "دخول" }).click();
await patientPage.waitForTimeout(2500);
const inside = (await patientPage.locator("body").innerText()).replace(/\s+/g, " ");
say("والدخول بالعاملين الصحيحين يفتح بوابته", inside.includes(name), inside.slice(0, 80));
say("ويرى رقم ملفه", inside.includes(seeded.patientNumber));
say("ويرى موعده", /مواعيدي/.test(inside) && !/لا مواعيد مسجّلة/.test(inside));
console.log("2) دخل المريض بوابته");
await patientPage.screenshot({ path: OUT + "/portal-1-home.png", fullPage: true });

// ٣) تأكيد الحضور — الفعل الوحيد الذي تكتبه البوابة.
await patientPage.getByRole("button", { name: "أؤكّد حضوري" }).first().click();
await patientPage.waitForTimeout(2500);
const confirmed = (await patientPage.locator("body").innerText()).replace(/\s+/g, " ");
say("تأكيد الحضور يُسجَّل", /أكّدتَ حضورك/.test(confirmed));
say("ولا يُعرض الزرّ ثانيةً",
  (await patientPage.getByRole("button", { name: "أؤكّد حضوري" }).count()) === 0);

// والطاقم يراه من جهته — وإلا فالتأكيد كلامٌ لا يصل.
const seenByStaff = await staff.evaluate(async ({ date, id }) => {
  const list = await (await fetch(`/api/appointments?date=${date}`, { cache: "no-store" })).json();
  const rows = Array.isArray(list) ? list : (list.appointments ?? []);
  return rows.find((one) => one.patientId === id)?.patientConfirmedAt ?? null;
}, { date: tomorrow, id: seeded.patientId });
say("والطاقم يرى التأكيد في مواعيده", Boolean(seenByStaff), String(seenByStaff));
console.log("3) أُكّد الحضور ووصل إلى المركز");
await patientPage.screenshot({ path: OUT + "/portal-2-confirmed.png", fullPage: true });

// ٤) العزل: جلسة البوابة لا تفتح شيئًا من المركز.
const leakStatus = await patientPage.evaluate(async () =>
  (await fetch("/api/patients", { cache: "no-store" })).status);
say("وجلسة البوابة لا تفتح مسار طاقم", leakStatus === 401, `الحالة ${leakStatus}`);

// والحكم على ما وصل إليه المتصفّح فعلًا لا على رقم حالةٍ قد يكون معتمًا: من يكتب
// عنوان اللوحة في شريط العنوان يجب أن يجد نفسه في شاشة الدخول.
await patientPage.goto(BASE + "/", { waitUntil: "networkidle" });
await patientPage.waitForTimeout(1500);
say("ولا تفتح شاشات المركز — تُردّ إلى شاشة الدخول",
  new URL(patientPage.url()).pathname === "/login", patientPage.url());

// ثم يعود إلى بوابته: الردّ إلى الدخول لا يُفقده جلسته هو.
await patientPage.goto(BASE + "/portal", { waitUntil: "networkidle" });
await patientPage.waitForTimeout(2000);
say("وبوابته تبقى مفتوحة له بعد ذلك",
  (await patientPage.locator("body").innerText()).includes(name));
console.log("4) العزل قائم في الاتجاهين");

console.log(failed ? "\nسقطت رحلة البوابة." : "\nرحلة البوابة تامّة.");
await b.close();
process.exit(failed ? 1 : 0);
