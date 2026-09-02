#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";

/**
 * رحلة المخزون — من إضافة البند إلى صرفه على الكرسي.
 *
 * وما تفحصه هو ما يقرّر أن يُستعمل السجلّ أصلًا: هل يُسجَّل الصرف من الشاشة نفسها
 * بلا انتقال؟ وهل تُردّ محاولة صرف ما لا يوجد **برسالةٍ عربيةٍ تقول الرقم**؟ وهل
 * تفتح الشاشة على ما يحتاج تصرّفًا لا على القائمة كلّها؟ ثم — وهذا ما لا يُرى في
 * اختبار وحدة — هل يبقى الرقم المعروض هو الرقم الذي في القاعدة بعد كل حركة؟
 *
 *   الاستعمال: node scripts/journeys/inventory.mjs <مجلد-الصور>
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

let failed = false;
const say = (label, ok, extra = "") => {
  console.log(`   ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

await login(page, { base: BASE, user: USER, pass: PASS });

// التنقّل الرئيسي أوّلًا: وحدةٌ لا يُوصل إليها من القشرة وحدةٌ لا تُستعمل.
await page.getByRole("link", { name: "المخزون" }).first().click();
await page.waitForURL((url) => url.pathname === "/inventory", { timeout: 20000 });
await page.waitForTimeout(2500);
console.log("1) وُصل إلى المخزون من التنقّل الرئيسي ✓");

const name = "مادّة رحلة " + Date.now().toString().slice(-5);
await page.getByRole("button", { name: "+ بند جديد" }).click();
const form = page.getByRole("form", { name: "بند جديد" }).or(page.locator('form[aria-label="بند جديد"]'));
await type(form.getByLabel("اسم البند"), name);
await type(form.getByLabel("وحدة القياس"), "علبة");
await type(form.getByLabel("حدّ الطلب"), "5");
await page.getByRole("button", { name: "حفظ البند" }).click();
await page.waitForTimeout(2500);

// بندٌ جديد بلا حركات رصيده صفر — فهو «نفد»، ولذلك يظهر في «يحتاج تصرّفًا».
const opened = await page.locator("body").innerText();
say("البند الجديد يظهر في «يحتاج تصرّفًا»", opened.includes(name));
say("ورصيده صفرٌ وحاله «منتهي»", /منتهي/.test(opened));
console.log("2) أُضيف البند");

const item = page.getByRole("listitem").filter({ hasText: name });
await item.getByRole("button").first().click();
await page.waitForTimeout(1200);

// إدخال ١٠ علب بصلاحيةٍ بعيدة.
await item.getByLabel("نوع الحركة").selectOption("in");
await type(item.getByLabel("الكمية"), "10");
await item.getByLabel("صلاحية الدفعة").fill("2027-01-01");
await item.getByRole("button", { name: "تسجيل إدخال" }).click();
await page.waitForTimeout(2500);
say("بعد الإدخال صار الرصيد ١٠", /\b10\b/.test(await item.innerText()), (await item.innerText()).replace(/\s+/g, " ").slice(0, 90));
console.log("3) سُجّل الإدخال");

// صرفٌ فوق الرصيد — يجب أن يُردّ برسالةٍ عربية تقول الرقم لا بصمت.
await item.getByLabel("نوع الحركة").selectOption("out");
await item.getByLabel("الكمية").fill("99");
await item.getByRole("button", { name: "تسجيل صرف" }).click();
await page.waitForTimeout(2000);
const refusal = await page.getByRole("alert").first().innerText().catch((e) => "تعذّر: " + String(e).slice(0, 120));
say("صرفٌ فوق الرصيد يُردّ برسالةٍ عربية تقول الرقم", /الرصيد 10 لا يكفي صرف 99/.test(refusal), refusal.slice(0, 80));
say("ولم ينزل الرصيد", /\b10\b/.test(await item.innerText()));
await page.screenshot({ path: OUT + "/inventory-1-refusal.png", fullPage: true });

// صرفٌ حقيقي — ٧ علب، فينزل الرصيد تحت حدّ الطلب.
await item.getByLabel("الكمية").fill("7");
await item.getByRole("button", { name: "تسجيل صرف" }).click();
await page.waitForTimeout(2500);
const afterOut = await item.innerText();
say("بعد الصرف صار الرصيد ٣", /\b3\b/.test(afterOut));
say("وحاله «تحت حدّ الطلب» — يُنبَّه قبل أن ينفد لا بعده", /تحت حدّ الطلب/.test(afterOut));
console.log("4) سُجّل الصرف");

// التسوية بلا سبب — البابُ الوحيد الذي يغيّر الرصيد بلا مستند، فلا يُفتح بلا كتابة.
await item.getByLabel("نوع الحركة").selectOption("adjust");
await item.getByLabel("الكمية").fill("-1");
await item.getByRole("button", { name: "تسجيل تسوية جرد" }).click();
await page.waitForTimeout(2000);
const bare = await page.getByRole("alert").first().innerText().catch((e) => "تعذّر: " + String(e).slice(0, 120));
say("تسويةٌ بلا سببٍ مكتوب مرفوضة", /سبب التسوية إلزامي/.test(bare), bare.slice(0, 60));

await type(item.getByLabel("السبب"), "جردٌ شهري: علبةٌ مفقودة");
await item.getByRole("button", { name: "تسجيل تسوية جرد" }).click();
await page.waitForTimeout(2500);
say("وبسببٍ مكتوب تُقبل وينزل الرصيد إلى ٢", /\b2\b/.test(await item.innerText()));
say("والحركات كلها في سجلّ البند", (await item.innerText()).includes("جردٌ شهري"));
console.log("5) وُثّقت التسوية");

// ما تعرضه الشاشة يجب أن يوافق ما في الخادم — لا رقمًا في الذاكرة بقي من قبل.
const server = await page.evaluate(async (wanted) => {
  const payload = await (await fetch("/api/inventory", { cache: "no-store" })).json();
  const found = payload.items.find((one) => one.name === wanted);
  return found ? { balance: found.balance, status: found.status, expiry: found.nearestExpiry } : null;
}, name);
say("الرقم المعروض هو رقم الخادم", server?.balance === 2, JSON.stringify(server));
say("وأقرب صلاحيةٍ باقية هي دفعة الإدخال", server?.expiry === "2027-01-01", String(server?.expiry));

// «الكل» تُظهر البنود السليمة كذلك — والافتتاح على «يحتاج تصرّفًا» اختيارٌ لا عجز.
await page.getByRole("button", { name: "كل البنود" }).click();
await page.waitForTimeout(1200);
say("«كل البنود» تعرض البند كذلك", (await page.locator("body").innerText()).includes(name));
await page.screenshot({ path: OUT + "/inventory-2-list.png", fullPage: true });

// الإيقاف لا يحذف: يختفي البند من الشاشة ويبقى سجلّه.
await item.getByRole("button", { name: "إيقاف البند" }).click();
await page.waitForTimeout(2500);
say("البند الموقوف يختفي من «كل البنود»", !(await page.locator("body").innerText()).includes(name));
await page.getByRole("button", { name: "الموقوفة" }).click();
await page.waitForTimeout(1500);
const parked = await page.locator("body").innerText();
say("ويظهر في «الموقوفة» بسجلّه — الإيقاف لا يحذف", parked.includes(name));
console.log("6) أُوقف البند وبقي سجلّه");

/*
 * العدّاد على القشرة: الوحدة تُنادي صاحبها ولا تنتظر أن يُفتَح لها.
 *
 * ويُقابَل الرقمُ المعروض بما يقوله الخادم في الحالتين — عدّادٌ يقول رقمًا والشاشةُ
 * تقول غيره أسوأ من لا عدّاد: يُتعلَّم أن العدّاد لا يُصدَّق، ثم لا يُصدَّق حين يصدق.
 */
const badgeState = async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const attention = await page.evaluate(async () =>
    (await (await fetch("/api/inventory?summary=1", { cache: "no-store" })).json()).attention);
  const link = (await page.getByRole("link", { name: /المخزون/ }).first().innerText())
    .replace(/\s+/g, " ").trim();
  // العدد إن وُجد، وإلا فالرابط بلا رقم.
  const badge = Number((link.match(/\d+/) ?? [0])[0]);
  return { attention, badge, link };
};

const quiet = await badgeState();
say("العدّاد يوافق الخادم بعد إيقاف البند", quiet.badge === quiet.attention,
  `الشاشة ${quiet.badge} · الخادم ${quiet.attention}`);

// بندٌ جديد بلا رصيد = «نفد» = تصرّفٌ اليوم. فيجب أن يرتفع العدّاد بواحد.
const fresh = "بندُ العدّاد " + Date.now().toString().slice(-5);
await page.evaluate(async (itemName) => {
  await fetch("/api/inventory", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: itemName, category: "consumable", unit: "علبة", minLevel: 2 }),
  });
}, fresh);
const alerted = await badgeState();
say("وبندٌ نفد يرفعه بواحد", alerted.attention === quiet.attention + 1,
  `${quiet.attention} ← ${alerted.attention}`);
say("ويظهر الرقم على الرابط", alerted.badge === alerted.attention, alerted.link);
console.log("7) القشرة تنادي على المخزون بلا أن يُفتح");

console.log(failed ? "\nسقطت رحلة المخزون." : "\nرحلة المخزون تامّة.");
await b.close();
process.exit(failed ? 1 : 0);
