#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";
import { createPatient } from "./patient.mjs";
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
const DOC_LABEL = "سيفالومتري جانبي";
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

await login(page, { base: BASE, user: USER, pass: PASS });
await page.waitForTimeout(4000);

const name = "مريض السيفالو " + Date.now().toString().slice(-5);
await createPatient(page, { name, phone: null, base: BASE });
console.log("1) أُنشئ ملف المريض");

await page.getByRole("button", { name: "الأشعة" }).click();
await page.waitForTimeout(2000);
await type(page.getByLabel("وصف المستند"), DOC_LABEL);
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
console.log("   ويذكر الدليل المعتمد:", /ADP-LM-LAT/.test(opened) ? "✓" : "لا يذكره");

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
  /4 من 24 نقطة/.test(reopened) && /الصنف الأول/.test(reopened) ? "✓" : "لم يعد");

// ٩) اللغة تُبدَّل بزرّ واحد — والرموز لا تُترجم
await tracer.getByRole("button", { name: "EN" }).click();
await page.waitForTimeout(1200);
const english = await tracer.innerText();
console.log("9) بالإنجليزية:", /Cephalometric tracing/.test(english) ? "✓" : "لم تُبدَّل");
console.log("   والتصنيف:", /Class I/.test(english) ? "Class I ✓" : "لم يُترجم");
console.log("   والرموز كما هي:", /SNA/.test(english) && /\bS\b/.test(english) ? "✓" : "تُرجمت");
console.log("   والاتجاه LTR:", (await tracer.getAttribute("dir")) === "ltr" ? "✓" : "بقي RTL");
// يُستثنى اثنان لا ثالث لهما: وصفُ المستند نصٌّ كتبه المستخدم لا ترجمةً
// للواجهة، وزرّ اللغة نفسه يجب أن يبقى «ع» — فهو العرضُ بالعودة، ولو تُرجم
// لما عرف من لا يقرأ الإنجليزية كيف يرجع.
const toggle = (await tracer.getByRole("button", { name: "العربية" }).innerText()).trim();
const leftover = english.split("\n")
  .map((line) => line.replace(DOC_LABEL, "").trim())
  .filter((line) => line !== toggle && /[\u0600-\u06FF]/.test(line));
console.log("   وزرّ العودة بالعربية:", toggle === "ع" ? "✓" : "صار «" + toggle + "» ✗");
console.log("   ولا نصّ عربي متبقٍّ:", leftover.length === 0 ? "✓" : "بقي: " + leftover.join(" | ") + " ✗");
await page.screenshot({ path: OUT + "/ceph-3-english.png", fullPage: false });

await tracer.getByRole("button", { name: "ع" }).click();
await page.waitForTimeout(1000);
console.log("   وتعود للعربية:", (await tracer.getAttribute("dir")) === "rtl" ? "✓" : "بقيت LTR");
await page.screenshot({ path: OUT + "/ceph-2-reopened.png", fullPage: false });
await b.close();
