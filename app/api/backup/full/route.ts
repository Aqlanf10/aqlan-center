import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { NextResponse } from "next/server";
import { fullBackupBlocks } from "@/lib/fullBackup";
import { requireSession } from "@/lib/session";
import { isAdmin } from "@/lib/roles";
import { recordAudit } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ message: "سجّل الدخول من جديد." }, { status: 401 });
  if (!isAdmin(session.role)) return NextResponse.json({ message: "النسخ للمدير وحده." }, { status: 403 });
  await recordAudit({ action: "backup.download", entityLabel: "نسخة البيانات والأشعة الكاملة",
    actor: session.username, actorRole: session.role });
  const source = Readable.from(fullBackupBlocks());
  const gzip = createGzip();
  source.on("error", error => gzip.destroy(error));
  gzip.on("close", () => source.destroy());
  const abort = () => { source.destroy(); gzip.destroy(); };
  request.signal.addEventListener("abort", abort, { once: true });
  gzip.on("close", () => request.signal.removeEventListener("abort", abort));
  return new Response(Readable.toWeb(source.pipe(gzip)) as ReadableStream, { headers: {
    "Content-Type": "application/gzip", "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="aqlan-full-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz"`,
  } });
}
