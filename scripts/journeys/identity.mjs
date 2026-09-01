#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";
import { callAndSeat, openChart, releaseChair } from "./chair.mjs";
import { createPatient } from "./patient.mjs";

/**
 * رحلة الهوية — مريضٌ واحد بسجلٍّ واحد.
 *
 * تمشي الطريق الذي كان يُنتج الملف الثاني: مريضٌ مسجَّل يصل بلا رقم جوال. وتتأكد
 * أن الشاشة تعرض ملفّه، وأن اختياره يربط الزيارة به، وأن التوقيع بعده لا يُنشئ
 * ملفًّا ثانيًا — ثم تتأكد من الحارس الثاني: زيارةٌ وصلت بلا ربط تُحذَّر قبل
 * التوقيع وتُعرض عليها ملفّات مطابقة.
 *
 *   الاستعمال: node scripts/journeys/identity.mjs <مجلد-الصور>
 */

const OUT = process.argv[2] ?? ".";
const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const chromium = await loadChromium();

const b = await chromium.launch({ executablePath });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, locale: "ar" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 160)));
const type = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 16 }); };
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await login(page, { base: BASE, user: USER, pass: PASS });
await page.waitForTimeout(4000);

// ١) مريضٌ يُسجَّل برقمه
const stamp = Date.now().toString().slice(-6);
const name = "سعيد الهوية " + stamp.slice(-4);
const phone = "77" + stamp.padStart(7, "0");
await createPatient(page, { name, phone: phone, base: BASE });
const fileNumber = (await page.locator("body").innerText()).match(/P-\d{5}/)?.[0] ?? "؟";
console.log("1) سُجّل المريض — الملف", fileNumber);

// ٢) يصل بلا رقم: الشاشة تعرض ملفّه
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.getByLabel("اسم المريض"), name);
await page.waitForTimeout(1800);
const suggested = page.getByRole("button", { name: new RegExp(escape(fileNumber)) });
console.log("2) الشاشة عرضت ملفّه:", (await suggested.count()) > 0 ? "✓" : "لم تعرضه");
await page.screenshot({ path: OUT + "/identity-1-match.png", fullPage: true });

await suggested.first().click();
await page.waitForTimeout(1000);
const bound = await page.locator("body").innerText();
console.log("3) بعد الاختيار:", bound.includes(`مربوط بملف ${fileNumber}`) ? "مربوط ✓" : "غير مربوط");

await page.getByRole("button", { name: "وصل", exact: true }).click();
await page.waitForTimeout(2200);

// ٣) يُنادى ويُوثَّق ويُوقَّع — بلا ملفٍّ ثانٍ
await callAndSeat(page, name, BASE);
await openChart(page, name);
const visitScreen = await page.locator("body").innerText();
console.log("4) شاشة الزيارة:", /غير مربوطة بملف/.test(visitScreen) ? "حذّرت بلا داعٍ ✗" : "لا تحذير — مربوطة ✓");

await type(page.getByLabel("التشخيص", { exact: true }), "كشف");
await type(page.getByLabel("ما نُفّذ", { exact: true }), "كشف");
const pick = async (needle) => {
  const value = await page.getByLabel("أضف إجراءً").evaluate((select, text) =>
    [...select.options].find((o) => o.textContent.includes(text))?.value ?? "", needle);
  await page.getByLabel("أضف إجراءً").selectOption(value);
};
await pick("كشف");
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /وقّع الزيارة/ }).click();
// الرحلة كانت تنتظر انتقالًا إلى اللوحة، والشاشة صارت تبقى على الزيارة بعد
// التوقيع. فانتظارُ الانتقال يفحص عادةً قديمة لا الميزةَ نفسها؛ والميزة هي أن
// الزيارة صارت موقَّعة. وانتظارٌ يقول سببه عند سقوطه: «انتهت المهلة» وحدها تُرسل
// من يقرأها إلى الشيفرة يفتّش، والشاشة نفسها تحمل الجواب مكتوبًا.
const sealed = await page.getByText("زيارة موقَّعة").first()
  .waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
if (!sealed) {
  const screen = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
  throw new Error(`التوقيع لم يُختم — ما على الشاشة: ${screen}`);
}
await page.waitForTimeout(2500);

await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.getByLabel("بحث عن مريض"), name);
await page.waitForTimeout(2500);
const files = await page.getByRole("link", { name: new RegExp(escape(name)) }).count();
console.log("5) بعد التوقيع — عدد ملفّاته:", files === 1 ? "ملفٌّ واحد ✓" : `${files} ملفّات ✗`);
await page.screenshot({ path: OUT + "/identity-2-one-file.png", fullPage: true });

// ٤) الحارس الثاني: وصولٌ بلا ربط يُحذَّر قبل التوقيع
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.getByLabel("اسم المريض"), name);
await page.waitForTimeout(1800);
await page.getByRole("button", { name: "وصل", exact: true }).click();  // بلا اختيار ملف
await page.waitForTimeout(2200);
await callAndSeat(page, name, BASE);
await openChart(page, name);
const unlinked = await page.locator("body").innerText();
console.log("6) زيارةٌ بلا ربط:", /غير مربوطة بملف/.test(unlinked) ? "حُذِّرت ✓" : "مرّت صامتة ✗");

await page.getByRole("button", { name: "ابحث عن ملفّه" }).click();
await page.waitForTimeout(2000);
const candidate = page.getByRole("button", { name: new RegExp(escape(fileNumber)) });
console.log("7) وعُرض ملفّه:", (await candidate.count()) > 0 ? "✓" : "لم يُعرض");
await page.screenshot({ path: OUT + "/identity-3-link.png", fullPage: true });

await candidate.first().click();
await page.waitForTimeout(2500);
const afterLink = await page.locator("body").innerText();
console.log("8) بعد الربط:", /غير مربوطة بملف/.test(afterLink) ? "ما زال التحذير ✗" : "زال التحذير ✓");
await releaseChair(page, name, BASE);
await b.close();
