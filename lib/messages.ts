/**
 * الرسائل الداخلية — قواعدُ صرفٍ تُفحص بلا قاعدة بيانات.
 *
 * العيادة تعمل بالنداء: الاستقبال تنادي على الطبيب من الباب، والطبيب يصرخ باسم
 * المادّة الناقصة، والمريض على الكرسي يسمع الاثنين. ثم يُنسى ما قيل، فيُسأل عنه
 * غدًا فلا أحد يذكر من قاله ولا متى.
 *
 * وهذه ليست دردشة: هي **سجلٌّ للعمل** بين اثنين إلى خمسة أشخاص في مبنى واحد.
 * ولذلك لا خادم دردشة ولا مقابس ويب — قاعدةٌ واحدة واستطلاعٌ كل ثوانٍ يكفي
 * مبنًى فيه كرسيان.
 *
 * والملاحظة الصوتية هي الفارق العملي: الطبيب ويداه في فم مريض لا يكتب، لكنه
 * يقول عشر كلمات في خمس ثوانٍ. **والصوت يُحفظ على القرص لا في القاعدة** —
 * المحظور الثامن من الدستور — فالقاعدة تحمل وصفَه وبصمتَه ومدّتَه وحدها.
 */

/** أقصى طول للنصّ — رسالةٌ لا مقال. */
export const MAX_TEXT_LENGTH = 4000;

/**
 * أقصى مدّة تسجيل — دقيقتان.
 *
 * ملاحظةُ عملٍ بين زميلين لا تبلغ الدقيقة عادةً، والدقيقتان حدٌّ لا يقطع كلام
 * أحد. وما تجاوزها مكالمةٌ لا رسالة.
 */
export const MAX_VOICE_MS = 120_000;

/** أقصى حجمٍ للتسجيل — نحو ٢٫٥ ميغابايت، وهي دقيقتان بترميز opus بسعةٍ واسعة. */
export const MAX_VOICE_BYTES = 2_500_000;

/**
 * أنواع الصوت المقبولة.
 *
 * المتصفّحات ترسل `audio/webm;codecs=opus` — واللاحقة تختلف بين متصفّحٍ وآخر
 * ويشتغل الجميع بمشغّلٍ واحد، فالمقارنة على الجذر: رفضُ تسجيلٍ صالحٍ للاحقةٍ
 * لا تُغيّر شيئًا يعني طبيبًا يضغط الزرّ فلا يُرسل شيء ولا يعرف لماذا.
 */
const VOICE_MIME_STEMS = [
  "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/aac", "audio/x-m4a",
] as const;

export function normalizeVoiceMime(mime: string): string {
  return mime.trim().toLowerCase().split(";")[0];
}

export function isAllowedVoiceMime(mime: string): boolean {
  return (VOICE_MIME_STEMS as readonly string[]).includes(normalizeVoiceMime(mime));
}

/** امتداد الملف على القرص من نوعه — التخزين بالمحتوى يحتاج امتدادًا ثابتًا. */
export function voiceExtension(mime: string): string {
  switch (normalizeVoiceMime(mime)) {
    case "audio/webm": return "weba";
    case "audio/mp4": case "audio/x-m4a": return "m4a";
    case "audio/mpeg": return "mp3";
    case "audio/ogg": return "ogg";
    case "audio/wav": return "wav";
    case "audio/aac": return "aac";
    default: return "bin";
  }
}

/** Base64 صالح: أبجديتُه وحدها، وطولٌ من مضاعفات الأربعة. */
export function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** حجم البايتات بعد فكّ الترميز — يُحسب قبل الفكّ لا بعده. */
export function decodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/**
 * جهة الرسالة.
 *
 * زميلٌ بعينه، أو الفريق كلّه. ولا ثالث: «المجموعات» في فريقٍ من ثلاثة تعقيدٌ
 * بلا مقابل — والفريق كلّه هو المجموعة الوحيدة الموجودة فعلًا.
 */
export type MessageTarget = { kind: "user"; userId: number } | { kind: "broadcast" };

export function parseTarget(input: unknown): MessageTarget | null {
  if (input === "broadcast") return { kind: "broadcast" };
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  if (source.kind === "broadcast") return { kind: "broadcast" };
  if (source.kind === "user") {
    const userId = Number(source.userId);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return { kind: "user", userId };
  }
  return null;
}

export interface OutgoingMessage {
  kind: "text" | "voice";
  body: string | null;
  voiceMime: string | null;
  voiceData: string | null;
  voiceMs: number | null;
  voiceBytes: number | null;
}

export type OutgoingResult =
  | { ok: true; value: OutgoingMessage }
  | { ok: false; message: string };

/**
 * تحدّي رسالةٍ صادرة — وكل ردٍّ عربيّ يقول **لماذا**.
 *
 * «تعذّر الإرسال» على شاشة استقبالٍ في وقت الزحمة تعني إعادة المحاولة خمس مرات
 * ثم ترك الشاشة. والسبب المكتوب يعني تصرّفًا واحدًا صحيحًا.
 */
export function validateOutgoing(input: Record<string, unknown>): OutgoingResult {
  if (input.kind === "voice") {
    const mime = typeof input.voiceMime === "string" ? input.voiceMime : "";
    if (!isAllowedVoiceMime(mime)) {
      return { ok: false, message: "نوع التسجيل الصوتي غير مدعوم." };
    }
    const data = typeof input.voiceData === "string" ? input.voiceData : "";
    if (!isBase64(data)) return { ok: false, message: "تسجيل صوتي غير صالح." };
    const bytes = decodedSize(data);
    if (bytes > MAX_VOICE_BYTES) {
      return { ok: false, message: "التسجيل أكبر من الحدّ المسموح — أرسله على جزأين." };
    }
    const rawMs = Number(input.voiceMs);
    if (!Number.isFinite(rawMs) || rawMs <= 0) {
      return { ok: false, message: "مدّة التسجيل غير صالحة." };
    }
    if (rawMs > MAX_VOICE_MS) {
      return { ok: false, message: "التسجيل أطول من دقيقتين — أرسله على جزأين." };
    }
    return {
      ok: true,
      value: {
        kind: "voice",
        body: null,
        voiceMime: normalizeVoiceMime(mime),
        voiceData: data,
        voiceMs: Math.round(rawMs),
        voiceBytes: bytes,
      },
    };
  }

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, message: "اكتب نصّ الرسالة." };
  if (body.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: `الرسالة أطول من الحدّ المسموح (${MAX_TEXT_LENGTH} حرفًا).` };
  }
  return {
    ok: true,
    value: { kind: "text", body, voiceMime: null, voiceData: null, voiceMs: null, voiceBytes: null },
  };
}

/** مدّةٌ مقروءة: ٠:٠٥ — لا «5000 مللي ثانية». */
export function formatVoiceDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** سطرٌ واحد يُعرض في قائمة المحادثات — الصوت مدّتُه لأن نصّه لا يوجد. */
export function messagePreview(
  kind: "text" | "voice", body: string | null, voiceMs: number | null,
): string {
  if (kind === "voice") return `🎙 ملاحظة صوتية ${formatVoiceDuration(voiceMs ?? 0)}`;
  return (body ?? "").replace(/\s+/g, " ").slice(0, 60);
}

export interface ConversationLike {
  userId: number | null;
  unread: number;
  lastAt: string | null;
}

/**
 * ترتيب المحادثات: ما فيه غير مقروءٍ أوّلًا، ثم الأحدث.
 *
 * والترتيب بالأحدث وحده يدفن رسالةً لم تُقرأ تحت محادثةٍ قُرئت للتوّ — وهي بالضبط
 * الرسالة التي فُتحت الشاشة من أجلها.
 */
export function sortConversations<T extends ConversationLike>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
    const at = a.lastAt ? Date.parse(a.lastAt) : 0;
    const bt = b.lastAt ? Date.parse(b.lastAt) : 0;
    if (at !== bt) return bt - at;
    return (a.userId ?? 0) - (b.userId ?? 0);
  });
}
