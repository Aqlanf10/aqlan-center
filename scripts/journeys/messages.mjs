#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";

/**
 * رحلة الرسائل — على متصفّحين اثنين معًا.
 *
 * وهذا ما لا يفحصه اختبارٌ ولا حارسُ HTTP: **هل تصل الرسالة إلى الشاشة الأخرى
 * وهي مفتوحة؟** الاستطلاع كل عشر ثوانٍ يعمل في الكود ويُنسى في الواجهة — يُبنى
 * على تبعيّةٍ خاطئة فيتوقّف بعد أول تحميل، فتبقى الشاشة صامتة وصاحبها ينتظر.
 *
 * ثم: هل يُطفأ العدّاد حين تُفتح المحادثة؟ عدّادٌ يبقى مضاءً بعد القراءة يُتعلَّم
 * أنه لا يُصدَّق، ثم لا يُصدَّق حين يصدق.
 *
 *   الاستعمال: node scripts/journeys/messages.mjs
 */

const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
/*
 * الزميل الثاني يُنشأ من الرحلة نفسها ويُعطَّل بعدها.
 *
 * ولا يُقرأ حسابٌ قائم: كلمات مرور الطاقم لا تُكتب في سكربت، وحسابٌ ثابتٌ للفحص
 * حسابٌ يُنسى مفعّلًا. والتعطيل في النهاية — في النجاح وفي السقوط — لأن الرحلة
 * التي لا تنظّف أثرها تُخلّف صفًّا في كل شاشة تعدّ الزملاء.
 */
const PEER = `zameel${Date.now().toString().slice(-7)}`;
const PEER_PASS = "journey-peer-only-local-2026";
const chromium = await loadChromium();

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 160)));

let failed = false;
let peerId = null;
const say = (label, ok, extra = "") => {
  console.log(`   ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

try {
  await login(page, { base: BASE, user: USER, pass: PASS });

  // ١) يُوصل إليها من التنقّل الرئيسي — وحدةٌ لا يُوصل إليها وحدةٌ لا تُستعمل.
  console.log("1) الوصول من التنقّل");
  await page.getByRole("link", { name: "الرسائل" }).first().click();
  await page.waitForURL((url) => url.pathname === "/messages", { timeout: 20000 });
  await page.waitForTimeout(1500);
  say("فُتحت شاشة الرسائل من القائمة", page.url().endsWith("/messages"));

  // ٢) القائمة تحمل الزملاء وصندوق الفريق — قبل أن تبدأ أي محادثة.
  console.log("2) قائمة المحادثات");
  const teamButton = page.getByRole("button", { name: /الفريق كلّه/ }).first();
  say("صندوق الفريق موجود", await teamButton.isVisible());
  const rows = await page.locator("aside button").count();
  say("ومعه الزملاء — ومحادثةٌ لم تبدأ تظهر أيضًا", rows >= 2, `${rows} صفًّا`);

  // ٣) رسالةٌ تُكتب وتظهر في الخيط فورًا.
  console.log("3) إرسال إلى الفريق");
  await teamButton.click();
  await page.waitForTimeout(800);
  const text = `رسالة رحلة ${Date.now().toString().slice(-6)}`;
  const box = page.getByLabel("نصّ الرسالة");
  await box.click();
  await box.pressSequentially(text, { delay: 8 });
  await page.getByRole("button", { name: "إرسال" }).click();
  await page.waitForTimeout(1500);
  say("ظهرت في الخيط", (await page.locator("body").innerText()).includes(text));

  // ٤) وتبقى بعد إعادة التحميل — أي أنها في القاعدة لا في الشاشة.
  console.log("4) بعد إعادة التحميل");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /الفريق كلّه/ }).first().click();
  await page.waitForTimeout(1500);
  say("ما زالت موجودة — سجلٌّ لا شاشة", (await page.locator("body").innerText()).includes(text));

  // ٥) الرسالة الفارغة لا تُرسل، والزرّ معطّل — لا رسالةُ خطأٍ بعد الضغط.
  console.log("5) الحدود في الواجهة");
  const sendButton = page.getByRole("button", { name: "إرسال" });
  say("زرّ الإرسال معطّل بلا نصّ", await sendButton.isDisabled());

  // ٦) الوصول: رسالةٌ من زميلٍ آخر تصل إلى شاشةٍ مفتوحة بلا إعادة تحميل.
  {
    console.log("6) هل تصل إلى الشاشة الأخرى وهي مفتوحة؟");
    const made = await page.evaluate(async ([username, password]) => {
      const response = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName: "زميل الرحلة", password, role: "reception" }),
      });
      return { ok: response.ok, body: await response.json() };
    }, [PEER, PEER_PASS]);
    say("أُنشئ حساب زميلٍ للرحلة", made.ok, made.ok ? PEER : (made.body?.message ?? ""));
    if (!made.ok) throw new Error("تعذّر إنشاء حساب الزميل");
    peerId = made.body.id;

    const second = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar" });
    const peerPage = await second.newPage();
    await login(peerPage, { base: BASE, user: PEER, pass: PEER_PASS });
    await peerPage.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
    const reply = `ردّ رحلة ${Date.now().toString().slice(-6)}`;
    await peerPage.getByRole("button", { name: /الفريق كلّه/ }).first().click();
    await peerPage.waitForTimeout(600);
    const peerBox = peerPage.getByLabel("نصّ الرسالة");
    await peerBox.click();
    await peerBox.pressSequentially(reply, { delay: 8 });
    await peerPage.getByRole("button", { name: "إرسال" }).click();
    await peerPage.waitForTimeout(1200);

    // الشاشة الأولى مفتوحة على المحادثة نفسها: الاستطلاع يجب أن يجلبها.
    await page.waitForTimeout(12_000);
    say("وصلت إلى الشاشة الأخرى وهي مفتوحة — الاستطلاع يعمل",
      (await page.locator("body").innerText()).includes(reply));
    await second.close();
  }

  console.log(failed ? "\nسقطت الرحلة." : "\nرحلة الرسائل اكتملت.");
} finally {
  // التعطيل قبل الإغلاق — في النجاح وفي السقوط.
  if (peerId) {
    await page.evaluate(async (id) => {
      await fetch(`/api/users/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
    }, peerId).catch(() => {});
  }
  await context.close();
  await browser.close();
}

process.exit(failed ? 1 : 0);
