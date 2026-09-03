#!/usr/bin/env node
import { loadChromium, executablePath } from "./playwright.mjs";
import { login } from "./login.mjs";
import { createPatient } from "./patient.mjs";

/**
 * رحلة المال — أكبر سطحٍ غير مُثبَت في النظام.
 *
 * تسع شاشاتٍ مالية ومنطقُها مغطًّى باختبارات وحدة، **ولم يُثبَت قطّ أنها تعمل من
 * الطرف إلى الطرف**. وهذا ما قاله جرد وحدة السيفالو عن نفسه: «لا رحلة للمالية —
 * أكبر سطحٍ غير مُثبَت، وهو سطح المال».
 *
 * والسؤال الحاكم ليس «هل تُحفظ الدفعة» بل:
 *
 *   **هل تقول الشاشةُ وكشفُ الحساب والدفاترُ الرقمَ نفسه بعد كل حركة؟**
 *
 * فثلاثة أرقامٍ لحقيقةٍ واحدة تفترق بصمت، ولا يُعرف أيّها الصحيح إلا بعد أن
 * يُبنى على الخطأ.
 *
 * وتنظّف أثرها: تُغلق الوردية التي فتحتها هي وحدها، ولا تمسّ ورديةً وجدتها
 * مفتوحة — رحلةٌ تُغلق صندوق عيادةٍ تعمل أسوأ من رحلةٍ لا توجد.
 *
 *   الاستعمال: node scripts/journeys/finance.mjs
 */

const BASE = process.env.JOURNEY_BASE ?? "http://127.0.0.1:3000";
const USER = process.env.JOURNEY_USER ?? "shots";
const PASS = process.env.JOURNEY_PASS ?? "shots-only-local-1234";
const chromium = await loadChromium();

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: "ar" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[خطأ صفحة]", String(e).slice(0, 160)));

let failed = false;
/** رقمُ الوردية التي فتحتها هذه الرحلة — وحدها تُغلق، ولا شيء غيرها. */
let ourShiftId = null;
const say = (label, ok, extra = "") => {
  console.log(`   ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};
const type = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 12 }); };

/*
 * المبالغ بالريال اليمني.
 *
 * **ولا وحدةَ صغرى له**: `MINOR_UNITS.YER = 1` — الريال هو الوحدة الصغرى، بخلاف
 * الريال السعودي والدولار. فضربُ المبلغ في مئة هنا خطأ، وقد وقعتُ فيه أوّل مرة
 * فسقط الفحص على رقمٍ صحيح.
 */
const FEE = 40000;
const PAID = 15000;
const SPENT = 3000;

/** رصيد حساب ذمم المرضى `1201` من ميزان المراجعة — بالرمز لا بالاسم. */
const arBalance = async () => {
  const books = await api("/api/accounting?from=2000-01-01&to=2100-01-01");
  const row = (books.body?.balances ?? []).find((one) => one.code === "1201");
  return Number(row?.balanceMinor ?? 0);
};

const api = (path, init) => page.evaluate(async ([p, i]) => {
  const response = await fetch(p, i ? { ...i, headers: { "Content-Type": "application/json" } } : undefined);
  return { status: response.status, body: await response.json().catch(() => null) };
}, [path, init]);

try {
  await login(page, { base: BASE, user: USER, pass: PASS });
  await page.goto(`${BASE}/finance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  console.log("1) الوردية");
  const before = await api("/api/shifts");
  say("قُرئت حالة الصندوق", before.status === 200);

  /*
   * ورديةٌ مفتوحة أصلًا: **تُهجَر الرحلة كلّها**.
   *
   * وأوّل صيغةٍ كتبتُها كانت تكتفي بتخطّي الفتح ثم تمضي فتقبض وتصرف — والدفعة
   * والمصروف يلتصقان بالوردية المفتوحة **أيًّا كانت**. فرحلةٌ تُشغَّل على جهازٍ
   * موجَّهٍ إلى الإنتاج أثناء وردية كاشيرٍ حقيقية تدسّ فيها ١٥٬٠٠٠ قبضًا و٣٬٠٠٠
   * صرفًا، فيختلّ جردُها ولا يُعرف السبب. وهذا أسوأ من إغلاقها.
   */
  if (before.body?.open) {
    console.log("   ✗ وردية مفتوحة أصلًا — تُهجَر الرحلة، ولا تُدسّ حركاتٌ في صندوق أحد.");
    console.log("     أغلقها من شاشة المالية ثم أعد التشغيل.");
    process.exit(2);
  }

  /*
   * ولا قبضَ قبل الفتح — أوّل ما يُفحص، لأنه الحارس الذي يمنع مالًا يدخل بلا
   * وردية فلا يظهر في أي إغلاق.
   */
  const early = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({ patientId: 1, amount: "100", currency: "YER", kind: "payment", method: "cash" }),
  });
  say("لا تُقبض دفعة قبل فتح الوردية", early.status === 409 || early.status === 400,
    early.body?.message ?? `${early.status}`);

  /*
   * والفتح من المسار مباشرةً لا من الزرّ — لأن **الملكية تُشتقّ من جواب الفتح**.
   * والزرّ لا يقول إن نجح: لو فتح زميلٌ ورديةً بين القراءة والنقر لردّ الخادم
   * ٤٠٩، ولظنّت الرحلة أن الوردية لها فأغلقت وردية غيرها في النهاية.
   */
  const opened = await api("/api/shifts", { method: "POST", body: JSON.stringify({ opening: {} }) });
  say("فُتحت وردية باسم الرحلة", opened.status === 201 && Number(opened.body?.id) > 0,
    opened.body?.message ?? `${opened.status}`);
  if (opened.status !== 201) {
    console.log("   ✗ لم تُفتح وردية — تُهجَر الرحلة قبل أي حركة مالية.");
    process.exit(2);
  }
  ourShiftId = Number(opened.body.id);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  console.log("2) فاتورة ودفعة من ملف المريض");
  const name = "مريض المال " + Date.now().toString().slice(-5);
  const patientUrl = await createPatient(page, { name, phone: null, base: BASE, gender: "ذكر" });
  const patientId = Number(new URL(patientUrl, BASE).pathname.split("/").pop());
  say("أُنشئ الملف", Number.isInteger(patientId) && patientId > 0, `#${patientId}`);

  /*
   * رصيد ذمم المرضى في الدفاتر **قبل** أي حركة — فيُقاس الفرق لا الرقم المطلق.
   * والقاعدة فيها بيانات سابقة، فالرقم المطلق يقول شيئًا عن كل التاريخ لا عن
   * هذه الحركة.
   */
  const receivableBefore = await arBalance();

  await page.goto(`${BASE}/patients/${patientId}?tab=ledger`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "فاتورة جديدة" }).click();
  await page.waitForTimeout(600);
  const invoiceForm = page.locator('section[aria-label="فاتورة جديدة"]');
  await type(invoiceForm.getByLabel("وصف البند").first(), "كشف وتقويم");
  await type(invoiceForm.getByLabel("السعر").first(), String(FEE));
  await page.getByRole("button", { name: "احفظ الفاتورة" }).click();
  await page.waitForTimeout(2200);

  const afterInvoice = await api(`/api/patients/${patientId}/ledger`);
  const invoices = afterInvoice.body?.invoices ?? [];
  say("صدرت الفاتورة", invoices.length === 1, `${invoices.length}`);
  say("وبالمبلغ المكتوب لا بغيره",
    Number(invoices[0]?.totalMinor) === FEE, `${invoices[0]?.totalMinor}`);

  await page.getByRole("button", { name: "قبض دفعة" }).click();
  await page.waitForTimeout(600);
  const paymentForm = page.locator('section[aria-label="قبض دفعة"]');
  await type(paymentForm.getByLabel("المبلغ"), String(PAID));
  await page.getByRole("button", { name: "سجّل الدفعة واطبع السند" }).click();
  await page.waitForTimeout(2500);

  const afterPayment = await api(`/api/patients/${patientId}/ledger`);
  const payments = afterPayment.body?.payments ?? [];
  say("قُبضت الدفعة", payments.length === 1, `${payments.length}`);
  say("وبالمبلغ المكتوب", Number(payments[0]?.amountMinor) === PAID, `${payments[0]?.amountMinor}`);

  console.log("3) الشاشة وكشف الحساب والدفاتر — رقمٌ واحد لا ثلاثة");
  const owed = FEE - PAID;

  const onScreen = await page.locator("body").innerText();
  say("الشاشة تعرض المتبقي", onScreen.includes("25,000") || onScreen.includes("٢٥٬٠٠٠"),
    `المتوقَّع ${owed}`);

  const statement = await page.evaluate(async (id) => {
    const html = await (await fetch(`/print/statement/${id}`)).text();
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }, patientId);
  say("وكشف الحساب المطبوع يوافقها",
    statement.includes("25,000") || statement.includes("٢٥٬٠٠٠"));

  /*
   * والدفاتر: حساب ذمم المرضى `1201` **بالرمز لا بالبحث في الاسم**.
   *
   * وأوّل صيغةٍ كتبتُها بحثت عن رمزٍ يبدأ بـ«11» أو اسمٍ فيه «مدين» — فوجدت
   * **حساب الصندوق** وقالت «✓ وفيها حساب ذمم المرضى». وفحصٌ يجد الحساب الخطأ
   * ويمرّ أسوأ من فحصٍ لا يوجد.
   */
  const receivableAfter = await arBalance();
  say("رصيد الذمم في الدفاتر تحرّك بمقدار المتبقي — لا بأكثر ولا بأقلّ",
    receivableAfter - receivableBefore === owed,
    `${receivableBefore} ← ${receivableAfter} (الفرق ${receivableAfter - receivableBefore}، المتوقَّع ${owed})`);

  console.log("4) سند صرف — والمصروف يُطرح من المتوقَّع");
  await page.goto(`${BASE}/finance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const shiftNow = await api("/api/shifts");
  if (shiftNow.body?.open) {
    await page.getByRole("button", { name: "سند صرف" }).click();
    await page.waitForTimeout(600);
    const voucher = page.locator('section[aria-label="سند صرف"]');
    await type(voucher.getByLabel("اسم المستفيد"), "مواد مستهلكة");
    await type(voucher.getByLabel("المبلغ"), String(SPENT));
    await page.getByRole("button", { name: /احفظ|سجّل|اصرف/ }).first().click();
    await page.waitForTimeout(2200);

    const withExpense = await api("/api/shifts");
    const spentTotal = Number(withExpense.body?.expenseTotals?.byCurrency?.YER ?? 0);
    say("سُجّل الصرف من الوردية", spentTotal >= SPENT, `${spentTotal}`);

    const takenTotal = Number(withExpense.body?.totals?.byCurrency?.YER ?? 0);
    say("والمقبوض في الوردية يشمل الدفعة", takenTotal >= PAID, `${takenTotal}`);

    /*
     * وهذا هو أشيع خطأ في إغلاق الصناديق: إهمالُ المصروف من المتوقَّع يجعل كل
     * إغلاق يبدو ناقصًا بمقدار ما صُرف، فيُتجاهل الفرق ويصير الجرد بلا فائدة.
     */
    const opening = Number(withExpense.body?.open?.opening?.YER ?? 0);
    const expected = opening + takenTotal - spentTotal;
    const shown = await page.locator("body").innerText();
    const expectedText = new Intl.NumberFormat("en-US").format(expected);
    say("والمتوقَّع في الصندوق = الافتتاحي + المقبوض − المصروف",
      shown.includes(expectedText), `المتوقَّع ${expectedText}`);
  } else {
    say("الوردية ما زالت مفتوحة للصرف", false, "أُغلقت من مكانٍ آخر");
  }

  console.log("5) الإغلاق بجرد");
  {
    const state = await api("/api/shifts");
    say("والوردية المفتوحة هي وردية الرحلة لا غيرها",
      Number(state.body?.open?.id) === ourShiftId,
      `${state.body?.open?.id} مقابل ${ourShiftId}`);
    const opening = Number(state.body?.open?.opening?.YER ?? 0);
    const expected = opening + Number(state.body?.totals?.byCurrency?.YER ?? 0)
      - Number(state.body?.expenseTotals?.byCurrency?.YER ?? 0);

    await page.getByRole("button", { name: "إغلاق الوردية وجرد الصندوق" }).click();
    await page.waitForTimeout(800);
    const counters = page.locator('input[placeholder="0"]');

    /*
     * يُعدّ **رقمٌ خاطئ أوّلًا** ليُرى أن الفرق يظهر فعلًا.
     *
     * وأوّل صيغةٍ كتبتُها كانت تعدّ المتوقَّع بالضبط ثم تشترط غياب «نقص» و«زيادة»
     * — وهذا يمرّ حتى لو حُذفت ميزة الفرق كلّها من الشاشة. **فحصٌ يمرّ على غياب
     * ما لم يُطلب إظهاره ليس فحصًا.**
     */
    await type(counters.first(), String(expected - 500));
    await page.waitForTimeout(600);
    const mismatch = await page.locator("body").innerText();
    say("عدٌّ أقلّ من المتوقَّع يُظهر «نقص» قبل الحفظ", mismatch.includes("نقص"));
    await counters.first().fill("");
    await type(counters.first(), String(expected + 500));
    await page.waitForTimeout(600);
    say("وعدٌّ أكثر يُظهر «زيادة»",
      (await page.locator("body").innerText()).includes("زيادة"));

    await counters.first().fill("");
    await type(counters.first(), String(expected));
    await page.waitForTimeout(600);
    const exact = await page.locator("body").innerText();
    say("والعدّ المطابق لا يُظهر فرقًا",
      !exact.includes("نقص") && !exact.includes("زيادة"));

    await page.getByRole("button", { name: "أغلق الوردية" }).click();
    await page.waitForTimeout(2500);
    const closed = await api("/api/shifts");
    const reallyClosed = !closed.body?.open;
    say("أُغلقت الوردية", reallyClosed);
    // الملكية لا تُسقَط إلّا بعد التثبّت — وإلّا عُطِّل تنظيفُ `finally`.
    if (reallyClosed) ourShiftId = null;
  }

  console.log(failed ? "\nسقطت الرحلة." : "\nرحلة المال اكتملت.");
} finally {
  /*
   * ما فتحته الرحلة تُغلقه — في النجاح وفي السقوط، **وبرقمه**.
   *
   * والمسار يشترط `id` موجبًا ويردّ ٤٠٠ بدونه؛ وأوّل صيغةٍ كتبتُها أهملته
   * وأهملت الجواب معًا — فكان «التنظيف المضمون» يترك الوردية مفتوحة بصمت.
   */
  if (ourShiftId) {
    const result = await page.evaluate(async (id) => {
      const state = await (await fetch("/api/shifts")).json();
      if (!state.open || state.open.id !== id) return "ليست لنا";
      const response = await fetch("/api/shifts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, counted: {}, note: "إغلاق بعد سقوط رحلة المال" }),
      });
      return response.ok ? "أُغلقت" : `تعذّر (${response.status})`;
    }, ourShiftId).catch((error) => `تعذّر (${String(error).slice(0, 40)})`);
    console.log(`   تنظيف: وردية ${ourShiftId} — ${result}`);
  }
  await context.close();
  await browser.close();
}

process.exit(failed ? 1 : 0);
