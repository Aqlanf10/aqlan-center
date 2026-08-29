/**
 * تسجيل الدخول من الشاشة — بانتظارٍ للترطيب لا بتقديرٍ للوقت.
 *
 * كان في كل رحلةٍ نسخةٌ من هذه الأسطر تنتظر ثانيتين ونصفًا ثم تكتب. والانتظار
 * بالوقت رهانٌ: إن تأخّر ترطيب React ذهبت الحروف إلى حقلٍ لا يسمعها، فيبقى الزرّ
 * معطّلًا وتسقط الرحلة بخطأٍ يشير إلى الزرّ والعلّة في الكتابة. فصار الانتظار
 * على الأثر لا على الساعة: نكتب، فإن لم تُسجَّل القيمة أعدنا الكتابة.
 */
export async function login(page, { base, user, pass }) {
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.locator("#username").waitFor({ state: "visible" });

  for (let attempt = 1; ; attempt += 1) {
    for (const [selector, text] of [["#username", user], ["#password", pass]]) {
      const field = page.locator(selector);
      await field.click();
      await field.fill("");
      await field.pressSequentially(text, { delay: 16 });
    }
    // القيمةُ في الحقل لا تكفي: الزرّ يقرأ حالة React، فإن بقي معطّلًا فالترطيب
    // لم يتمّ بعد وما كُتب لم يصل إلى الحالة.
    const ready = await page
      .waitForFunction(() => !document.querySelector('button[type="submit"]').disabled, { timeout: 8000 })
      .then(() => true, () => false);
    if (ready) break;
    if (attempt >= 4) throw new Error("زرّ الدخول بقي معطّلًا بعد أربع محاولات كتابة");
    await page.waitForTimeout(1500);
  }

  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}
