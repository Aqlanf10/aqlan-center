import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_LENGTH, MAX_VOICE_BYTES, MAX_VOICE_MS,
  decodedSize, formatVoiceDuration, isAllowedVoiceMime, isBase64, messagePreview,
  normalizeVoiceMime, parseTarget, sortConversations, validateOutgoing, voiceExtension,
} from "../lib/messages";

/** ترميز نصٍّ إلى Base64 كما يفعل المتصفّح. */
const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("جهة الرسالة", () => {
  it("زميلٌ بعينه أو الفريق كلّه — ولا ثالث", () => {
    expect(parseTarget("broadcast")).toEqual({ kind: "broadcast" });
    expect(parseTarget({ kind: "broadcast" })).toEqual({ kind: "broadcast" });
    expect(parseTarget({ kind: "user", userId: 3 })).toEqual({ kind: "user", userId: 3 });
  });

  it("وجهةٌ بلا رقمٍ صحيحٍ موجب تُرفض هنا لا في القاعدة", () => {
    for (const bad of [
      null, undefined, "", "user", 7, { kind: "user" }, { kind: "user", userId: 0 },
      { kind: "user", userId: -1 }, { kind: "user", userId: 1.5 },
      { kind: "user", userId: "3; DROP TABLE" }, { kind: "patient", id: 3 },
    ]) {
      expect(parseTarget(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("تحدّي الرسالة النصية", () => {
  it("النصّ الفارغ يُردّ برسالةٍ عربية تقول ماذا يُفعل", () => {
    const verdict = validateOutgoing({ kind: "text", body: "   " });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toBe("اكتب نصّ الرسالة.");
  });

  it("والمسافات تُقصّ فلا تُحفظ رسالةٌ بيضاء", () => {
    const verdict = validateOutgoing({ body: "  الطبيب ينتظر في الثاني  " });
    expect(verdict.ok && verdict.value.body).toBe("الطبيب ينتظر في الثاني");
  });

  it("وما تجاوز الحدّ يُردّ بالحدّ نفسه مكتوبًا", () => {
    const verdict = validateOutgoing({ body: "ا".repeat(MAX_TEXT_LENGTH + 1) });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain(String(MAX_TEXT_LENGTH));
    // والحدّ نفسه يمرّ — الحدود تُختبر عندها لا حولها.
    expect(validateOutgoing({ body: "ا".repeat(MAX_TEXT_LENGTH) }).ok).toBe(true);
  });

  it("والنصّ لا يحمل حقول صوت", () => {
    const verdict = validateOutgoing({ body: "تم" });
    expect(verdict.ok && verdict.value).toMatchObject({
      kind: "text", voiceMime: null, voiceData: null, voiceMs: null, voiceBytes: null,
    });
  });
});

describe("الملاحظة الصوتية", () => {
  it("نوعُ المتصفّح يُقبل مهما كانت لاحقة الترميز", () => {
    // Chrome يرسل هذا حرفيًا؛ ورفضُه يعني زرًّا يُضغط فلا يحدث شيء.
    expect(isAllowedVoiceMime("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedVoiceMime("AUDIO/MP4")).toBe(true);
    expect(normalizeVoiceMime("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("وما ليس صوتًا يُرفض — ولو سُمّي صوتًا", () => {
    for (const bad of ["", "audio/", "text/html", "application/javascript", "image/png", "video/mp4"]) {
      expect(isAllowedVoiceMime(bad), bad).toBe(false);
    }
  });

  it("ولكلّ نوعٍ امتدادٌ ثابت — التخزين بالمحتوى يحتاجه", () => {
    expect(voiceExtension("audio/webm;codecs=opus")).toBe("weba");
    expect(voiceExtension("audio/mp4")).toBe("m4a");
    expect(voiceExtension("audio/mpeg")).toBe("mp3");
    // ونوعٌ لا نعرفه لا يصير امتدادًا يُشتقّ من نصّ المستخدم.
    expect(voiceExtension("audio/../../etc/passwd")).toBe("bin");
  });

  it("Base64 غير الصالح يُرفض قبل أن يُفكّ", () => {
    expect(isBase64(b64("صوت"))).toBe(true);
    for (const bad of ["", "abc", "!!!!", "ab=c", "a b c d"]) {
      expect(isBase64(bad), bad).toBe(false);
    }
  });

  it("والحجم يُحسب قبل الفكّ لا بعده", () => {
    // فكُّ ملفٍّ ضخمٍ لقياسه هو نفسه ما يُراد منعه.
    for (const text of ["a", "ab", "abc", "abcd", "x".repeat(1000)]) {
      expect(decodedSize(b64(text)), text.slice(0, 6)).toBe(Buffer.from(text).length);
    }
  });

  it("تسجيلٌ أكبر من الحدّ يُردّ", () => {
    const big = "A".repeat(Math.ceil((MAX_VOICE_BYTES + 10_000) / 3) * 4);
    const verdict = validateOutgoing({ kind: "voice", voiceMime: "audio/webm", voiceData: big, voiceMs: 5000 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("أكبر من الحدّ");
  });

  it("وأطول من دقيقتين يُردّ — لا يُقصّ بصمت", () => {
    // قصُّه يعني رسالةً تُسمع ناقصةً ولا أحد يعلم أنها نقصت.
    const verdict = validateOutgoing({
      kind: "voice", voiceMime: "audio/webm", voiceData: b64("صوت طويل"), voiceMs: MAX_VOICE_MS + 1,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("دقيقتين");
    expect(validateOutgoing({
      kind: "voice", voiceMime: "audio/webm", voiceData: b64("صوت"), voiceMs: MAX_VOICE_MS,
    }).ok).toBe(true);
  });

  it("ومدّةٌ غير صالحة تُردّ", () => {
    for (const ms of [0, -1, "طويل", NaN, Infinity, undefined]) {
      const verdict = validateOutgoing({
        kind: "voice", voiceMime: "audio/webm", voiceData: b64("صوت"), voiceMs: ms,
      });
      expect(verdict.ok, String(ms)).toBe(false);
    }
  });

  it("والتسجيل السليم يخرج بنوعٍ مطبَّعٍ وحجمٍ محسوب", () => {
    const data = b64("محتوى تسجيل");
    const verdict = validateOutgoing({
      kind: "voice", voiceMime: "audio/webm;codecs=opus", voiceData: data, voiceMs: 7400,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.value).toMatchObject({
        kind: "voice", voiceMime: "audio/webm", voiceMs: 7400, body: null,
      });
      expect(verdict.value.voiceBytes).toBe(Buffer.from("محتوى تسجيل").length);
    }
  });
});

describe("ما يُعرض في القائمة", () => {
  it("المدّة تُقرأ دقائقَ وثواني", () => {
    expect(formatVoiceDuration(0)).toBe("0:00");
    expect(formatVoiceDuration(5400)).toBe("0:05");
    expect(formatVoiceDuration(65_000)).toBe("1:05");
    expect(formatVoiceDuration(MAX_VOICE_MS)).toBe("2:00");
  });

  it("والصوت يُعرض بمدّته لأن نصّه لا يوجد", () => {
    expect(messagePreview("voice", null, 65_000)).toContain("1:05");
    expect(messagePreview("text", "الطبيب\n\nينتظر", null)).toBe("الطبيب ينتظر");
    expect(messagePreview("text", "ا".repeat(200), null)).toHaveLength(60);
  });
});

describe("ترتيب المحادثات", () => {
  const rows = [
    { userId: 1, unread: 0, lastAt: "2026-09-02T10:00:00.000Z" },
    { userId: 2, unread: 3, lastAt: "2026-09-01T08:00:00.000Z" },
    { userId: null, unread: 0, lastAt: "2026-09-02T11:00:00.000Z" },
    { userId: 4, unread: 0, lastAt: null },
  ];

  it("ما لم يُقرأ أوّلًا ولو كان أقدم", () => {
    // الترتيب بالأحدث وحده يدفن الرسالة التي فُتحت الشاشة من أجلها.
    expect(sortConversations(rows).map((row) => row.userId)).toEqual([2, null, 1, 4]);
  });

  it("ولا يُغيَّر المصفوف الأصلي", () => {
    const before = rows.map((row) => row.userId);
    sortConversations(rows);
    expect(rows.map((row) => row.userId)).toEqual(before);
  });

  it("والفحص نفسه يمسك ترتيبًا بالأحدث وحده", () => {
    const byRecentOnly = [...rows].sort((a, b) =>
      (b.lastAt ? Date.parse(b.lastAt) : 0) - (a.lastAt ? Date.parse(a.lastAt) : 0));
    expect(byRecentOnly.map((row) => row.userId)).not.toEqual([2, null, 1, 4]);
    // وغير المقروء يقع ثالثًا فيه — وهو ما يُراد منعه.
    expect(byRecentOnly.findIndex((row) => row.unread > 0)).toBe(2);
  });
});
