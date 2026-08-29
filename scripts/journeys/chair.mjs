/**
 * التعامل مع لوحة اليوم لمريضٍ **بعينه**.
 *
 * كانت الرحلات تنقر `.first()` على أزرار اللوحة: أوّل زرّ نداء، وأوّل رابط «وثّق
 * وأغلق». وهذا يصحّ ما دامت اللوحة فارغة إلا من مريض الرحلة — وهو ما لا يدوم:
 *
 *   ـ «أوّل صفّ» في الانتظار هو الأطول انتظارًا لا مريضَنا، فتُنادي الرحلة على غيره.
 *   ـ و«أوّل كرسي» قد يكون مشغولًا، فيبقى الزرّ معطّلًا ثلاثين ثانية ثم تسقط.
 *   ـ وأوّل «وثّق وأغلق» يفتح زيارة الكرسي الأول، فتقرأ الرحلة شاشة مريضٍ آخر —
 *     وهذا أسوأ الثلاثة: لا تسقط، بل تقول إن ميزةً سليمة غائبة.
 *
 * فصار كل نقرٍ مقيَّدًا ببطاقة المريض نفسه، وبأيّ كرسيٍّ يقبل النقر.
 */
const WAITING = 'section[aria-label="قائمة الانتظار"]';
const CALLED = 'section[aria-label="نُودي عليهم"]';
const CHAIRS = 'section[aria-label="الكراسي"]';

/** نداء المريض إلى أوّل كرسيٍّ شاغر، ثم إجلاسه عليه. */
export async function callAndSeat(page, name) {
  const row = page.locator(`${WAITING} li`).filter({ hasText: name });
  await row.waitFor({ state: "visible", timeout: 20000 });

  const chairs = row.getByRole("button", { name: /نادِ · كرسي/ });
  const count = await chairs.count();
  let called = false;
  for (let index = 0; index < count; index += 1) {
    if (await chairs.nth(index).isDisabled()) continue;
    await chairs.nth(index).click();
    called = true;
    break;
  }
  if (!called) throw new Error(`لا كرسيَّ شاغرًا لنداء «${name}» — كل الكراسي مشغولة`);

  await page.locator(`${CALLED} li`).filter({ hasText: name })
    .getByRole("button", { name: "دخل الكرسي" })
    .click({ timeout: 20000 });
  await page.waitForTimeout(1500);
}

/** فتح شاشة التوثيق السريري لمريضٍ جالسٍ على كرسيّه. */
export async function openChart(page, name) {
  await page.locator(`${CHAIRS} > div > div`).filter({ hasText: name })
    .getByRole("link", { name: "وثّق وأغلق" })
    .click({ timeout: 20000 });
  await page.waitForURL(/\/visits\/\d+/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
}

/**
 * إخلاء الكرسي في نهاية الرحلة.
 *
 * الرحلة التي توقّع تُخلي كرسيها بالتوقيع؛ وما لا يوقّع يترك مريضًا جالسًا إلى
 * الأبد — وكرسيان فقط في المركز، فتشغيلان يملآن اللوحة ولا تعمل رحلةٌ بعدهما.
 * والرحلة التي لا تنظّف أثرها تعمل مرّةً وتُقرأ نتيجتها مرّتين.
 */
export async function releaseChair(page, name, base) {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const card = page.locator(`${CHAIRS} > div > div`).filter({ hasText: name });
  if (await card.count() === 0) return;
  await card.getByRole("button", { name: "انتهى" }).click({ timeout: 20000 });
  await page.waitForTimeout(1500);
}
