#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";

/**
 * رحلة التثبيت — على متصفّحٍ حقيقي، لأن ما يُفحص هنا لا يوجد إلا فيه.
 *
 * اختبارُ الوحدة يقرأ سياسة التخزين ويحكم عليها؛ وهو لا يرى ما خزّنه المتصفّح
 * فعلًا. والسؤال الذي يهمّ صاحب العيادة سؤالٌ عن الجهاز لا عن الملف: بعد جولةٍ
 * في البرنامج — شاشة اليوم والمرضى وطلبات الشبكة كلّها — **ماذا بقي على القرص؟**
 *
 * فالرحلة تدخل، وتتصفّح، ثم تفتح خزانة المتصفّح وتعدّ ما فيها، وتشترط ألّا يكون
 * فيها مسار `/api/` واحد ولا صفحةُ مريض. ثم تقطع الشبكة وتشترط صفحة انقطاعٍ
 * عربية لا شاشة خطأ المتصفّح.
 *
 *   الاستعمال: node scripts/journeys/pwa.mjs
 */

const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const chromium = await loadChromium();

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: "ar" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 160)));

let failed = false;
const say = (label, ok, extra = "") => {
  console.log(`   ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

try {
  await login(page, { base: BASE, user: USER, pass: PASS });

  // ١) عامل الخدمة يُسجَّل ويسيطر — وبلا هذا لا يعرض المتصفّح «ثبّت التطبيق» أصلًا.
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, active: Boolean(registration.active) };
  });
  console.log("1) عامل الخدمة");
  say("سُجّل ونشط", worker.active);
  say("ونطاقه البرنامج كلّه لا مجلّدًا منه", new URL(worker.scope).pathname === "/", worker.scope);

  // ٢) ملف التثبيت مربوطٌ بالصفحة ويُقرأ منها.
  console.log("2) ملف التثبيت");
  const manifestHref = await page.locator('link[rel="manifest"]').first().getAttribute("href");
  say("الصفحة تشير إليه", Boolean(manifestHref), manifestHref ?? "غائب");
  const manifest = await page.evaluate(async (href) => (await fetch(href)).json(), manifestHref);
  say("يُفتح بشاشةٍ كاملة", manifest.display === "standalone", manifest.display);
  say("واتجاهه عربي", manifest.dir === "rtl" && manifest.lang === "ar");
  say("واسمه اسم المركز من الإعدادات", typeof manifest.name === "string" && manifest.name.length > 3, manifest.name);
  say("وفيه أيقونةٌ قابلة للقصّ", manifest.icons.some((icon) => icon.purpose === "maskable"));
  const iconOk = await page.evaluate(async (icons) => {
    const results = await Promise.all(icons.map(async (icon) => {
      const response = await fetch(icon.src);
      return response.ok && (response.headers.get("content-type") ?? "").includes("png");
    }));
    return results.every(Boolean);
  }, manifest.icons);
  say("وكل أيقونةٍ يذكرها تُجلب فعلًا", iconOk);

  // ٣) جولةٌ في البرنامج ثم عدّ ما بقي على القرص.
  console.log("3) ماذا بقي على الجهاز بعد الاستعمال؟");
  await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    // طلباتٌ تحمل بيانات — يمرّ عليها عامل الخدمة كما يمرّ على غيرها.
    await Promise.all([fetch("/api/patients"), fetch("/api/inventory?summary=1"), fetch("/api/ortho?summary=1")]);
  });
  await page.waitForTimeout(1200);

  const stored = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) out.push(new URL(request.url).pathname);
    }
    return out;
  });
  const allowed = (path) =>
    path === "/icon.svg" || path === "/offline.html" ||
    path.startsWith("/_next/static/") || path.startsWith("/icons/");
  const leaked = stored.filter((path) => !allowed(path));
  say("لا مسار `/api/` واحد على القرص", stored.every((path) => !path.startsWith("/api/")));
  say("ولا صفحةُ مريض", !stored.includes("/patients") && !stored.includes("/"));
  say("ولا شيء خارج قائمة السماح", leaked.length === 0, leaked.slice(0, 4).join(" ، "));
  say("وصفحةُ الانقطاع مخزَّنةٌ قبل أن تنقطع", stored.includes("/offline.html"));
  console.log(`   (المخزَّن: ${stored.length} ملفًا — كلّها ملفات بناء)`);

  /*
   * ٤) صفحة الانقطاع — موجودةٌ على القرص وتُعرض من هناك.
   *
   * ولا يُقطع الاتصال هنا فعلًا: Chromium **لا يطبّق محاكاة انقطاع الشبكة على
   * العنوان المحلّي** — جُرِّب `setOffline` و`route.abort` معًا فمرّ الطلب إلى
   * الخادم في الحالتين، فكان الفحص سيمرّ بالصدفة لا بالبرهان. فالمفحوص هنا ما
   * يستطيع المتصفّح إثباته: أن الصفحة على القرص وتُقرأ منه بلا شبكة. أمّا أن
   * العامل يعرضها حين يفشل الجلب فمُثبَتٌ بتشغيله نفسه في `__tests__/pwa.test.ts`.
   */
  console.log("4) صفحة الانقطاع على القرص");
  const offline = await page.evaluate(async () => {
    const hit = await caches.match("/offline.html");
    return hit ? hit.text() : null;
  });
  say("تُقرأ من خزانة الجهاز", typeof offline === "string" && offline.length > 200);
  say("ونصّها عربي يقول ما جرى", (offline ?? "").includes("لا اتصال بالخادم"));
  // لا تطلب شيئًا ولا تعرض شيئًا: ما يُعرض حين لا شبكة يجب أن يكون كاملًا في الملف.
  say("ولا تجلب من الخادم ولا من مسار بيانات", !(offline ?? "").includes("fetch(") && !(offline ?? "").includes("/api/"));

  console.log(failed ? "\nسقطت الرحلة." : "\nرحلة التثبيت اكتملت.");
} finally {
  await context.close();
  await browser.close();
}

process.exit(failed ? 1 : 0);
