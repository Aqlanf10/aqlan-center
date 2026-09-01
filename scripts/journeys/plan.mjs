#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";
import { callAndSeat, openChart, releaseChair } from "./chair.mjs";
import { createPatient } from "./patient.mjs";

/**
 * رحلة خطة العلاج — من الاتفاق إلى تنفيذه.
 *
 * ما لا يقوله أي اختبار وحدة: هل يستطيع إنسانٌ فعلًا أن يبني خطةً ويوافق عليها
 * ويرى بنودها تُشطب من نفسها؟ فحوصُ القاعدة تثبت المنطق، والرحلة تثبت أن الشاشة
 * توصّل إليه — وبينهما وقع أكثر ما وقع من خلل: زرٌّ لا يظهر، وحقلٌ لا يُحفظ.
 *
 *   الاستعمال: node scripts/journeys/plan.mjs <مجلد-الصور>
 *   (يفترض خادمًا يعمل على 3000 وحسابًا اسمه shots)
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

await login(page, { base: BASE, user: USER, pass: PASS });
await page.waitForTimeout(4000);

// ١) مريضٌ مسجَّل — الخطة اتفاقٌ على ملف، لا على اسمٍ عابر
const stamp = Date.now().toString().slice(-6);
const name = "مريض الخطة " + stamp.slice(-5);
const phone = "77" + stamp.padStart(7, "0");
await createPatient(page, { name, phone: phone, base: BASE });
console.log("1) أُنشئ ملف المريض");
console.log("2) فُتح ملف المريض");

// ٢) تبويب خطة العلاج ← خطة سريرية
await page.getByRole("button", { name: "خطة العلاج" }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /خطة سريرية ببنودها/ }).click();
await page.waitForTimeout(800);
await type(page.getByLabel("اسم الخطة"), "خطة علاج تجريبية");
const pickService = async (needle) => {
  const select=page.getByLabel("أضف إجراءً");
  const value=await select.evaluate((el,text)=>[...el.options].find(o=>o.textContent.includes(text)&&!o.disabled)?.value??"",needle);
  await select.selectOption(value);
};
await page.getByLabel("رقم السن").first().selectOption("16");
await pickService("حشوة");
await page.getByLabel("رقم السن").first().selectOption("");
await pickService("كشف");
await page.getByRole("button",{name:"احفظ الخطة بكل أعمالها"}).click();
await page.waitForTimeout(2500);
await page.screenshot({path:OUT+"/plan-2-items.png",fullPage:true});

// ٤) الموافقة تُقفل الاتفاق
await page.getByRole("button", { name: /سجّل موافقة المريض/ }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "سجّل الموافقة" }).click();
await page.waitForTimeout(3000);
const consented = await page.locator("body").innerText();
console.log("5) بعد الموافقة:", /وافق المريض في/.test(consented) ? "الموافقة مسجّلة ✓" : "غير مسجّلة");
console.log("   وأُقفلت البنود:", (await page.getByRole("button", { name: "+ أضف" }).count()) === 0 ? "✓" : "ما زالت مفتوحة");
await page.screenshot({ path: OUT + "/plan-3-consented.png", fullPage: true });

// ٥) المخطط السني يُظهر البنود مخطَّطة
await page.getByRole("button", { name: "المخطط السني" }).click();
await page.waitForTimeout(2500);
const chart = await page.locator("body").innerText();
console.log("6) المخطط بعد الموافقة:", /مخطَّط|مخطط/.test(chart) ? "فيه حالات مخطَّطة ✓" : "فارغ");
await page.screenshot({ path: OUT + "/plan-4-chart.png", fullPage: true });

// ٦) زيارة تنفّذ بندًا من الخطة
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.getByLabel("اسم المريض"), name);
await type(page.getByLabel("هاتف المريض"), phone);
await page.getByRole("button", { name: "وصل", exact: true }).click();
await page.waitForTimeout(2000);
await callAndSeat(page, name, BASE);
await openChart(page, name);

await type(page.getByLabel("التشخيص", { exact: true }), "تسوّس الرحى الأولى");
await type(page.getByLabel("ما نُفّذ", { exact: true }), "حشوة ضوئية");
const pickProc = async (needle) => {
  const value = await page.getByLabel("أضف إجراءً").evaluate((select, text) =>
    [...select.options].find((o) => o.textContent.includes(text))?.value ?? "", needle);
  await page.getByLabel("أضف إجراءً").selectOption(value);
};
await pickProc("حشوة");
await page.waitForTimeout(1200);
await page.getByLabel("رقم السن").selectOption("16");
await page.waitForTimeout(1200);
// الحفظ بلا توقيع هو ما يُثبّت الإجراءات، وعليها يُحسب إشعار الخطة.
await page.getByRole("button", { name: "احفظ بلا توقيع" }).click();
await page.waitForTimeout(3000);
const beforeSign = await page.locator("body").innerText();
console.log("7) الزيارة تعرف الخطة:", /يشطب هذا العمل/.test(beforeSign) ? "أشعرت بالبند ✓"
  : /خطة لها جدول أقساط/.test(beforeSign) ? "حذّرت من الازدواج ✓" : "لا إشعار");
await page.screenshot({ path: OUT + "/plan-5-visit.png", fullPage: true });

await page.getByRole("button", { name: /وقّع الزيارة/ }).click();
await page.getByText("زيارة موقَّعة", { exact: false }).first().waitFor({ timeout: 25000 });
await page.waitForTimeout(2500);

// ٧) البند صار منفَّذًا في الخطة
await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.getByLabel("بحث عن مريض"), name);
await page.waitForTimeout(2500);
await page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "خطة العلاج" }).click();
await page.waitForTimeout(2500);
const after = await page.locator("body").innerText();
console.log("8) بعد التوقيع:", /أُنجز 1 من 2/.test(after) ? "أُنجز 1 من 2 ✓" : "لم يُشطب البند");
await page.screenshot({ path: OUT + "/plan-6-done.png", fullPage: true });

// ٨) الطريق الآخر: خطةٌ بمبلغ متفق عليه تُقسَّط — أرقامُها مالية لا علاجية
await page.getByRole("button", { name: "بمبلغ متفق عليه" }).click();
await page.waitForTimeout(1000);
await type(page.getByLabel("المبلغ الإجمالي"), "600000");
await page.getByRole("button", { name: "احفظ الخطة" }).click();
await page.waitForTimeout(3000);
const financial = await page.locator("body").innerText();
console.log("9) خطة الأقساط:",
  /المدفوع/.test(financial) && /الباقي/.test(financial) ? "أرقامها مالية ✓" : "أرقامها ليست مالية");
console.log("   وفيها تحصيل قسط:",
  (await page.getByRole("button", { name: "تحصيل قسط" }).count()) > 0 ? "✓" : "غائب");
console.log("   وجدول أقساطها:", /جدول الأقساط/.test(financial) ? "✓" : "غائب");
console.log("   والسريرية بلا «تحصيل قسط»:",
  (await page.getByRole("button", { name: "تحصيل قسط" }).count()) === 1 ? "✓" : "ظهر لكليهما");
await page.screenshot({ path: OUT + "/plan-7-financial.png", fullPage: true });
// الكرسي يُخلى قبل إغلاق المتصفّح: الرحلة التي لا تنظّف أثرها تعمل مرّةً
// وتُقرأ نتيجتها مرّتين — والثانية «كل الكراسي مشغولة».
await releaseChair(page, name, BASE);
await b.close();
