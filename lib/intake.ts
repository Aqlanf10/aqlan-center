/**
 * الاستمارة الصحّية — منطقٌ خالص بلا `node:crypto`.
 *
 * ومعزولةٌ عن `lib/portal.ts` عمدًا، للسبب نفسه الذي عُزل به اسمُ كوكي الجلسة عن
 * `lib/auth.ts`: **شاشة المريض تستورد قائمة الحالات، فيسحب معها الاستيرادُ مكتبةَ
 * التعمية كلّها إلى المتصفّح فيسقط البناء**. والفصل هنا ليس ترتيبًا للملفات؛ هو ما
 * يجعل الشاشة تُبنى أصلًا.
 */

/**
 * استمارة التاريخ الطبي — يملؤها المريض قبل حضوره.
 *
 * وهي أكبرُ ما تبقّى من ربحٍ في **الزحمة**: التاريخ الطبي يُملأ اليوم على الطاولة
 * والمريض واقف والاستقبال تكتب عنه — دقائقُ لكل مريضٍ جديد، وطابورٌ خلفه. وأخطر
 * من ذلك أنه يُملأ على عجل: يُسأل «عندك شيء؟» فيقول «لا» وهو على مميّع دم.
 *
 * **وقائمةُ شروطٍ تُؤشَّر قبل الحقل الحرّ**: الطاقم يقرؤها في ثوانٍ، وتبقى قابلة
 * للعدّ. والنصّ الحرّ للمضادات والأدوية بعدها لا قبلها.
 *
 * **والاستمارة يُضاف إليها ولا تُستبدل**: كل إرسالٍ نسخةٌ جديدة، فتاريخُ الصحة
 * يتغيّر مع الزمن — من صار مريض سكّرٍ هذا العام لم يكن كذلك في استمارة أمس،
 * ومحوُ القديمة يمحو متى تغيّر.
 *
 * **ولا تكتب في `medical_alert`**: ذلك حقلُ الطبيب لا حقل المريض. وقولُ المريض
 * «لا حساسية» لا يُصبح تنبيهًا سريريًّا بمجرّد أن يُكتب — الطبيب يقرأ ما قال ثم
 * يقرّر. وخلطُ الاثنين يجعل نصّ مريضٍ بلا مراجعةٍ يظهر بشارة الخطر الحمراء.
 */
export const INTAKE_CONDITIONS: { key: string; label: string }[] = [
  { key: "diabetes", label: "السكري" },
  { key: "hypertension", label: "ارتفاع الضغط" },
  { key: "heart", label: "مرض في القلب" },
  { key: "asthma", label: "الربو" },
  { key: "kidney", label: "مرض في الكلى" },
  { key: "liver", label: "مرض في الكبد" },
  { key: "thyroid", label: "خلل في الغدة الدرقية" },
  { key: "epilepsy", label: "الصرع" },
  { key: "pregnancy", label: "الحمل" },
  { key: "bleeding", label: "اضطراب نزف أو مميّع دم" },
  { key: "anesthesia", label: "مضاعفات سابقة من التخدير" },
];

export const INTAKE_LABEL = new Map(INTAKE_CONDITIONS.map((one) => [one.key, one.label]));

export interface IntakeAnswers {
  conditions: string[];
  allergies: string | null;
  medications: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  note: string | null;
}

export type IntakeValidation =
  | { ok: true; value: IntakeAnswers }
  | { ok: false; message: string };

const INTAKE_TEXT_LIMIT = 500;

function cleanText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

export function validateIntake(raw: unknown): IntakeValidation {
  const source = (raw ?? {}) as Record<string, unknown>;
  const given = Array.isArray(source.conditions) ? source.conditions : [];
  const conditions: string[] = [];
  for (const key of given) {
    // مفتاحٌ لا نعرفه يُردّ ولا يُتجاهَل: تجاهلُه يعني استمارةً تُحفظ ناقصةً بصمت،
    // فيظنّ المريض أنه أخبرنا ولم نُخبَر.
    if (typeof key !== "string" || !INTAKE_LABEL.has(key)) {
      return { ok: false, message: "قائمة الحالات غير صحيحة. حدّث الصفحة وأعد الإرسال." };
    }
    if (!conditions.includes(key)) conditions.push(key);
  }
  const emergencyPhone = cleanText(source.emergencyPhone, 30);
  if (emergencyPhone && emergencyPhone.replace(/\D/g, "").length < 7) {
    return { ok: false, message: "رقم الطوارئ غير صحيح." };
  }
  return {
    ok: true,
    value: {
      conditions,
      allergies: cleanText(source.allergies, INTAKE_TEXT_LIMIT),
      medications: cleanText(source.medications, INTAKE_TEXT_LIMIT),
      emergencyName: cleanText(source.emergencyName, 120),
      emergencyPhone,
      note: cleanText(source.note, INTAKE_TEXT_LIMIT),
    },
  };
}

/**
 * ملخّصٌ للطاقم في سطر — ما يُقرأ قبل لمس الكرسي.
 *
 * ويبدأ بالحالات لا بالملاحظات: الطبيب الواقف يقرأ أوّل ثلاث كلمات، فإن كانت
 * «لا شيء مذكور» مضى، وإن كانت «مميّع دم» توقّف.
 */
export function intakeSummary(answers: IntakeAnswers): string {
  const parts: string[] = [];
  if (answers.conditions.length > 0) {
    parts.push(answers.conditions.map((key) => INTAKE_LABEL.get(key) ?? key).join(" · "));
  }
  if (answers.allergies) parts.push(`حساسية: ${answers.allergies}`);
  if (answers.medications) parts.push(`أدوية: ${answers.medications}`);
  return parts.length > 0 ? parts.join(" — ") : "لا شيء مذكور";
}
