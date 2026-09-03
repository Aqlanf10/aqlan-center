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
   * ٧) ورقةُ الدراسة تحمل أرقام يوم الاعتماد لا أرقام اليوم.
   *
   * وهذا ما كان ناقصًا: زرّ التقرير كان يفتح تتبّع الصورة الحالي مهما كانت
   * الدراسة معتمدة — فتخرج على الورقة أرقامٌ غيرُ التي وُقِّعت. والدراسة المعتمدة
   * لا تتغيّر تحت من اعتمدها؛ **وورقتُها كذلك**.
   */
  console.log("7) ورقة الدراسة");
  const papers = await page.evaluate(async ([study, document]) => {
    const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return {
      ofStudy: strip(await (await fetch(`/print/ceph/${document}?study=${study}`)).text()),
      ofImage: strip(await (await fetch(`/print/ceph/${document}`)).text()),
      strangerStudy: (await fetch(`/print/ceph/${document}?study=999999`)).status,
    };
  }, [studyId, documentId]);

  say("ورقةُ الدراسة تحمل رقم يوم الاعتماد", papers.ofStudy.includes(before.sna.toFixed(1)),
    `تبحث عن ${before.sna.toFixed(1)}`);
  say("ولا تحمل الرقم الذي صار بعده", !papers.ofStudy.includes(after.live.toFixed(1)),
    `لا يجب أن تجد ${after.live.toFixed(1)}`);
  say("وتقول إنها معتمدة ومن اعتمدها", papers.ofStudy.includes("معتمدة") && papers.ofStudy.includes("اعتمدها"));
  say("وتنبّه أن التتبّع تغيّر بعدها", papers.ofStudy.includes("يوم الاعتماد"));
  say("وورقةُ الصورة بلا دراسة تحمل الرقم الحالي وتقول إنها ليست دراسةً معتمدة",
    papers.ofImage.includes(after.live.toFixed(1)) && papers.ofImage.includes("لا دراسةً معتمدة"));
  say("ودراسةٌ لا تخصّ هذه الأشعّة لا تُطبع عليها", papers.strangerStudy === 404,
    `${papers.strangerStudy}`);

  /*
   * وأربعةٌ وجدها المراجع الآلي على هذا التغيير — وكلّها صحيحة:
   *
   * ١) الورقة كانت تنسب أرقامَ يوم الاعتماد إلى **آخر من عدّل التتبّع بعده**،
   *    وتؤرّخها بتاريخه. فتُنسب وثيقةٌ موقَّعة إلى غير صاحبها.
   * ٢) وتُذيَّل بملاحظةٍ كُتبت **بعد** الاعتماد، فتُضيف إلى الوثيقة ما لم يكن
   *    فيها يوم وُقِّعت.
   * ٣) وهويّة الطبعة كانت رقم الأشعّة وحده، فأوّلُ طبعةٍ للإصدار الثاني تُختم
   *    «نسخة معاد طباعتها» — وهو ادّعاءٌ على الورقة يجب أن يصدق.
   * ٤) والورقة الإنجليزية كانت تحمل مرحلةَ الدراسة وحالتها بالعربية.
   */
  say("ولا تنسب أرقام يوم الاعتماد إلى من عدّل بعده",
    !papers.ofStudy.includes("نفّذ التتبّع") && papers.ofStudy.includes("اعتمدها"));

  const english = await page.evaluate(async ([study, document]) => {
    const html = await (await fetch(`/print/ceph/${document}?study=${study}&lang=en`)).text();
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }, [studyId, documentId]);
  say("والورقة الإنجليزية إنجليزيةٌ كلّها",
    english.includes("Pre-treatment") && english.includes("Approved")
      && !english.includes("ما قبل العلاج") && !english.includes("معتمدة"));

  /*
   * **والتاريخ منها.**
   *
   * وهذا ما فات الفحص أوّلَ مرّة: كان ينظر إلى المرحلة والحالة ولا ينظر إلى
   * التاريخ، وكانت الورقة الإنجليزية تحمل «الخميس ٠٣/٠٩/٢٠٢٦» بيوم أسبوعٍ
   * عربي. وفحصٌ ينظر إلى بعض الورقة يشهد لكلّها.
   */
  say("**وتاريخها إنجليزيٌّ أيضًا — لا يومَ أسبوعٍ عربيًّا**",
    /Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday/.test(english)
      && !/الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت/.test(english));

  const reprint = await page.evaluate(async ([document, study]) => {
    // العلامة تُقرأ من الصنف لا من النصّ: «نسخة معاد طباعتها» مكتوبةٌ دائمًا
    // في الورقة، و`reprint-mark-on` وحده هو ما يُظهرها.
    const mark = async (id) => {
      const html = await (await fetch(`/print/ceph/${document}?study=${id}`)).text();
      return html.includes("reprint-mark-on");
    };
    // تُسجَّل طبعةٌ للإصدار الأول، ثم يُنظر إلى ورقة الإصدار الثاني.
    const logged = await fetch("/api/print-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docType: "ceph", docId: `${document}:${study.first}` }),
    });
    return { logged: logged.status, first: await mark(study.first), second: await mark(study.second) };
  }, [documentId, { first: studyId, second: await page.evaluate(async (id) => {
    const body = await (await fetch(`/api/patients/${id}/ceph-studies`)).json();
    return body.studies.find((row) => row.revision === 2).id;
  }, patientId) }]);
  say("سُجّلت طبعةٌ للإصدار الأول", reprint.logged === 200, `${reprint.logged}`);
  say("وطبعةُ إصدارٍ لا تختم إصدارًا آخر بـ«معاد طباعتها»",
    reprint.first === true && reprint.second === false,
    `الأول ${reprint.first ? "معاد" : "أوّل"} · الثاني ${reprint.second ? "معاد" : "أوّل"}`);


  /*
   * ٨) الورقة تقول ما تقوله الشاشة — على أشعّةٍ **غير مربّعة**.
   *
   * وهذا ما كان يفوت: المعالم كسورٌ من العرض والارتفاع، فالنسبة تدخل حساب
   * الزاوية. الشاشة تعرفها لأن المتصفّح حمّل الصورة؛ وصفحة الطباعة لا ترسلها،
   * فكانت تُحسب على ١. **ورحلةُ السيفالو ترفع صورةً مربّعة فتتطابق بالصدفة.**
   */
  console.log("8) الورقة تقول ما تقوله الشاشة — على أشعّة 4:5");
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
  // ودراسةٌ على هذه الأشعّة أيضًا — فيصير في الملف ثلاثٌ، ويُفحص أن اختيار
  // الثالثة يُبقي اثنتين. وفحصٌ يُتخطّى حين لا تكفي البيانات فحصٌ لا يُشغَّل.
  await page.evaluate(async ([patient, document]) => {
    await fetch(`/api/patients/${patient}/ceph-studies`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: document, phase: "followup" }),
    });
  }, [patientId, tall.id]);

  say("والورقة المطبوعة نفسها تحمل الرقم نفسه",
    printed.includes(tall.screenFma.toFixed(1)),
    `تبحث عن ${tall.screenFma.toFixed(1)}`);

  /*
   * ٩) المقارنة — ماذا فعل العلاج.
   *
   * والسؤال الذي تجيب عنه ليس «أين المريض من المعيار» بل ما تغيّر بين دراستين،
   * ويُسأل في نهاية علاجٍ امتدّ سنتين وأمام مريضٍ يسأل «هل تحسّنت؟».
   */
  console.log("9) المقارنة بين دراستين");
  await page.goto(`${BASE}/patients/${patientId}?tab=ceph`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const marks = page.getByRole("button", { name: "للمقارنة" });
  say("لكل دراسةٍ زرّ مقارنة", (await marks.count()) >= 2, `${await marks.count()} زرًّا`);
  await marks.nth(0).click();
  await page.waitForTimeout(300);
  await marks.nth(1).click();
  await page.waitForTimeout(400);
  const bar = await page.locator("body").innerText();
  say("والشريط يقول كم اختير", bar.includes("للمقارنة: 2 من 2"));

  // `exact` لازم: «للمقارنة» تحوي «قارن»، فالبحث غير الدقيق يجد ثلاثة أزرار.
  await page.getByRole("button", { name: "قارن", exact: true }).click();
  await page.waitForTimeout(2000);
  const table = page.locator('section[aria-label="مقارنة دراستين"]');
  say("ظهر جدول المقارنة", await table.isVisible());
  const body = await table.innerText();
  say("وفيه سطرُ خلاصةٍ يعدّ ولا يحكم على العلاج",
    /اقترب من معياره/.test(body) && !/نجح|ممتاز/.test(body));
  say("والقراءة مكتوبةٌ نصًّا لا لونًا وحده",
    /اقترب من المعيار|ابتعد عن المعيار|بلا تغيّر يُذكر|بلا معيار/.test(body));
  say("ويقول التاريخين — فمن يقرأه يعرف أيّهما قبل",
    /←/.test(body));

  // ثالثةٌ تُزيح الأولى: اثنتان فقط لا ثلاث.
  say("وفي الملف ثلاث دراسات", (await marks.count()) >= 3, `${await marks.count()}`);
  await marks.nth(2).click();
  await page.waitForTimeout(400);
  say("واختيارُ ثالثةٍ يُبقي اثنتين لا ثلاثًا",
    (await page.locator("body").innerText()).includes("للمقارنة: 2 من 2"));

  /*
   * وقلبُ المعاملين لا يقلب الحكم.
   *
   * وإصدارا دراسةٍ على أشعّةٍ واحدة **يرثان تاريخ تصويرها نفسه** فيتساويان —
   * فكان الترتيب يتبع ترتيب المعاملين في الطلب، وقلبُهما يقلب كل فرقٍ وكل حكم
   * فيصير التحسّن تراجعًا. وهذه أشيع الحالات لا أندرها.
   */
  const swapped = await page.evaluate(async (id) => {
    const body = await (await fetch(`/api/patients/${id}/ceph-studies`)).json();
    const sameImage = body.studies.filter((row) => row.revision === 1 || row.revision === 2)
      .filter((row, _, all) => all.filter((one) => one.documentId === row.documentId).length > 1);
    const [one, two] = sameImage.slice(0, 2);
    const read = async (first, second) => {
      const result = await (await fetch(`/api/ceph/compare?first=${first}&second=${second}`)).json();
      return {
        before: result.before.id, after: result.after.id,
        deltas: result.comparison.measurements.map((m) => m.delta.toFixed(3)).join(","),
      };
    };
    return {
      pair: [one?.id, two?.id],
      sameDate: one?.takenOn === two?.takenOn,
      forward: await read(one.id, two.id),
      backward: await read(two.id, one.id),
    };
  }, patientId);

  say("إصدارا أشعّةٍ واحدة يتساوى تاريخهما — وهنا كان يقع العطل",
    swapped.sameDate === true, `${swapped.pair.join(" و ")}`);
  say("وقلبُ المعاملين لا يقلب «قبل» و«بعد»",
    swapped.forward.before === swapped.backward.before
      && swapped.forward.after === swapped.backward.after,
    `${swapped.forward.before}→${swapped.forward.after} مقابل ${swapped.backward.before}→${swapped.backward.after}`);
  say("ولا يقلب فرقًا واحدًا", swapped.forward.deltas === swapped.backward.deltas);

  /*
   * ١٠) التراكب — الجدول يقول كم تغيّر، والرسم يقول أين.
   *
   * وأوّلُ ما يُفحص أنه **يرفض بلا معايرة** ويقول لماذا: دراسات هذه الرحلة بلا
   * معايرة، فالتراكب عليها لا يُعرف مقياسه — ورسمٌ يبدو صحيحًا وهو غلط أسوأ من
   * لا رسم.
   */
  console.log("10) التراكب");
  await page.getByRole("button", { name: "تراكب" }).click();
  await page.waitForTimeout(1500);
  const refused = await page.locator("body").innerText();
  say("يُرفض بلا معايرة — ويقول السبب لا «تعذّر»",
    refused.includes("يحتاج معايرة الصورتين"));

  // ثم تُعايَر الصورتان وتُعاد المحاولة.
  const calibrated = await page.evaluate(async ([patient, docs]) => {
    const bar = { from: { x: 0.1, y: 0.9 }, to: { x: 0.3, y: 0.9 }, millimetres: 20 };
    for (const id of docs) {
      const current = await (await fetch(`/api/documents/${id}/tracing`)).json();
      const tracing = current.tracing ?? current;
      await fetch(`/api/documents/${id}/tracing`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: tracing.points, calibration: bar, note: null }),
      });
    }
    const body = await (await fetch(`/api/patients/${patient}/ceph-studies`)).json();
    // دراستان مسودّتان تقرآن التتبّع الحيّ — فتحملان المعايرة الجديدة.
    return body.studies.filter((row) => row.status === "draft").map((row) => row.id);
  }, [patientId, [documentId, tall.id]]);

  say("عُويرت الصورتان", calibrated.length >= 2, `${calibrated.length} مسودّة`);

  const drawn = await page.evaluate(async ([first, second]) => {
    const response = await fetch(`/api/ceph/superimpose?first=${first}&second=${second}`);
    return { status: response.status, body: await response.json() };
  }, calibrated.slice(0, 2));

  say("ثم يُرسم", drawn.status === 200, drawn.body?.message ?? "");
  if (drawn.status === 200) {
    say("وفيه خطوط الدراستين معًا",
      drawn.body.before.lines.length > 0 && drawn.body.after.lines.length > 0,
      `${drawn.body.before.lines.length} و ${drawn.body.after.lines.length}`);
    say("ويقول طول قاعدة الجمجمة بالمليمتر في كلٍّ",
      Number.isFinite(drawn.body.cranialBaseBefore) && drawn.body.cranialBaseBefore > 0,
      `${drawn.body.cranialBaseBefore.toFixed(1)} ← ${drawn.body.cranialBaseAfter.toFixed(1)} مم`);

    // وقلبُ المعاملين لا يقلب أيّهما «قبل» — كما في المقارنة.
    const flipped = await page.evaluate(async ([first, second]) => {
      const response = await fetch(`/api/ceph/superimpose?first=${second}&second=${first}`);
      return response.json();
    }, calibrated.slice(0, 2));
    say("وقلبُ المعاملين لا يقلب أيّهما الأقدم",
      flipped.before?.id === drawn.body.before.id && flipped.after?.id === drawn.body.after.id,
      `${drawn.body.before.id}→${drawn.body.after.id} مقابل ${flipped.before?.id}→${flipped.after?.id}`);
  }

  /*
   * وعلى الشاشة تُختار **المسودّتان** بعينهما.
   *
   * فالدراسة المعتمدة مجمَّدةٌ بلا معايرة — لُقطتها أُخذت قبل أن تُعايَر الصورة —
   * فلا تُتراكب أبدًا. وهذا صحيح: لقطةُ الاعتماد لا تُعدَّل بأثرٍ رجعي، ولو
   * قُرئت معايرةُ اليوم لها لتغيّرت وثيقةٌ موقَّعة.
   */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const drafts = page.locator("li", { hasText: "مسودّة" });
  say("في الملف مسودّتان معايَرتان", (await drafts.count()) >= 2, `${await drafts.count()}`);
  await drafts.nth(0).getByRole("button", { name: "للمقارنة" }).click();
  await page.waitForTimeout(300);
  await drafts.nth(1).getByRole("button", { name: "للمقارنة" }).click();
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: "تراكب" }).click();
  await page.waitForTimeout(2500);
  const view = page.locator('section[aria-label="تراكب دراستين"]');
  say("والرسم يظهر على الشاشة", await view.isVisible());
  if (await view.isVisible()) {
    const text = await view.innerText();
    say("ويقول أيّهما الأقدم بالنصّ لا باللون وحده",
      text.includes("الأقدم") && text.includes("الأحدث"));
    say("ويقول إن التحجيم ليس على قاعدة الجمجمة — فلا يُقرأ النموّ عطلًا",
      text.includes("لا من طول قاعدة الجمجمة"));
    say("وفيه خطّان مرسومان",
      (await view.locator("svg line").count()) >= 2, `${await view.locator("svg line").count()} خطًّا`);
  }

  /*
   * ١١) الورقة — «قبل وبعد» تخرج من الشاشة إلى اليد.
   *
   * والفحص الحاكم ليس «أظهرت الصفحة» بل **أنّ ترتيبها لا يتبع الرابط**: من ينقر
   * الأحدث أولًا يجب أن يجد الورقة نفسها بالضبط، وإلّا قُرئت نكسةٌ تحسّنًا على
   * ورقةٍ تُعطى لمريض.
   */
  console.log("11) ورقة المقارنة المطبوعة");
  const [firstId, secondId] = calibrated.slice(0, 2);
  const sheet = `${BASE}/print/ceph-compare?first=${firstId}&second=${secondId}`;
  await page.goto(sheet, { waitUntil: "networkidle" });
  const paper = await page.locator("body").innerText();
  say("فُتحت الورقة وعليها هوية المركز", paper.includes("مقارنة دراستين سيفالومتريتين"));
  say("وفيها «قبل» و«بعد» بالنصّ", paper.includes("قبل:") && paper.includes("بعد:"));

  // سطر «قبل» كاملًا — هويّة الدراسة الأقدم كما تكتبها الورقة.
  const beforeLine = (text) => (text.split("\n").find((row) => row.startsWith("قبل:")) ?? "").trim();
  const forward = beforeLine(paper);
  say("وسطرُ «قبل» ليس فارغًا", forward.length > "قبل:".length, forward);

  await page.goto(`${BASE}/print/ceph-compare?first=${secondId}&second=${firstId}`,
    { waitUntil: "networkidle" });
  const flippedPaper = await page.locator("body").innerText();
  say("**وقلبُ الرابط لا يقلب الورقة** — الأقدم يبقى «قبل»",
    beforeLine(flippedPaper) === forward, `${forward} مقابل ${beforeLine(flippedPaper)}`);

  await page.goto(sheet, { waitUntil: "networkidle" });
  say("وفيها التراكب مرسومًا — الصورتان معايَرتان",
    (await page.locator("svg.ceph-superimpose line").count()) >= 4,
    `${await page.locator("svg.ceph-superimpose line").count()} خطًّا`);
  say("ويقول طول قاعدة الجمجمة بالمليمتر", /طول S–N/.test(paper) && /mm/.test(paper));
  say("ويقول إنّ التحجيم من المعايرة لا من طول SN",
    paper.includes("بمقياس المعايرة لا بطول SN"));
  say("وفيها جدولُ قبل/بعد بأسطرٍ فعلية",
    (await page.locator("table.items tbody tr").count()) >= 3,
    `${await page.locator("table.items tbody tr").count()} سطرًا`);
  say("وحصيلةٌ تعدّ ولا تحكم على العلاج",
    /اقترب من معياره/.test(paper) && !/نجح|ممتاز|فشل/.test(paper));

  /*
   * وعلامة «نسخة معاد طباعتها» تصدق.
   *
   * والنصّ «معاد» مرسومٌ دائمًا في الورقة ويُظهره الصنف وحده — ففحصُ الكلمة
   * يمرّ بالصدفة على الطبعة الأولى. فيُفحص الصنف.
   */
  say("ولا علامة إعادةٍ قبل الطباعة الأولى",
    (await page.locator(".reprint-mark-on").count()) === 0);
  const logged = await page.evaluate(async (docId) => {
    const response = await fetch("/api/print-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docType: "ceph-compare", docId }),
    });
    return { status: response.status, body: await response.json() };
    /*
     * ومفتاح الطبعة **بالترتيب الزمني** لا بترتيب النقر — كما تبنيه الورقة.
     *
     * وهذا ما سقط أوّل مرّة: سُجّلت الطبعة بمفتاح `${firstId}:${secondId}`
     * فلم تظهر العلامة، لأنّ الورقة تعدّ طبعاتها على `قبل:بعد`. والسقوط كان
     * صوابًا — لو تبع المفتاح الرابط لصارت الورقة الواحدة طبعتين مختلفتين.
     */
  }, `${drawn.body.before.id}:${drawn.body.after.id}`);
  /*
   * والرحلة تدخل بحساب **مدير**، فقبولُ المسار هنا لا يقول شيئًا عن الطبيب:
   * المدير كان يمرّ بالشرط القديم أيضًا. فالمُثبَت هنا التوصيل وحده — أنّ نوع
   * `ceph-compare` مسجَّلٌ ويُقبل وتظهر أثرُه على الورقة. وأمّا أنّ الطبيب يطبع
   * السريري والاستقبال لا، فتُثبته اختبارات `__tests__/prints.test.ts`.
   */
  say("وتُسجَّل الطبعة — النوع مسجَّلٌ والمسار يقبله",
    logged.status === 200, logged.body?.message ?? `${logged.status}`);
  await page.goto(sheet, { waitUntil: "networkidle" });
  say("**فتظهر العلامة على الثانية**",
    (await page.locator(".reprint-mark-on").count()) === 1);

  console.log(failed ? "\nسقطت الرحلة." : "\nرحلة الدراسة اكتملت.");
} finally {
  await context.close();
  await browser.close();
}

process.exit(failed ? 1 : 0);
