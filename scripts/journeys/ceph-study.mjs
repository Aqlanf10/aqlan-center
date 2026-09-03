#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";
import { createPatient } from "./patient.mjs";
import { makePng } from "./png.mjs";

/**
 * رحلة الدراسة السيفالومترية — الترابط بين الوحدتين على شاشةٍ حقيقية.
 *
 * وما تفحصه هو ما لا يُرى في اختبارٍ ولا في فحصِ قاعدة: **هل يصل الطبيب من ملف
 * المريض إلى دراسته في نقرتين؟ وهل تقول له الشاشة، حين يتغيّر التتبّع بعد
 * الاعتماد، إن ما يقرؤه أرقامُ يوم اعتُمد لا أرقامُ اليوم؟**
 *
 * والثاني هو الأهمّ: تجميدٌ صحيحٌ في القاعدة لا يُرى في الواجهة يجعل الطبيب يظنّ
 * أحد الرقمين عطلًا — وهو ليس عطلًا، هو التصميم.
 *
 *   الاستعمال: node scripts/journeys/ceph-study.mjs
 */

const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const DOC_LABEL = "سيفالومتري للدراسة";
const chromium = await loadChromium();

/** وجهٌ سويّ محسوب — نفس إحداثيات فحص القاعدة. */
const NORMAL = {
  S: { x: 0.34, y: 0.235 }, N: { x: 0.62, y: 0.26 },
  A: { x: 0.5588, y: 0.5230 }, B: { x: 0.5158, y: 0.6462 },
  Or: { x: 0.40, y: 0.40 }, Po: { x: 0.25, y: 0.42 },
  Go: { x: 0.30, y: 0.70 }, Me: { x: 0.55, y: 0.80 },
  Gn: { x: 0.54, y: 0.78 }, Pog: { x: 0.53, y: 0.75 },
};

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "ar" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 160)));

let failed = false;
const say = (label, ok, extra = "") => {
  console.log(`   ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};
const type = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 12 }); };

try {
  await login(page, { base: BASE, user: USER, pass: PASS });
  await page.waitForTimeout(2500);

  const name = "مريضة الدراسة " + Date.now().toString().slice(-5);
  const patientUrl = await createPatient(page, { name, phone: null, base: BASE, gender: "أنثى" });
  const patientId = Number(new URL(patientUrl, BASE).pathname.split("/").pop());
  console.log("1) ملف المريض والأشعة");
  say("أُنشئ الملف", Number.isInteger(patientId) && patientId > 0, `#${patientId}`);

  await page.getByRole("button", { name: "الأشعة" }).click();
  await page.waitForTimeout(1800);
  await type(page.getByLabel("وصف المستند"), DOC_LABEL);
  await page.getByLabel("ملف الأشعة").setInputFiles({
    name: "ceph.png", mimeType: "image/png", buffer: makePng(320, 320),
  });
  await page.getByRole("button", { name: "ارفع" }).click();
  await page.waitForTimeout(3500);

  // التتبّع يُزرع عبر المسار نفسه الذي تستعمله الشاشة — الرحلة تفحص الدراسة لا
  // النقر، والنقرُ مفحوصٌ في رحلة السيفالو على حدة.
  const documentId = await page.evaluate(async ([id, points]) => {
    const list = await (await fetch(`/api/patients/${id}/documents`)).json();
    const image = list.documents.find((row) => row.isImage && !row.removedAt);
    await fetch(`/api/documents/${image.id}/tracing`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, calibration: null, note: null }),
    });
    return image.id;
  }, [patientId, NORMAL]);
  say("ورُفعت الأشعة وتُتبّعت", Number.isInteger(documentId), `مستند ${documentId}`);

  console.log("2) تبويب السيفالو في ملف المريض");
  await page.goto(`${BASE}/patients/${patientId}?tab=ceph`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const opened = await page.locator("body").innerText();
  say("فُتح التبويب من الرابط", opened.includes("دراسة جديدة"));
  say("ويقول إن لا دراسة معتمدة بعد", opened.includes("لا دراسة معتمدة"));

  console.log("3) دراسةٌ جديدة على الأشعّة");
  await page.getByRole("button", { name: "+ دراسة جديدة" }).click();
  await page.waitForTimeout(600);
  const form = page.locator('form[aria-label="دراسة جديدة"]');
  await form.getByLabel("صورة الأشعة").selectOption(String(documentId));
  await form.getByLabel("مرحلة العلاج").selectOption("pre");
  await page.getByRole("button", { name: "حفظ الدراسة" }).click();
  await page.waitForTimeout(2000);
  const listed = await page.locator("body").innerText();
  say("ظهرت في القائمة", listed.includes("ما قبل العلاج") && listed.includes("مسودّة"));
  say("وتقول كم معلمًا فيها", /\d+ معلمًا/.test(listed));

  console.log("4) الاعتماد");
  await page.getByRole("button", { name: "اعتماد" }).first().click();
  await page.waitForTimeout(2000);
  const approved = await page.locator("body").innerText();
  say("صارت معتمدة", approved.includes("معتمدة"));
  say("وباسم من اعتمدها", approved.includes("اعتمدها"));
  say("وصارت مرجع مرحلتها", approved.includes("معتمدة · إصدار 1"));

  // القياس قبل التصحيح — من مسار الدراسة نفسه.
  const studyId = await page.evaluate(async (id) => {
    const body = await (await fetch(`/api/patients/${id}/ceph-studies`)).json();
    return body.studies[0].id;
  }, patientId);
  const before = await page.evaluate(async (id) => {
    const body = await (await fetch(`/api/ceph/studies/${id}`)).json();
    return {
      sna: body.analysis.measurements.find((m) => m.key === "SNA").value,
      source: body.source,
    };
  }, studyId);
  say("وقياسُها يُقرأ من لقطتها", before.source === "snapshot", `SNA ${before.sna.toFixed(2)}`);

  console.log("5) ثم يُصحَّح التتبّع بعدها");
  await page.evaluate(async ([id, points]) => {
    await fetch(`/api/documents/${id}/tracing`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: { ...points, A: { x: 0.60, y: 0.50 } }, calibration: null, note: null }),
    });
  }, [documentId, NORMAL]);

  const after = await page.evaluate(async ([study, document]) => {
    const one = await (await fetch(`/api/ceph/studies/${study}`)).json();
    const live = await (await fetch(`/api/documents/${document}/tracing?aspect=1`)).json();
    return {
      study: one.analysis.measurements.find((m) => m.key === "SNA").value,
      live: (live.tracing ?? live).analysis.measurements.find((m) => m.key === "SNA").value,
    };
  }, [studyId, documentId]);
  say("التتبّع الحيّ تغيّر", Math.abs(after.live - before.sna) > 1,
    `${before.sna.toFixed(2)} ← ${after.live.toFixed(2)}`);
  say("والدراسة المعتمدة لم تتغيّر", Math.abs(after.study - before.sna) < 0.001,
    after.study.toFixed(2));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const warned = await page.locator("body").innerText();
  say("**والشاشة تقول ذلك صراحةً** — لا يُقرأ رقمٌ على أنه المعتمد وهو ليس هو",
    warned.includes("تتبّع الصورة تغيّر بعد الاعتماد"));

  console.log("6) إصدارٌ ثانٍ");
  await page.getByRole("button", { name: "+ دراسة جديدة" }).click();
  await page.waitForTimeout(600);
  const second = page.locator('form[aria-label="دراسة جديدة"]');
  await second.getByLabel("صورة الأشعة").selectOption(String(documentId));
  await page.getByRole("button", { name: "حفظ الدراسة" }).click();
  await page.waitForTimeout(2000);
  const both = await page.locator("body").innerText();
  say("الإصدار الثاني ظهر", both.includes("إصدار 2"));
  say("والأولى باقيةٌ معتمدة — الإصدارات تتراكم ولا تُستبدل",
    both.includes("إصدار 1") && both.includes("معتمدة"));

  /*
   * ٧) الورقة تقول ما تقوله الشاشة — على أشعّةٍ **غير مربّعة**.
   *
   * وهذا ما كان يفوت: المعالم كسورٌ من العرض والارتفاع، فالنسبة تدخل حساب
   * الزاوية. الشاشة تعرفها لأن المتصفّح حمّل الصورة؛ وصفحة الطباعة لا ترسلها،
   * فكانت تُحسب على ١. **ورحلةُ السيفالو ترفع صورةً مربّعة فتتطابق بالصدفة.**
   */
  console.log("7) الورقة تقول ما تقوله الشاشة — على أشعّة 4:5");
  await page.getByRole("button", { name: "الأشعة" }).click().catch(() => {});
  await page.goto(`${BASE}/patients/${patientId}?tab=documents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await type(page.getByLabel("وصف المستند"), "أشعّة غير مربّعة");
  await page.getByLabel("ملف الأشعة").setInputFiles({
    name: "tall.png", mimeType: "image/png", buffer: makePng(200, 250),
  });
  await page.getByRole("button", { name: "ارفع" }).click();
  await page.waitForTimeout(3500);

  const tall = await page.evaluate(async ([id, points]) => {
    const list = await (await fetch(`/api/patients/${id}/documents`)).json();
    const image = list.documents.find((row) => row.title === "أشعّة غير مربّعة" && !row.removedAt);
    await fetch(`/api/documents/${image.id}/tracing`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, calibration: null, note: null }),
    });
    // الشاشة ترسل النسبة الحقيقية؛ والورقة لا ترسل شيئًا.
    const screen = await (await fetch(`/api/documents/${image.id}/tracing?aspect=${200 / 250}`)).json();
    const paper = await (await fetch(`/api/documents/${image.id}/tracing`)).json();
    const read = (body, key) =>
      (body.tracing ?? body).analysis.measurements.find((m) => m.key === key).value;
    return {
      id: image.id,
      width: image.imageWidth, height: image.imageHeight,
      screenFma: read(screen, "FMA"), paperFma: read(paper, "FMA"),
    };
  }, [patientId, NORMAL]);

  say("أبعاد الصورة حُفظت وقت الرفع", tall.width === 200 && tall.height === 250,
    `${tall.width}×${tall.height}`);
  say("والخادم يحسب بها ولو لم تُرسَل النسبة",
    Math.abs(tall.screenFma - tall.paperFma) < 0.001,
    `FMA ${tall.screenFma.toFixed(2)} = ${tall.paperFma.toFixed(2)}`);

  const printed = await page.evaluate(async (id) => {
    const html = await (await fetch(`/print/ceph/${id}`)).text();
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }, tall.id);
  say("والورقة المطبوعة نفسها تحمل الرقم نفسه",
    printed.includes(tall.screenFma.toFixed(1)),
    `تبحث عن ${tall.screenFma.toFixed(1)}`);

  console.log(failed ? "\nسقطت الرحلة." : "\nرحلة الدراسة اكتملت.");
} finally {
  await context.close();
  await browser.close();
}

process.exit(failed ? 1 : 0);
