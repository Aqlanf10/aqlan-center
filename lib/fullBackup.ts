import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { ensureSchema, getPool, snapshotSqlLines } from "./db";
import { readFileByKey } from "./files";
import { tarEnd, tarHeader, tarPadding } from "./tar";

export interface BackupDocument {
  id: number; storage_key: string; sha256: string; size_bytes: string | number;
  title: string; patient_id: number; removed_at: Date | null;
}

/** SQL and the list of all documents (including hidden records) share one snapshot.
 * Files are immutable and written atomically before their database records exist. */
export async function* fullBackupBlocks(): AsyncGenerator<Uint8Array> {
  await ensureSchema();
  const base = resolve(tmpdir());
  const stage = await mkdtemp(join(base, "aqlan-backup-"));
  try {
    const sqlPath = join(stage, "database.sql");
    const sqlFile = await open(sqlPath, "wx", 0o600);
    const hash = createHash("sha256");
    const client = await getPool().connect();
    let documents: BackupDocument[];
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      documents = (await client.query<BackupDocument>(
        "SELECT id, storage_key, sha256, size_bytes, title, patient_id, removed_at FROM patient_documents ORDER BY id",
      )).rows;
      for await (const line of snapshotSqlLines(client)) {
        hash.update(line);
        await sqlFile.writeFile(line);
      }
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await sqlFile.close();
    }
    const now = new Date();
    const sqlSize = (await stat(sqlPath)).size;
    yield tarHeader("database.sql", sqlSize, now);
    for await (const chunk of createReadStream(sqlPath)) yield chunk;
    yield tarPadding(sqlSize);
    const included = new Set<string>();
    for (const document of documents) {
      if (included.has(document.storage_key)) continue;
      const bytes = await readFileByKey(document.storage_key);
      if (!bytes || bytes.length !== Number(document.size_bytes)
          || createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
        throw new Error(`Backup document missing or corrupt: ${document.id}`);
      }
      yield tarHeader(`documents/${document.storage_key}`, bytes.length, now);
      yield bytes;
      yield tarPadding(bytes.length);
      included.add(document.storage_key);
    }
    // Written last: a partial stream cannot masquerade as a complete backup.
    const manifest = Buffer.from(JSON.stringify({
      format: "aqlan-full-backup", version: 1, createdAt: now.toISOString(),
      databaseSha256: hash.digest("hex"), documents,
    }, null, 2), "utf8");
    yield tarHeader("manifest.json", manifest.length, now);
    yield manifest;
    yield tarPadding(manifest.length);
    yield tarEnd();
  } finally {
    if (!resolve(stage).startsWith(base + sep)) throw new Error("Unsafe backup temporary path");
    await rm(stage, { recursive: true, force: true });
  }
}
