#!/usr/bin/env node
import "./load-env.mjs";

/**
 * ملء أبعاد الصور المرفوعة قبل أن تُحفظ الأبعاد.
 *
 * ### لماذا هذا لازم
 *
 * معالم التتبّع كسورٌ من العرض والارتفاع، فنسبةُ الصورة تدخل حساب الزاوية. وكانت
 * غائبةً عن الخادم، فتقرير الطباعة يحسب على نسبة ١: على أشعّةٍ ٤:٥ تُقاس FMA
 * ‏٣٦٫٠° على الشاشة و‏٢٩٫٤° على الورقة — وستّ درجاتٍ ونصف هي الفرق بين نمطٍ
 * عمودي مرتفع ونمطٍ سويّ.
 *
 * والصور المرفوعة سابقًا موجودةٌ على القرص كما هي، فتُقرأ ترويستها وتُحفظ
 * أبعادها. **ولا يُكتب فوق قيمةٍ موجودة**، ولا يُمسّ التتبّع نفسه: هذا يصحّح
 * حسابًا، لا يغيّر نقطةً وضعها طبيب.
 *
 *   القراءة فقط:  node scripts/backfill-image-size.mjs
 *   والكتابة:     node scripts/backfill-image-size.mjs --write
 */

const write = process.argv.includes("--write");
const db = await import("../lib/db.ts");
const files = await import("../lib/files.ts");
const { imageSize } = await import("../lib/imageSize.ts");

await db.ensureSchema();

const { rows } = await db.getPool().query(
  `SELECT id, title, mime_type, storage_key
     FROM patient_documents
    WHERE mime_type LIKE 'image/%'
      AND (image_width IS NULL OR image_height IS NULL)
    ORDER BY id`,
);

console.log(`صورٌ بلا أبعاد: ${rows.length}`);
let filled = 0;
let unreadable = 0;
let missing = 0;
let square = 0;

for (const row of rows) {
  const bytes = await files.readFileByKey(row.storage_key);
  if (!bytes) { missing += 1; console.log(`  ✗ ${row.id} — الملف غير موجود على القرص`); continue; }
  const size = imageSize(bytes);
  if (!size) { unreadable += 1; console.log(`  ✗ ${row.id} — تعذّرت قراءة الترويسة (${row.mime_type})`); continue; }
  const aspect = size.width / size.height;
  if (Math.abs(aspect - 1) < 0.001) square += 1;
  console.log(`  ${write ? "✓" : "·"} ${row.id} — ${size.width}×${size.height} (نسبة ${aspect.toFixed(3)})`);
  if (write) {
    await db.backfillDocumentSize({ id: row.id, width: size.width, height: size.height });
    filled += 1;
  }
}

console.log(
  `\n${write ? `مُلئت ${filled}` : `ستُملأ ${rows.length - unreadable - missing}`}`
  + ` · مربّعةٌ منها ${square} (لا يتغيّر حسابها)`
  + ` · تعذّرت قراءتها ${unreadable} · مفقودةٌ من القرص ${missing}`,
);
if (!write) console.log("لم يُكتب شيء — أعد التشغيل بـ--write للحفظ.");

await db.getPool().end();
