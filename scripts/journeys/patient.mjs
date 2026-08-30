/**
 * إنشاء مريضٍ من الشاشة — بما في ذلك تجاوز تحذير التكرار.
 *
 * الرحلات تُعاد مرارًا، والأسماء تتشابه («مريض الخطة ١٢٣٤٥» و«مريض الخطة ٦٧٨٩٠»)،
 * فيعترض كشفُ التكرار — وهو يعمل كما ينبغي. فالرحلة تتعامل معه كما تتعامل معه
 * الاستقبال: تنظر في المرشّحين ثم تقرّر. وسكوتُ الرحلة عنه كان سيجعل ميزةً سليمة
 * تبدو عطلًا.
 */
export async function createPatient(page, { name, phone, base, gender }) {
  const type = async (locator, text) => {
    await locator.click();
    await locator.pressSequentially(text, { delay: 16 });
  };

  await page.goto(base + "/patients", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "+ مريض جديد" }).click();
  await page.waitForTimeout(1200);
  await type(page.getByLabel("الاسم الكامل"), name);
  if (phone) await type(page.getByLabel("رقم الجوال"), phone);
  // الجنس يدخل اختيار المعيار السيفالومتري — فمن احتاجه في رحلته يمرّره.
  if (gender) {
    await page.getByRole("button", { name: gender, exact: true }).click();
    await page.waitForTimeout(400);
  }

  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")]
      .find((b) => b.textContent.includes("احفظ وافتح الملف"));
    return button && !button.disabled;
  });
  await page.getByRole("button", { name: /احفظ وافتح الملف/ }).click();
  await page.waitForTimeout(2500);

  const anyway = page.getByRole("button", { name: /ليس أحدهم/ });
  if (await anyway.count() > 0) {
    await anyway.click();
    await page.waitForTimeout(2000);
  }

  await page.waitForURL(/\/patients\/\d+/, { timeout: 25000 });
  await page.waitForTimeout(2500);
  return page.url();
}
