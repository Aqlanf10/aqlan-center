#!/usr/bin/env node
import { pgConnection } from "../lib/pgConnection.ts";
import "./load-env.mjs";
import { Client } from "pg";
import { hashPassword } from "../lib/auth.ts";

/**
 * هل المراسلة الداخلية سجلٌّ يُعتمد عليه؟
 *
 * والأسئلة التي تقرّر ذلك كلّها عن حال القاعدة، فلا يجيب عنها اختبار وحدة:
 *
 * ١) هل ترى ثالثةٌ محادثةَ اثنين؟ هذا هو الخطر كلّه: يُكتب في الرسائل ما لا
 *    يُقال بصوتٍ عالٍ، فتسريبُ خيطٍ بين اثنين أسوأ من ألّا تكون الميزة أصلًا.
 * ٢) هل «غير المقروء» يوافق ما لم يُقرأ فعلًا؟ عدّادٌ يبقى مضاءً بعد القراءة
 *    يُتعلَّم أنه لا يُصدَّق، ثم لا يُصدَّق حين يصدق.
 * ٣) ورسالةُ الفريق: هل قراءةُ واحدٍ لها تُطفئها عن البقيّة؟ صفٌّ واحد يراه
 *    الجميع، فحالة القراءة يجب أن تكون لكلٍّ على حدة.
 * ٤) وهل يُسمع تسجيلٌ برقمٍ مُبدَّل؟ الرابط رقمٌ متسلسل، والحارس في الاستعلام
 *    لا في الشاشة.
 */

const source = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!source.trim()) { console.error("خطأ: SOURCE_DATABASE_URL غير مضبوط."); process.exit(1); }

const withDatabase = (url, name) => {
  const parsed = new URL(url); parsed.pathname = `/${name}`; return parsed.toString();
};

const temporary = `messages_check_${Date.now()}`;
process.env.DATABASE_URL = withDatabase(source, temporary);
const admin = new Client(pgConnection(source));
let failed = false;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${temporary}`);
  const db = await import("../lib/db.ts");
  await db.ensureSchema();

  const passwordHash = await hashPassword("messages-check-password-2026");
  const laila = await db.createFirstAdmin({
    username: "laila", displayName: "ليلى الاستقبال", passwordHash,
  });
  const doctor = await db.createStaffUser({
    username: "aqlan", displayName: "د. عقلان", passwordHash, role: "doctor",
  });
  const nurse = await db.createStaffUser({
    username: "huda", displayName: "هدى المساعِدة", passwordHash, role: "reception",
  });

  console.log("\n  ── ما يُقال بين اثنين يبقى بينهما ──");

  await db.sendStaffMessage({
    senderId: laila.id, recipientId: doctor.id, kind: "text",
    body: "الطبيب مطلوب على الكرسي الثاني.",
    voiceKey: null, voiceMime: null, voiceMs: null, voiceBytes: null,
  });
  await db.sendStaffMessage({
    senderId: doctor.id, recipientId: laila.id, kind: "text",
    body: "بعد خمس دقائق.",
    voiceKey: null, voiceMime: null, voiceMs: null, voiceBytes: null,
  });

  const pair = await db.directMessages(laila.id, doctor.id);
  check("المحادثة تُقرأ بالاتجاهين", pair.length === 2, `${pair.length} رسالة`);
  check("ومرتّبةٌ من الأقدم إلى الأحدث — كما تُقرأ لا كما تُستعلم",
    pair[0].body.startsWith("الطبيب") && pair[1].body.startsWith("بعد"));

  const outsider = await db.directMessages(nurse.id, doctor.id);
  check("وثالثةٌ لا ترى منها شيئًا", outsider.length === 0, `${outsider.length}`);

  // ورسالةٌ إلى زميلٍ ثالث لا تظهر في محادثتي مع الأول.
  await db.sendStaffMessage({
    senderId: laila.id, recipientId: nurse.id, kind: "text",
    body: "احضري عبوة قفازات.",
    voiceKey: null, voiceMime: null, voiceMs: null, voiceBytes: null,
  });
  const stillTwo = await db.directMessages(laila.id, doctor.id);
  check("ورسائلي إلى زميلٍ آخر لا تتسرّب إلى هذه المحادثة", stillTwo.length === 2, `${stillTwo.length}`);

  console.log("\n  ── العدّاد يوافق ما لم يُقرأ فعلًا ──");

  check("الطبيب عنده واحدة لم تُقرأ", (await db.unreadStaffMessages(doctor.id)) === 1);
  check("والمساعِدة عندها واحدة", (await db.unreadStaffMessages(nurse.id)) === 1);
  check("وليلى عندها واحدة — جواب الطبيب", (await db.unreadStaffMessages(laila.id)) === 1);

  await db.markConversationRead(doctor.id, { withUserId: laila.id });
  check("وبعد أن فتح الطبيب المحادثة صار صفرًا",
    (await db.unreadStaffMessages(doctor.id)) === 0);
  check("ولم يمسّ ذلك عدّاد المساعِدة", (await db.unreadStaffMessages(nurse.id)) === 1);

  // إعادة الفتح لا تُنشئ صفوفًا جديدة ولا تُزيح وقت القراءة الأولى.
  const again = await db.markConversationRead(doctor.id, { withUserId: laila.id });
  check("وإعادة الفتح لا تُسجّل قراءةً ثانية", again === 0, `${again} صفًّا`);

  console.log("\n  ── رسالة الفريق: صفٌّ واحد وقراءةٌ لكلٍّ على حدة ──");

  await db.sendStaffMessage({
    senderId: laila.id, recipientId: null, kind: "text",
    body: "الكهرباء تنقطع الثالثة اليوم.",
    voiceKey: null, voiceMime: null, voiceMs: null, voiceBytes: null,
  });
  const team = await db.broadcastMessages();
  check("الجميع يراها من صفٍّ واحد", team.length === 1);
  const teamRows = await db.getPool().query(
    `SELECT COUNT(*)::int AS n FROM staff_messages WHERE recipient_id IS NULL`);
  check("ولا نسخة لكل زميل — صفٌّ واحد لا خمسة", teamRows.rows[0].n === 1, `${teamRows.rows[0].n} صفًّا`);

  check("وهي غير مقروءة عند الطبيب", (await db.unreadStaffMessages(doctor.id)) === 1);
  check("وعند المساعِدة", (await db.unreadStaffMessages(nurse.id)) === 2);
  check("ولا تُعدّ على مُرسِلتها", (await db.unreadStaffMessages(laila.id)) === 1);

  await db.markConversationRead(doctor.id, { broadcast: true });
  check("قراءةُ الطبيب لها تُطفئها عنه", (await db.unreadStaffMessages(doctor.id)) === 0);
  check("ولا تُطفئها عن المساعِدة — والعدّاد لو كان عمودًا واحدًا لأطفأها",
    (await db.unreadStaffMessages(nurse.id)) === 2);

  console.log("\n  ── قائمة المحادثات ──");

  const list = await db.staffConversations(laila.id);
  check("فيها كل زميلٍ نشط ومعهم صندوق الفريق", list.length === 3, `${list.length}`);
  check("ومحادثةٌ لم تبدأ بعد تظهر أيضًا — وإلا لما وُجد زرّ أوّل رسالة",
    list.every((row) => row.displayName));
  const withDoctor = list.find((row) => row.userId === doctor.id);
  check("وآخر رسالةٍ في كل صفّ", withDoctor.lastBody === "بعد خمس دقائق.", withDoctor.lastBody ?? "");
  const teamRow = list.find((row) => row.userId === null);
  check("وصندوق الفريق يحمل آخر ما فيه",
    teamRow.lastBody === "الكهرباء تنقطع الثالثة اليوم.");

  console.log("\n  ── التسجيل لا يُسمع لغير أهله ──");

  const voice = await db.sendStaffMessage({
    senderId: doctor.id, recipientId: laila.id, kind: "voice", body: null,
    voiceKey: "ab/cd/" + "a".repeat(64) + ".weba",
    voiceMime: "audio/webm", voiceMs: 6200, voiceBytes: 40_000,
  });
  check("مُرسِلُه يصل إليه", Boolean(await db.staffMessageVoice(voice.id, doctor.id)));
  check("ومُستقبِلُه", Boolean(await db.staffMessageVoice(voice.id, laila.id)));
  check("وثالثةٌ لا — والرابط رقمٌ متسلسل يُبدَّل بسهولة",
    (await db.staffMessageVoice(voice.id, nurse.id)) === null);

  const teamVoice = await db.sendStaffMessage({
    senderId: laila.id, recipientId: null, kind: "voice", body: null,
    voiceKey: "ef/01/" + "b".repeat(64) + ".weba",
    voiceMime: "audio/webm", voiceMs: 3000, voiceBytes: 12_000,
  });
  check("وتسجيلُ الفريق يصل إلى الجميع",
    Boolean(await db.staffMessageVoice(teamVoice.id, nurse.id)));

  check("ورقمٌ لا وجود له يردّ لا شيء",
    (await db.staffMessageVoice(999_999, laila.id)) === null);

  // القاعدة لا تحمل جسم الصوت — المحظور الثامن.
  // من مجمّع التطبيق لا من `admin`: الأخير موصولٌ بالقاعدة المصدر لا بالمؤقّتة،
  // فسؤاله عن أعمدة جدولٍ لا يراه يردّ لا شيء — وفحصٌ يمرّ بلا صفوفٍ ليس فحصًا.
  const columns = await db.getPool().query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'staff_messages'`,
  );
  const names = columns.rows.map((row) => row.column_name);
  check("والجدول موجودٌ فعلًا — وإلّا لمرّ الفحص التالي بلا شيء يفحصه",
    names.length > 0, `${names.length} عمودًا`);
  check("ولا عمودَ يحمل جسم التسجيل — المفتاح والمدّة والحجم وحدها",
    names.includes("voice_key") && !names.some((name) => /voice_data|body_data|blob|payload/.test(name)),
    names.filter((name) => name.startsWith("voice_")).join("، "));
  const types = await db.getPool().query(
    `SELECT data_type FROM information_schema.columns WHERE table_name = 'staff_messages'`);
  check("ولا نوع bytea في الجدول أصلًا — المحظور الثامن",
    !types.rows.some((row) => row.data_type === "bytea"));

  await db.getPool().end();
} catch (error) {
  console.error(`فشل: ${error.message}`);
  failed = true;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${temporary}`).catch(() => {});
  await admin.end().catch(() => {});
}
console.log(failed
  ? "\nسقط الفحص."
  : "\nالمراسلة سليمة: ما بين اثنين يبقى بينهما، والعدّاد يوافق ما لم يُقرأ.");
process.exit(failed ? 1 : 0);
