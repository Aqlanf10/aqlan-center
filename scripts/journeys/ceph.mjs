#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { makePng } from "./png.mjs";

/**
 * رحلة السيفالومتري — من صورة أشعة إلى تصنيفٍ هيكلي.
 *
 * وأدقّ ما فيها الخطوة السادسة: أن تُنقر النقاط على الصورة بنِسبها الصحيحة فتخرج
 * الزوايا كما تخرج من الحساب المجرّد. فبين النقر والزاوية طبقتان — إحداثيات
 * الشاشة ونسبة الصورة — وخطأٌ في أيّهما يُنتج رقمًا يبدو معقولًا وهو غلط.
 *
 *   الاستعمال: node scripts/journeys/ceph.mjs <مجلد-الصور>
 */

const OUT = process.argv[2] ?? ".";
const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const chromium = await loadChromium();

// صورة **مربّعة**: النسبة ١، فتوافق الإحداثيات التي حُسبت عليها القيم المعيارية.
// ومراعاةُ النسبة غير المربّعة مفحوصةٌ في اختبارات الوحدة على حدة — وخلطُ
// الأمرين هنا يجعل الرقم المخالف لا يُعرف سببه: أخطأ الحساب أم أخطأ المقاس؟

// وجهٌ سويّ محسوب — نفس إحداثيات الفحص.
const NORMAL = {
  S: { x: 0.34, y: 0.235 },
  N: { x: 0.62, y: 0.26 },
  A: { x: 0.5588, y: 0.5230 },
  B: { x: 0.5158, y: 0.6462 },
};

const b = await chromium.launch({ executablePath });
const page = await (await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: "ar" })).newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 160)));
const type = async (l, t) => { await l.click(); await l.pressSequentially(t, { delay: 16 }); };

await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await type(page.locator("#username"), USER);
await type(page.locator("#password"), PASS);
await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 15000 });
await page.waitForTimeout(4000);

const name = "مريض السيفالو " + Date.now().toString().slice(-5);
await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "+ مريض جديد" }).click();
await page.waitForTimeout(1200);
await type(page.getByLabel("الاسم الكامل"), name);
await page.waitForFunction(() => {
  const x = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("احفظ وافتح الملف"));
  return x && !x.disabled;
});
await page.getByRole("button", { name: /احفظ وافتح الملف/ }).click();
await page.waitForURL(/\/patients\/\d+/, { timeout: 20000 });
await page.waitForTimeout(3000);
console.log("1) أُنشئ ملف المريض");

await page.getByRole("button", { name: "الأشعة" }).click();
await page.waitForTimeout(2000);
await type(page.getByLabel("وصف المستند"), "سيفالومتري جانبي");
await page.getByLabel("ملف الأشعة").setInputFiles({
  name: "ceph.png", mimeType: "image/png", buffer: makePng(320, 320),
});
await page.getByRole("button", { name: "ارفع" }).click();
await page.waitForTimeout(4000);
console.log("2) رُفعت الأشعة");

await page.getByRole("button", { name: "تتبّع سيفالومتري" }).click();
await page.waitForTimeout(2500);
const opened = await page.locator("body").innerText();
console.log("3) فُتح التتبّع:", /النقطة التالية/.test(opened) ? "✓" : "لم يُفتح");
console.log("   ويقول ما ينقص:", /ينقص/.test(opened) ? "✓" : "صامت");
console.log("   ويقول حدوده:", /لم تُضف بعد/.test(opened) ? "✓" : "لا يذكرها");

// ٤) تُنقر النقاط الأربع بنِسبها على الصورة نفسها
// داخل نافذة التتبّع لا في شبكة المصغّرات خلفها: الاسم نفسه يطابق الصورتين،
// وأخذُ الأولى ينقر على المصغَّرة فلا يقع شيء.
const tracer = page.getByRole("dialog");
const image = tracer.locator("img").first();
const box = await image.boundingBox();
for (const code of ["S", "N", "A", "B"]) {
  await tracer.getByRole("button", { name: code, exact: true }).click();
  const p = NORMAL[code];
  await page.mouse.click(box.x + p.x * box.width, box.y + p.y * box.height);
  await page.waitForTimeout(400);
}
console.log("4) نُقرت النقاط الأربع");

await page.waitForTimeout(1200);
const traced = await page.locator("body").innerText();
const grab = (key) => {
  const m = traced.match(new RegExp(key + "[\\s\\S]{0,40}?(\\d+\\.\\d)°"));
  return m ? Number(m[1]) : null;
};
const sna = grab("SNA"), snb = grab("SNB"), anb = grab("ANB");
console.log("5) القياسات على الشاشة:", `SNA ${sna} · SNB ${snb} · ANB ${anb}`);
console.log("6) مطابقة للحساب المجرّد:",
  sna !== null && Math.abs(sna - 82) <= 0.6 && Math.abs(snb - 80) <= 0.6 && Math.abs(anb - 2) <= 0.6
    ? "✓ (ضمن نصف درجة)" : "✗ خارج التسامح");
console.log("   والتصنيف:", /الصنف الأول/.test(traced) ? "الأول ✓" : "غير متوقّع");
await page.screenshot({ path: OUT + "/ceph-1-traced.png", fullPage: false });

await tracer.getByRole("button", { name: "احفظ التتبّع" }).click();
await page.waitForTimeout(2500);
console.log("7) حُفظ التتبّع:", /محفوظ/.test(await page.locator("body").innerText()) ? "✓" : "لم يُحفظ");

await tracer.getByRole("button", { name: "إغلاق" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "تتبّع سيفالومتري" }).click();
await page.waitForTimeout(3000);
const reopened = await page.locator("body").innerText();
console.log("8) وعاد بعد الفتح من جديد:",
  /4 من 18 نقطة/.test(reopened) && /الصنف الأول/.test(reopened) ? "✓" : "لم يعد");
await page.screenshot({ path: OUT + "/ceph-2-reopened.png", fullPage: false });
await b.close();
