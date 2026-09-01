#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";
import { callAndSeat, openChart, releaseChair } from "./chair.mjs";

/**
 * رحلة الزيارة — من باب العيادة إلى كشف الحساب.
 *
 * تمشي الطريق الذي يمشيه المريض فعلًا: وصولٌ، فنداءٌ على كرسي، فتوثيقٌ سريري،
 * فتوقيعٌ يُنتج الفاتورة ويحدّث المخطط. وتقرأ بعدها كشفَ الحساب والمخطط لتتأكد
 * أن ما وقّعه الطبيب وصل إليهما — لا أن الاستدعاء رجع ٢٠٠.
 *
 *   الاستعمال: node scripts/journeys/visit.mjs <مجلد-الصور>
 */

const OUT = process.argv[2] ?? ".";
const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const chromium = await loadChromium();

const b = await chromium.launch({ executablePath });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, locale: "ar" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 140)));
const type = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 18 }); };

await login(page, { base: BASE, user: USER, pass: PASS });
await page.waitForTimeout(4500);

const name = "مريض الرحلة " + Date.now().toString().slice(-5);
await type(page.getByLabel("اسم المريض"), name);
await page.getByRole("button", { name: "وصل", exact: true }).click();
await page.waitForTimeout(1800);
console.log("1) وصل المريض");

await callAndSeat(page, name, BASE);
console.log("2) نُودي ودخل الكرسي");

await openChart(page, name);
await page.screenshot({ path: OUT + "/visit-1-open.png", fullPage: true });
console.log("3) فُتحت شاشة الزيارة");

await type(page.getByLabel("الشكوى الرئيسية", { exact: true }), "ألم في الضرس العلوي");
await type(page.getByLabel("التشخيص", { exact: true }), "تسوّس الرحى الأولى");
await type(page.getByLabel("ما نُفّذ", { exact: true }), "حشوة ضوئية");
const pick = async (needle) => {
  const value = await page.getByLabel("أضف إجراءً").evaluate((select, text) =>
    [...select.options].find((o) => o.textContent.includes(text))?.value ?? "", needle);
  await page.getByLabel("أضف إجراءً").selectOption(value);
};
await pick("حشوة ضوئية");
await page.waitForTimeout(900);
await page.getByLabel("رقم السن").selectOption("16");
await type(page.getByLabel("الأسطح"), "mo");
await pick("كشف");
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "/visit-2-filled.png", fullPage: true });
const signLabel = (await page.getByRole("button", { name: /وقّع الزيارة/ }).innerText()).trim();
const expected = signLabel.match(/[\d,]+/)[0];
console.log("4) زرّ التوقيع:", signLabel);

await page.getByRole("button", { name: /وقّع الزيارة/ }).click();
await page.getByText("زيارة موقَّعة", { exact: false }).first().waitFor({ timeout: 25000 });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
const board = await page.locator("body").innerText();
console.log("5) وُقّعت — والكرسي فرغ:", !board.includes(name));

await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.getByLabel("بحث عن مريض"), name);
await page.waitForTimeout(2500);
await page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
await page.waitForTimeout(2500);

await page.getByRole("button", { name: "الحساب" }).click();
await page.waitForTimeout(2200);
const ledger = await page.locator("body").innerText();
console.log("6) الفاتورة في كشف الحساب:", ledger.includes(expected) ? expected + " ✓" : "غير ظاهرة — المتوقّع " + expected);
await page.screenshot({ path: OUT + "/visit-3-ledger.png", fullPage: true });

await page.getByRole("button", { name: "المخطط السني" }).click();
await page.waitForTimeout(2200);
const chart = await page.locator("body").innerText();
console.log("7) المخطط تحدّث:", /1 سنًّا مسجّلًا/.test(chart) ? "سن واحد ✓" : "لم يتحدّث");
await page.getByRole("button", { name: "الرحى الأولى العلوي الأيمن" }).first().click();
await page.waitForTimeout(1000);
const tooth = await page.locator("body").innerText();
console.log("8) السن 16:", /الحالة: حشوة/.test(tooth) ? "حشوة ✓" : "غير متوقّعة", "| MO:", /MO/.test(tooth));
await page.screenshot({ path: OUT + "/visit-4-chart.png", fullPage: true });
// الكرسي يُخلى قبل إغلاق المتصفّح: الرحلة التي لا تنظّف أثرها تعمل مرّةً
// وتُقرأ نتيجتها مرّتين — والثانية «كل الكراسي مشغولة».
await releaseChair(page, name, BASE);
await b.close();
