import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * تسجيل الدخول من الشاشة — بانتظارٍ للترطيب لا بتقديرٍ للوقت.
 *
 * كان في كل رحلةٍ نسخةٌ من هذه الأسطر تنتظر ثانيتين ونصفًا ثم تكتب. والانتظار
 * بالوقت رهانٌ: إن تأخّر ترطيب React ذهبت الحروف إلى حقلٍ لا يسمعها، فيبقى الزرّ
 * معطّلًا وتسقط الرحلة بخطأٍ يشير إلى الزرّ والعلّة في الكتابة. فصار الانتظار
 * على الأثر لا على الساعة: نكتب، فإن لم تُسجَّل القيمة أعدنا الكتابة.
 *
 * **والجلسة تُعاد ولا تُستأنف من الصفر في كل رحلة.** حدّ محاولات الدخول حارسٌ
 * حقيقي يجب أن يبقى، لكن ستّ رحلاتٍ متتابعة تستنفده — فتسقط السابعة بـ429 برسالةٍ
 * لا علاقة لها بما تفحصه، ويُقرأ السقوط عيبًا في البرنامج. وقد أُهدر على هذا وقتٌ
 * مرّتين. فتُحفظ كعكة الجلسة خارج المشروع وتُعاد ما دامت تعمل.
 *
 * **والجلسة المحفوظة تخصّ صاحبها وحده، ويُتحقَّق من ذلك على الشاشة.** أوّل صيغةٍ
 * لهذا الملف حفظت جلسةً واحدة للجميع، فدخلت رحلةُ السيفالو بحساب «الاستقبال»
 * وهي تحمل كعكة المدير — فقرأت الاستقبالُ تتبُّعًا ممنوعًا عليها وردّ الخادم 200.
 * والفحص هناك فحصُ صلاحيات، فكاد يُقرأ «الحارس مكسور» وهو سليم؛ ولو انعكس الأمر
 * لقال «الحارس سليم» وهو مكسور. فصار لكل مستخدمٍ ملفّه، ولا تُقبل جلسةٌ حتى تُظهر
 * الشاشة اسم صاحبها.
 */

const stateFor = (user) =>
  process.env.JOURNEY_STATE ?? join(tmpdir(), `aqlan-journey-${encodeURIComponent(user)}.json`);

export async function login(page, { base, user, pass }) {
  if (await reuseSession(page, base, user)) return;

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
  const entered = await page
    .waitForURL((url) => !url.pathname.includes("login"), { timeout: 20000 })
    .then(() => true, () => false);
  if (!entered) {
    // الشاشة تحمل السبب مكتوبًا — و«انتهت المهلة» وحدها تُرسل من يقرأها يفتّش في
    // الشيفرة عن علّةٍ ليست فيها.
    const said = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`لم يتمّ الدخول — ما على الشاشة: ${said}`);
  }
  await page.waitForLoadState("networkidle");
  await page.context().storageState({ path: stateFor(user) });
}

/** جلسةٌ محفوظة لهذا المستخدم — تُقبل إن فتحت اللوحة **باسمه هو**. */
async function reuseSession(page, base, user) {
  let cookies;
  try {
    cookies = JSON.parse(await readFile(stateFor(user), "utf8")).cookies;
  } catch {
    return false;
  }
  if (!Array.isArray(cookies) || cookies.length === 0) return false;

  try {
    await page.context().addCookies(cookies);
    await page.goto(base + "/", { waitUntil: "networkidle" });
    // الحكم على ما وصلنا إليه لا على وجود الكعكة: كعكةٌ منتهية تصل إلى /login.
    if (new URL(page.url()).pathname.includes("login")) return false;
    // والاسم على الشاشة هو الحكم الأخير: جلسةٌ تفتح اللوحة لغير صاحبها أسوأ من
    // لا جلسة — تجعل رحلةً تفحص صلاحيات مستخدمٍ وهي تحمل صلاحيات آخر.
    return await page.getByText(user, { exact: true }).first()
      .waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
  } catch {
    return false;
  }
}
