import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLINIC_ZONE_FALLBACK } from "../lib/clinicZone";

/*
 * منطقةُ توقيت العيادة — **مصدرٌ واحد، ويبقى واحدًا**.
 *
 * كانت مكتوبةً حرفيًّا في اثنتين وعشرين شاشة بينما يقرؤها الخادم من البيئة. فنشرٌ
 * يضبط `CLINIC_TIME_ZONE` على منطقةٍ أخرى يجعل الخادم يحسب يومًا والشاشات يومًا
 * آخر — عند منتصف الليل، وبلا رسالة خطأ.
 *
 * وهذا الحارس **عن المستقبل**: من يكتب الثابت في شاشةٍ جديدة يُعيد الانحراف،
 * ولا شيء آخر يكشفه — فالشاشة تعمل تمامًا ما دام النشر على توقيت عدن.
 */
const ROOTS = ["app", "components", "lib", "scripts"];
const SOURCE = /\.(ts|tsx|mjs)$/;
/**
 * المواضع المسموح فيها بالنصّ.
 *
 * - `lib/clinicZone.ts`: تعريفُ الاحتياط نفسه.
 * - `scripts/backup.mjs`: يُشغَّل بـ`node` مجرَّدًا (`npm run backup`) فلا يستطيع
 *   استيراد وحدةِ TypeScript — بخلاف بقيّة السكربتات التي تعمل بـ`tsx` فتستورده.
 *   **ولا ينحرف**: يقرأ `CLINIC_TIME_ZONE` نفسها، والنصُّ فيه احتياطُها.
 */
const ALLOWED = new Set([join("lib", "clinicZone.ts"), join("scripts", "backup.mjs")]);

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (SOURCE.test(entry)) found.push(path);
  }
  return found;
}

describe("توقيت العيادة", () => {
  it("لا يُكتب النصُّ حرفيًّا خارج تعريف الاحتياط — بأيّ علامة اقتباس", () => {
    const offenders = ROOTS
      .flatMap((root) => sources(root))
      .filter((path) => !ALLOWED.has(path))
      /*
       * **وبأيّ علامة اقتباس.**
       *
       * كان الفحص يبحث عن المزدوجة وحدها، فمرّ `'Asia/Aden'` في
       * `scripts/verify-executive.mjs` وهو داخل جذرٍ ممسوح — حارسٌ يُطمئن
       * ولا يحرس، وهو أسوأ من لا حارس.
       */
      .filter((path) => new RegExp(`['"\`]${CLINIC_ZONE_FALLBACK}['"\`]`)
        .test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  /*
   * والاحتياطُ منطقةٌ يعرفها المُشغّل.
   *
   * فنصٌّ لا تعرفه `Intl` يجعل كل تاريخٍ في البرنامج يُرمى باستثناء — والشاشة
   * تبيضّ بلا سبب ظاهر.
   */
  it("والاحتياطُ منطقةٌ صالحة يقبلها المُشغّل", () => {
    expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_ZONE_FALLBACK }))
      .not.toThrow();
  });
});
