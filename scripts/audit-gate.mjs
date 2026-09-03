#!/usr/bin/env node
/**
 * منفّذ بوّابة الثغرات — يسأل سجلّ npm، والحكم في `lib/auditGate.ts`.
 *
 * يُعاد السؤال ثلاث مرات بتباعد: عطلٌ عابر في السجلّ لا يوقف الدمج. وإن عجز
 * في الثلاث سقط الفحص برمز ٢ ورسالةٍ تقول «لم يُفحص» لا «سليم» — فبوّابةٌ
 * تُفتح عند عجزها ليست بوّابة. والثغرات تُسمّى في السجل فلا يبحث عنها أحد.
 *
 *   الاستعمال: npm run audit:gate
 */
import { spawn } from "node:child_process";
import { BLOCKING, readAudit, verdict } from "../lib/auditGate.ts";

const ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000];

function runAudit() {
  return new Promise((resolve) => {
    const child = spawn("npm", ["audit", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", () => {});
    child.on("error", (error) => resolve(`{"message":${JSON.stringify(error.message)}}`));
    child.on("close", () => resolve(out));
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const reads = [];
for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
  const read = readAudit(await runAudit());
  reads.push(read);
  if (read.kind === "report") break;
  console.error(`المحاولة ${attempt + 1} من ${ATTEMPTS}: لم يجب سجلّ npm — ${read.why}`);
  if (attempt < ATTEMPTS - 1) await wait(BACKOFF_MS[attempt] ?? 15000);
}

const last = reads[reads.length - 1];
if (last?.kind === "report") {
  const c = last.counts;
  console.log(
    `فُحصت الاعتماديات: حرجة ${c.critical ?? 0}، خطيرة ${c.high ?? 0}، ` +
    `متوسطة ${c.moderate ?? 0}، منخفضة ${c.low ?? 0}.`,
  );
  for (const [name, info] of Object.entries(last.advisories)) {
    if (BLOCKING.includes(info?.severity)) {
      console.error(`  ثغرة ${info.severity}: ${name} — ${info?.via?.[0]?.title ?? "بلا عنوان"}`);
    }
  }
}

const decision = verdict(reads);
console[decision.pass ? "log" : "error"](decision.reason);
process.exit(decision.code);
