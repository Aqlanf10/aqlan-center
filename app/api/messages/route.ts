import { NextResponse } from "next/server";
import {
  broadcastMessages, directMessages, listUsers, markConversationRead,
  sendStaffMessage, staffConversations, unreadStaffMessages,
} from "@/lib/db";
import { putFile, storageStatus } from "@/lib/files";
import { parseTarget, validateOutgoing, voiceExtension } from "@/lib/messages";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

/**
 * الرسائل الداخلية — قراءةُ محادثةٍ أو قائمةِ المحادثات أو عدّادِ غير المقروء.
 *
 * ولا دورَ يُستثنى: المراسلة عملُ الطاقم كلّه، والاستقبال هي أكثر من يحتاجها.
 * وفتحُ المحادثة يعلّمها مقروءة في الطلب نفسه — طلبٌ ثانٍ لذلك يعني عدّادًا يبقى
 * مضاءً إن انقطعت الشبكة بين الاثنين.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return denied();
  const url = new URL(request.url);

  try {
    if (url.searchParams.get("unread") === "1") {
      return NextResponse.json({ unread: await unreadStaffMessages(session.userId) });
    }

    if (url.searchParams.get("conversations") === "1") {
      return NextResponse.json({
        conversations: await staffConversations(session.userId),
        meId: session.userId,
      });
    }

    if (url.searchParams.get("broadcast") === "1") {
      const messages = await broadcastMessages();
      await markConversationRead(session.userId, { broadcast: true });
      return NextResponse.json({ messages, meId: session.userId });
    }

    const withUser = Number(url.searchParams.get("withUser"));
    if (Number.isInteger(withUser) && withUser > 0) {
      const messages = await directMessages(session.userId, withUser);
      await markConversationRead(session.userId, { withUserId: withUser });
      return NextResponse.json({ messages, meId: session.userId });
    }

    return NextResponse.json({ message: "حدّد المحادثة المطلوبة." }, { status: 400 });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل المحادثة." }, { status: 500 });
  }
}

/**
 * إرسال رسالة — إلى زميل أو إلى الفريق كلّه.
 *
 * والتسجيل يُكتب على القرص أوّلًا ثم يُسجَّل وصفُه: صفٌّ يشير إلى ملفٍّ لا يوجد
 * رسالةٌ تُفتح فلا يُسمع منها شيء، وقد انتظر أحدٌ جوابها.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) return denied();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  const target = parseTarget(source.to);
  if (!target) {
    return NextResponse.json({ message: "جهة الرسالة غير صالحة." }, { status: 400 });
  }
  if (target.kind === "user" && target.userId === session.userId) {
    return NextResponse.json({ message: "لا تُرسل رسالةً إلى نفسك." }, { status: 400 });
  }

  const verdict = validateOutgoing(source);
  if (!verdict.ok) {
    return NextResponse.json({ message: verdict.message }, { status: 400 });
  }
  const message = verdict.value;

  try {
    // الجهة تُتحقَّق قبل الكتابة: رسالةٌ إلى حسابٍ مُعطَّل تصل إلى صندوقٍ مهجور.
    if (target.kind === "user") {
      const recipient = (await listUsers()).find((user) => user.id === target.userId);
      if (!recipient || !recipient.isActive) {
        return NextResponse.json({ message: "الزميل غير موجود أو حسابه مُعطَّل." }, { status: 404 });
      }
    }

    let voiceKey: string | null = null;
    if (message.kind === "voice") {
      const storage = await storageStatus();
      if (!storage.ready) {
        // ٥٠٣ لا ٥٠٠: العطل في التهيئة لا في الطلب، والرسالة تقول ما يُضبط.
        return NextResponse.json({ message: storage.message }, { status: 503 });
      }
      const bytes = Buffer.from(message.voiceData ?? "", "base64");
      const stored = await putFile(bytes, voiceExtension(message.voiceMime ?? ""));
      voiceKey = stored.key;
    }

    const saved = await sendStaffMessage({
      senderId: session.userId,
      recipientId: target.kind === "user" ? target.userId : null,
      kind: message.kind,
      body: message.body,
      voiceKey,
      voiceMime: message.voiceMime,
      voiceMs: message.voiceMs,
      voiceBytes: message.voiceBytes,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch {
    return NextResponse.json({ message: "تعذّر إرسال الرسالة. أعد المحاولة." }, { status: 500 });
  }
}
