import "./load-env.mjs";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { resolve } from "node:path";
import { fullBackupBlocks } from "../lib/fullBackup.ts";
import { getPool } from "../lib/db.ts";

const file = resolve(process.argv[2] ?? `aqlan-full-${Date.now()}.tar.gz`);
const temporary = `${file}.partial-${process.pid}`;
try {
  await pipeline(Readable.from(fullBackupBlocks()), createGzip(), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
  // Do not overwrite an existing backup.
  const { link } = await import("node:fs/promises");
  await link(temporary, file);
  await unlink(temporary);
  console.log(`نسخة كاملة جاهزة: ${file}`);
} catch (error) {
  console.error(`فشل النسخ: ${error.message}`);
  process.exitCode = 1;
} finally {
  await unlink(temporary).catch(() => {});
  await getPool().end();
}
