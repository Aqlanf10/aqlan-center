/**
 * بوّابة الثغرات — تفرّق بين «لا ثغرة» و«لم يُسأل».
 *
 * كان الفحص في CI هو `npm audit --audit-level=high`، وهو يخرج بالرمز ١ في
 * حالتين لا جامع بينهما: أن تكون في الاعتماديات ثغرةٌ خطيرة، وأن يعجز سجلّ
 * npm عن الإجابة. الأولى تُصلَح بترقية حزمة، والثانية لا شأن للتغيير بها.
 * وحين اختلطتا في سطرٍ أحمر واحد صار الحكم بالظنّ: من رأى الأحمر مرّتين
 * حسبه عطلًا في الشبكة ومضى — وفي الثالثة تكون الثغرة حقيقية.
 *
 * وهو ما وقع فعلًا: أُغلقت نقطة `security/audits/quick` في سجلّ npm، فسقطت
 * البوّابة على طلبَي دمجٍ معًا والاعتماديات سليمة.
 */

/** ما يُسقط البناء — وهما ما كان يعنيه `--audit-level=high`. */
export const BLOCKING = ["critical", "high"] as const;

export type Severity = "info" | "low" | "moderate" | "high" | "critical";

export type AuditRead =
  | { kind: "report"; counts: Partial<Record<Severity, number>>; blocking: number;
      advisories: Record<string, { severity?: string; via?: { title?: string }[] }> }
  | { kind: "registry"; why: string }
  | { kind: "unreadable"; why: string };

/**
 * ماذا يقول مخرج `npm audit --json`؟ ثلاثة أجوبة لا رابع لها:
 *   report     — أجاب السجلّ، وفيه العدّ.
 *   registry   — لم يجب: عطلٌ أو نقطةٌ أُغلقت. لا علم لنا بالثغرات.
 *   unreadable — خرج شيءٌ ليس تقريرًا أصلًا.
 */
export function readAudit(stdout: string): AuditRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "unreadable", why: "مخرج الفحص ليس JSON" };
  }
  const report = parsed as {
    metadata?: { vulnerabilities?: Record<string, number> };
    vulnerabilities?: Record<string, { severity?: string; via?: { title?: string }[] }>;
    message?: string;
    error?: { summary?: string; detail?: string };
  } | null;

  const counts = report?.metadata?.vulnerabilities;
  if (counts && typeof counts === "object") {
    const blocking = BLOCKING.reduce((sum, level) => sum + (Number(counts[level]) || 0), 0);
    return { kind: "report", counts, blocking, advisories: report?.vulnerabilities ?? {} };
  }
  // شكل الخطأ عند السجلّ: statusCode/message ولا عدّ فيه إطلاقًا.
  const why = report?.message || report?.error?.summary || report?.error?.detail || "سبب غير مذكور";
  return { kind: "registry", why: String(why) };
}

export type Verdict = { pass: boolean; code: 0 | 1 | 2; reason: string };

/**
 * القرار على آخر قراءة: عجزٌ ثم إجابة يُحكم فيه بالإجابة.
 * والرمزان مفترقان عمدًا — ١ ثغرةٌ ثابتة، ٢ فحصٌ لم يجرِ — فلا يُقرأ العجز أمانًا.
 */
export function verdict(reads: AuditRead[]): Verdict {
  const last = reads[reads.length - 1];
  if (!last) return { pass: false, code: 2, reason: "لم يُنفَّذ الفحص أصلًا." };
  if (last.kind === "report") {
    return last.blocking > 0
      ? { pass: false, code: 1, reason: `ثغرات بدرجة ${BLOCKING.join(" أو ")}: ${last.blocking}.` }
      : { pass: true, code: 0, reason: "لا ثغرات بالدرجات الحاجبة." };
  }
  return {
    pass: false,
    code: 2,
    reason:
      `تعذّر سؤال سجلّ npm بعد ${reads.length} محاولات — الاعتماديات لم تُفحص، ` +
      `ولم يثبت أنها سليمة. آخر سبب: ${last.why}`,
  };
}
