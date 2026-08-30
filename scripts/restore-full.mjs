import "./load-env.mjs";
import { createHash } from "node:crypto";
import { readFile, realpath, mkdir, readdir } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { ensureSchema, getPool } from "../lib/db.ts";
import { putFile } from "../lib/files.ts";
import { isSafeKey } from "../lib/storage.ts";

// Input is the directory extracted from our full archive. No arbitrary paths or
// symlinks from the manifest are followed, and a populated target is never erased.
const input = process.argv[2];
if (!input || !process.env.DOCUMENTS_DIR) {
  console.error("الاستعمال: DOCUMENTS_DIR=... DATABASE_URL=... npm run restore:full -- مجلد-النسخة-المفكوكة");
  process.exit(1);
}
const base = await realpath(resolve(input));
const safeRead = async relative => {
  const path = await realpath(join(base, relative));
  if (!path.startsWith(base + sep)) throw new Error("مسار خارج مجلد النسخة");
  return readFile(path);
};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  const manifest = JSON.parse((await safeRead("manifest.json")).toString("utf8"));
  if (manifest.format !== "aqlan-full-backup" || manifest.version !== 1 || !Array.isArray(manifest.documents)) throw new Error("فهرس النسخة غير صالح");
  const sql = await safeRead("database.sql");
  if (digest(sql) !== manifest.databaseSha256 || !sql.toString().trimEnd().endsWith("-- AQLAN_BACKUP_COMPLETE")) throw new Error("نسخة قاعدة البيانات ناقصة أو تالفة");
  // Validate every file before touching the destination.
  for (const doc of manifest.documents) {
    if (!isSafeKey(doc.storage_key)) throw new Error("مفتاح تخزين غير صالح");
    const bytes = await safeRead(`documents/${doc.storage_key}`);
    if (bytes.length !== Number(doc.size_bytes) || digest(bytes) !== doc.sha256) throw new Error(`ملف ناقص أو تالف: ${doc.id}`);
  }
  await ensureSchema();
  const pool = getPool();
  const { rows: tables } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const { tablename } of tables) {
    const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM "${tablename.replace(/"/g, '""')}") AS populated`);
    if (rows[0].populated) throw new Error("قاعدة الهدف ليست فارغة. الاستعادة لا تمحو بيانات قائمة.");
  }
  const destination = resolve(process.env.DOCUMENTS_DIR);
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).some(name => name !== ".write-probe")) throw new Error("مجلد تخزين الهدف ليس فارغًا");
  for (const doc of manifest.documents) {
    const bytes = await safeRead(`documents/${doc.storage_key}`);
    const stored = await putFile(bytes, doc.storage_key.split('.').at(-1));
    if (stored.key !== doc.storage_key) throw new Error("مفتاح الملف لا يطابق بصمته");
  }
  // Files first; SQL is transactional. A failure leaves no records pointing at absent files.
  await pool.query(sql.toString("utf8"));
  console.log(`تمت استعادة البيانات و${manifest.documents.length} سجل مستند، بما فيها المخفية. أعد تشغيل التطبيق بسر جلسات جديد.`);
} catch (error) {
  console.error(`فشلت الاستعادة: ${error.message}`);
  process.exitCode = 1;
} finally { await getPool().end(); }
