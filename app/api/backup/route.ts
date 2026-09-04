import { NextResponse } from "next/server";
import { CLINIC_TIME_ZONE, backupSqlLines, recordAudit } from "@/lib/db";
import { backupFileName } from "@/lib/backup";
import { clinicDateString } from "@/lib/schedule";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * تنزيل نسخة احتياطية كاملة — من داخل البرنامج.
 *
 * **للمدير وحده**: الملف يحمل كل مريض وكل مبلغ في العيادة، فهو أخطر ما يمكن أن يخرج
 * من النظام. ولا يُعطى لمن يلمس المال حتى — الاستقبال تقبض وتصرف بسند، ولا شأن لها
 * بنسخة تحمل الأرشيف كله.
 *
 * ويُبثّ سطرًا سطرًا لا يُبنى في الذاكرة أولًا: قاعدة تكبر بمرور الشهور تجعل بناءه
 * دفعةً واحدة يُسقط الخدمة عند أول نسخة كبيرة — وأسوأ وقت لسقوطها هو لحظة أخذ نسخة.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "النسخة الاحتياطية للمدير وحده." }, { status: 403 });
  }

  const now = new Date();
  const date = clinicDateString(now, CLINIC_TIME_ZONE);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);

  /*
   * يُسجَّل **قبل** البثّ لا بعده: الملف يحمل كل مريض وكل مبلغ في المركز، وهو أخطر
   * ما يخرج من النظام. ولو سُجّل بعد الاكتمال لما بقي أثرٌ لتنزيلٍ قُطع في منتصفه —
   * وقد خرج نصف الأرشيف فعلًا.
   */
  await recordAudit({
    action: "backup.download",
    details: { التاريخ: date, الوقت: time },
    actor: session.username, actorRole: session.role,
  });

  const encoder = new TextEncoder();
  const iterator = backupSqlLines();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          /*
           * وهنا وحده تُسجَّل **نسخةٌ اكتملت** — بعد آخر سطر، ولا قبله.
           *
           * فـ`backup.download` أعلاه لا يشهد بنسخة: يُكتب قبل أوّل بايت، ويكتبه
           * أيضًا أرشيفُ الأشعّة وحده. فمن بدأ نسخةً ثمّ ألغاها، أو نزّل الأشعّة
           * فقط، ترك ذلك الأثر نفسه — وقاعدةُ المرضى والمال لم تُنسخ.
           *
           * وما يشهد به هذا السطر بالضبط: أنّ الخادم أخرج الملفّ كاملًا وسحبه
           * المتصفّح إلى آخره. ولا يشهد أنّه حُفظ سليمًا على جهاز المالك — ذلك
           * لا يُثبته إلّا `npm run verify:backup` أو استعادةٌ فعلية.
           */
          await recordAudit({
            action: "backup.complete",
            entity: "database",
            entityLabel: "نسخة قاعدة البيانات",
            details: { التاريخ: date, الوقت: time },
            actor: session.username, actorRole: session.role,
          });
          controller.close();
        } else controller.enqueue(encoder.encode(next.value));
      } catch {
        // الملف الناقص أخطر من غيابه: من ينزّله يظنّه نسخة. فيُختم بسطر يُفشل
        // الاستعادة صراحةً — المعاملة تبقى مفتوحة بلا COMMIT ويقولها التعليق.
        controller.enqueue(encoder.encode(
          "\n-- !!! انقطعت النسخة قبل اكتمالها — هذا الملف ناقص ولا يصلح للاستعادة !!!\nROLLBACK;\n",
        ));
        controller.close();
      }
    },
    async cancel() { await iterator.return(undefined); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(date, time)}"`,
      "Cache-Control": "no-store",
    },
  });
}
