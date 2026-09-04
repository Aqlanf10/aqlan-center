/**
 * جاهزية النظام — **ما الذي يمنع بدء العمل عليه اليوم؟**
 *
 * ونظامٌ رسميّ لعيادةٍ تعمل لا يُسلَّم بقول «جرّبه»: فيه إعداداتٌ إن بقيت على
 * افتراضاتها أنتجت أرقامًا خاطئة بصمت — سعرُ صرفٍ قديم يجعل كلّ دفعةٍ بالدولار
 * خطأً، ومستخدمٌ واحد يجعل «من استلم المبلغ» اسمًا واحدًا مهما اختلف من استلمه،
 * ورمزُ تنصيبٍ لم يُزَل يجعل أوّل من يجد الرابط مديرًا.
 *
 * فهذه الشاشة تقول ما بقي، بندًا بندًا، ومعه **لماذا يهمّ** و**أين يُصلَح**.
 * ولا تقول «جاهز» ما دام بندٌ حاجز مفتوحًا.
 */

/**
 * أرمزُ التنصيب حيٌّ؟
 *
 * `/api/auth/setup` يشترط `expected.length >= 16`، فرمزٌ أقصر لا يفتح شيئًا.
 * والتعريف هنا وحده: كان في `/api/health` حكمٌ ثانٍ على الرمز نفسه، وحكمان
 * لشيءٍ واحد يفترقان — فتقول شاشةٌ «أُزيل» وتقول أخرى «ما زال».
 */
export function setupTokenIsLive(token: string | undefined | null): boolean {
  return (token ?? "").length >= 16;
}

export type ReadinessLevel = "blocked" | "warn" | "ok";

export interface ReadinessCheck {
  key: string;
  title: string;
  level: ReadinessLevel;
  /** ما الحال الآن — رقمًا أو نصًّا، لا حكمًا. */
  detail: string;
  /** ولماذا يهمّ: ما الذي يقع إن تُرك. */
  why: string;
  /** أين يُصلَح. */
  href?: string;
}

/**
 * العملات التي لها سعر صرف يُحفظ في الإعدادات.
 *
 * ولكلٍّ صفٌّ مستقلّ في `settings` بتاريخ تعديلٍ مستقل: شاشةُ الإعدادات تحفظ
 * الحقول المتغيّرة وحدها، فحفظُ سعر الدولار اليوم لا يمسّ صفّ الريال السعودي.
 */
export const RATE_CURRENCIES = ["SAR", "USD"] as const;
export type RateCurrency = (typeof RATE_CURRENCIES)[number];

export const RATE_CURRENCY_LABEL: Record<RateCurrency, string> = {
  SAR: "الريال السعودي",
  USD: "الدولار",
};

/** الوقائع التي تُبنى عليها الأحكام — تُجمع من القاعدة، وتُختبر هنا وحدها. */
export interface ReadinessFacts {
  clinicName: string;
  clinicPhone: string;
  baseCurrency: string;
  /**
   * آخر يومٍ حُفظ فيه سعرُ **كلِّ عملةٍ على حدة** — و`null` يعني أنّ مفتاحها لم
   * يُكتب في `settings` قطّ.
   *
   * ولا يُجمعان في تاريخٍ واحد: `MAX` على الاثنين يجعل تحديثَ سعرٍ واحدٍ اليوم
   * يستر رفيقَه القديم، فتُقيَّد دفعاتٌ بتلك العملة بسعرٍ بالٍ بلا تحذير.
   */
  ratesUpdatedOn: Record<RateCurrency, string | null>;
  activeUsersByRole: Record<string, number>;
  doctorCount: number;
  doctorsWithoutPercent: number;
  labPartyCount: number;
  /** كل خدمةٍ نشطة في الدليل — مسعَّرةً كانت أو لا. */
  serviceCount: number;
  /**
   * والنشطة **التي ضُبط سعرها** وحدها.
   *
   * فـ`importClinicCatalog` يُدرج دليل العيادة كلَّه بـ`price_configured = FALSE`،
   * و`validateProcedures` يردّ أيًّا منها: «الخدمة موقوفة أو لم يُضبط سعرها بعد».
   * فعدُّ الصفوف يقول «تسعون خدمة» ولا واحدةَ منها تُفوتَر.
   */
  servicesPriced: number;
  /**
   * آخر يومٍ **اكتمل** فيه بثُّ نسخةٍ للقاعدة أو نسخةٍ كاملة — أو `null`.
   *
   * ولا يُقرأ من `backup.download`: ذاك يُكتب قبل أوّل بايت، ويكتبه أيضًا أرشيفُ
   * الأشعّة وحده. فنسخةٌ بُدئت ثمّ أُلغيت — أو أشعّةٌ نُزّلت بلا قاعدة — كانت
   * تُغلق البند الحاجز وقاعدةُ المرضى والمال لم تُنسخ قطّ.
   */
  lastBackupOn: string | null;
  /**
   * أرمزُ التنصيب حيٌّ؟ حيٌّ يعني: مضبوطًا وطولُه ١٦ حرفًا فأكثر — وهو بعينه
   * ما يشترطه `/api/auth/setup`، فما دونه لا يفتح شيئًا.
   */
  setupTokenLive: boolean;
  /**
   * كم يومَ عيادةٍ عبرت الورديةُ المفتوحة — أو `null` إن لم تكن هناك مفتوحة.
   *
   * وهو **فرقُ التاريخين بتوقيت العيادة** لا طرحُ ثوانٍ: وردية فُتحت أمس مساءً
   * وفُحصت اليوم صباحًا عمرُها ساعات، وقد جمعت قبضَ يومين في جردٍ واحد — وهو
   * بعينه ما كُتب البند لأجله. وقسمةُ الثواني على ٨٦٤٠٠ كانت تعطيها صفرًا
   * فتُسقط ذكرها. واليمن على +٣، فالحساب في القاعدة بمنطقة العيادة لا بـUTC.
   *
   * وهي واحدةٌ على الأكثر: `cashier_shifts_one_open` فهرسٌ فريد يمنع الثانية.
   * فعدُّها رقمًا يوهم بما لا يقع.
   */
  openShiftAgeDays: number | null;
  /** أوامر مختبرٍ لها تكلفة ولا طبيب — فلا تُخصم من عمولة أحد. */
  labOrdersWithoutDoctor: number;
  today: string;
}

const daysSince = (from: string | null, today: string): number | null => {
  if (!from) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
};

/** أقصى عمرٍ يُقبل لسعر صرفٍ قبل أن يُعدّ قديمًا. */
export const RATE_STALE_DAYS = 14;
/** وأقصى ما يُقبل بين نسختين احتياطيتين. */
export const BACKUP_STALE_DAYS = 7;

/**
 * يبني قائمة البنود من الوقائع.
 *
 * والترتيب مقصود: الحاجز أوّلًا ثم التحذير ثم التمام — فمن يفتح الشاشة يجد ما
 * يوقفه في أعلاها لا بعد تمريرة.
 */
export function readinessChecks(facts: ReadinessFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  // ولا يُقال إنه يمنح مديرًا لمن وجده: `createFirstAdmin` يُدرج بشرط
  // `WHERE NOT EXISTS (SELECT 1 FROM users)`، فما دام في الجدول مستخدمٌ واحد
  // لا يُنشئ الرمزُ شيئًا. وحكمٌ أشدّ من الواقع يُفقد بقيّةَ البنود مصداقيتها.
  const anyUser = Object.values(facts.activeUsersByRole).reduce((sum, count) => sum + count, 0);
  checks.push({
    key: "setup-token",
    title: "رمز التنصيب",
    level: facts.setupTokenLive && anyUser > 0 ? "warn" : "ok",
    detail: facts.setupTokenLive ? "ما زال مضبوطًا في متغيّرات النشر" : "أُزيل",
    why: "لا يُنشئ مديرًا ما دام في النظام مستخدمون. لكنه يبقى بابًا مفتوحًا: "
      + "لو فرغ جدول المستخدمين يومًا — استعادةٌ إلى قاعدة فارغة أو تنصيبٌ جديد — "
      + "صار أوّل من يجد رابط /setup هو المدير. وقد انتهى عمله، فإبقاؤه بلا مقابل.",
  });

  checks.push({
    key: "users",
    title: "المستخدمون",
    // حسابٌ واحد يجعل كل فحوص الصلاحيات بلا معنى — وهو حاجزٌ لا تحذير.
    level: (facts.activeUsersByRole.admin ?? 0) === 0 ? "blocked"
      : anyUser < 2 ? "warn"
      : "ok",
    detail: Object.entries(facts.activeUsersByRole)
      .map(([role, count]) => `${role}: ${count}`).join(" · ") || "لا مستخدمين",
    why: "بحسابٍ واحد يدخل الجميع باسم المدير، فيصير «من استلم المبلغ» في كل سند اسمًا واحدًا مهما اختلف من استلمه.",
    href: "/settings/users",
  });

  checks.push({
    key: "clinic-identity",
    title: "هوية المركز",
    level: facts.clinicName.trim().length >= 3 && facts.clinicPhone.trim().length >= 6 ? "ok" : "warn",
    detail: `${facts.clinicName || "بلا اسم"} · ${facts.clinicPhone || "بلا هاتف"}`,
    why: "الاسم والهاتف يظهران في كل سند وكشف حساب ورسالة واتساب تخرج من المركز.",
    href: "/settings",
  });

  /*
   * سعرُ كل عملةٍ يُحكم عليه وحده، والبند يأخذ **أسوأهما**.
   *
   * فشاشة الإعدادات تحفظ الحقول المتغيّرة وحدها: من صحّح سعر الدولار اليوم لم
   * يمسّ صفّ الريال السعودي. وجمعُ التاريخين بـ`MAX` كان يجعل ذلك التصحيح يقول
   * «تمام» عن سعرٍ سعوديٍّ عمرُه شهر — فتُقيَّد كلّ دفعةٍ به خطأً بلا تحذير.
   *
   * والغيابُ ليس محايدًا: مفتاحٌ لم يُحفظ قطّ يعني أنّ البرنامج يعمل بقيمةٍ
   * افتراضيّة كُتبت في الكود، لا بقرارِ مالكٍ راجع السوق.
   */
  const rateRows = RATE_CURRENCIES.map((currency) => {
    const on = facts.ratesUpdatedOn?.[currency] ?? null;
    return { currency, age: daysSince(on, facts.today) };
  });
  checks.push({
    key: "rates",
    title: "أسعار الصرف",
    level: rateRows.some((one) => one.age === null || one.age > RATE_STALE_DAYS) ? "warn" : "ok",
    detail: rateRows.map(({ currency, age }) =>
      `${RATE_CURRENCY_LABEL[currency]}: ${
        age === null ? "لم يُحفظ قط — على القيمة الافتراضية"
          : age === 0 ? "حُدِّث اليوم"
          : `قبل ${age} يومًا`}`).join(" · "),
    why: "أسعار الصرف تتغيّر في اليمن أسبوعيًّا. وسعرٌ قديم يجعل كل دفعةٍ بتلك العملة تُقيَّد بقيمةٍ خاطئة في الدفاتر — "
      + "وسعرٌ لم يُحفظ قط ليس «سليمًا»، بل قيمةٌ افتراضية لا قرارَ لك فيها.",
    href: "/settings",
  });

  checks.push({
    key: "doctors",
    title: "الأطباء ونسبهم",
    level: facts.doctorCount === 0 ? "warn"
      : facts.doctorsWithoutPercent > 0 ? "warn" : "ok",
    detail: facts.doctorCount === 0 ? "لا أطباء مسجّلون"
      : `${facts.doctorCount} طبيبًا · ${facts.doctorsWithoutPercent} بلا نسبة`,
    why: "الطبيب بلا نسبةٍ مسجّلة لا تُحسب له عمولة، فتظهر مستحقاته صفرًا وهو يعمل.",
    href: "/finance/parties",
  });

  /*
   * والمسعَّرة وحدها تُعدّ خدمة.
   *
   * فاستيراد دليل العيادة يُدرج نحوًا من تسعين صفًّا فعّالًا بلا سعر، ثم يردّها
   * `validateProcedures` عند أوّل زيارة: «الخدمة موقوفة أو لم يُضبط سعرها بعد».
   * فعدُّ الصفوف كان يقول «تمام» ولا خدمةَ تُختار في زيارة أصلًا.
   *
   * والرقمان معًا لأنّ أحدهما وحده يكذب: «٩٠ خدمة» تستر أنّ صفرًا منها مسعَّر،
   * و«٣ مسعّرة» تستر أنّ سبعًا وثمانين تنتظر سعرًا.
   */
  checks.push({
    key: "services",
    title: "دليل الخدمات وأسعارها",
    level: facts.servicesPriced === 0 ? "blocked" : "ok",
    detail: `${facts.serviceCount} خدمة · ${facts.servicesPriced} مسعّرة`,
    why: "الخدمة بلا سعرٍ مضبوط تُردّ عند إضافتها إلى الزيارة. فبلا خدمةٍ مسعّرةٍ واحدة لا تُفوتر زيارة، ولا يُبنى شيءٌ من المالية عليها.",
    href: "/finance/services",
  });

  checks.push({
    key: "labs",
    title: "المختبرات",
    level: facts.labPartyCount === 0 ? "warn" : "ok",
    detail: `${facts.labPartyCount} مختبرًا`,
    why: "تكلفة العمل لا تُسجَّل إلّا على مختبرٍ مسجَّل، وبلا ذلك تظهر العيادة رابحة وهي مدينة.",
    href: "/finance/parties",
  });

  if (facts.labOrdersWithoutDoctor > 0) {
    checks.push({
      key: "lab-orders-doctor",
      title: "أعمال مختبرٍ بلا طبيب",
      level: "warn",
      detail: `${facts.labOrdersWithoutDoctor} عملًا له تكلفة ولا طبيب مكتوب عليه`,
      why: "تكلفتها لا تُخصم من عمولة أحد، فتُصرف عمولاتٌ على مالٍ خرج إلى المختبر.",
      href: "/lab",
    });
  }

  const backupAge = daysSince(facts.lastBackupOn, facts.today);
  checks.push({
    key: "backup",
    title: "النسخ الاحتياطي",
    level: backupAge === null ? "blocked" : backupAge > BACKUP_STALE_DAYS ? "warn" : "ok",
    detail: backupAge === null ? "لم تكتمل نسخةٌ للقاعدة بعد"
      : backupAge === 0 ? "اكتملت نسخةٌ اليوم"
      : `آخر نسخةٍ مكتملة قبل ${backupAge} يومًا`,
    why: "ملفّات المرضى وحساباتهم في قاعدةٍ واحدة. وبلا نسخةٍ خارجها، عطلٌ واحد يُنهي تاريخ المركز كلَّه. "
      + "ولا يُحتسب هنا إلّا ما اكتمل بثّه للقاعدة أو للنسخة الكاملة — لا أرشيفُ الأشعّة وحده، ولا تنزيلٌ بُدئ ثم انقطع. "
      + "وحدّ ما يشهد به السجل أنّ الخادم أخرج الملفّ كاملًا؛ أمّا سلامتُه على قرصك فلا يُثبتها إلّا استعادةٌ فعلية.",
    href: "/settings/export",
  });

  if (facts.openShiftAgeDays !== null && facts.openShiftAgeDays >= 1) {
    checks.push({
      key: "shifts",
      title: "وردية مفتوحة",
      level: "warn",
      detail: `فُتحت في يوم عملٍ سابق — قبل ${facts.openShiftAgeDays} ${
        facts.openShiftAgeDays === 1 ? "يوم عيادة" : "أيام عيادة"} ولم تُغلق`,
      why: "الوردية المفتوحة تجمع قبض يومين في جردٍ واحد، فلا يُعرف فرقُ أيّ يومٍ وقع. "
        + "والعبرة بيوم العيادة لا بمرور أربعٍ وعشرين ساعة: وردية فُتحت أمس مساءً وفُحصت اليوم صباحًا عمرُها ساعات، وقد جمعت يومين.",
      href: "/finance",
    });
  }

  const order: Record<ReadinessLevel, number> = { blocked: 0, warn: 1, ok: 2 };
  return checks.sort((one, two) => order[one.level] - order[two.level]);
}

/**
 * أجاهزٌ النظام؟
 *
 * ولا يُقال «جاهز» ما دام بندٌ حاجز مفتوحًا. والتحذيرات لا تمنع البدء لكنها
 * تُعدّ، فمن يبدأ يعرف على ماذا يبدأ.
 */
export function readinessVerdict(checks: readonly ReadinessCheck[]): {
  ready: boolean; blocked: number; warnings: number; message: string;
} {
  const blocked = checks.filter((one) => one.level === "blocked").length;
  const warnings = checks.filter((one) => one.level === "warn").length;
  if (blocked > 0) {
    return {
      ready: false, blocked, warnings,
      message: `${blocked} ${blocked === 1 ? "بندٌ يمنع" : "بنودٍ تمنع"} بدء العمل — أغلقها أوّلًا.`,
    };
  }
  if (warnings > 0) {
    return {
      ready: true, blocked, warnings,
      message: `لا مانع من البدء، و${warnings} ${warnings === 1 ? "بندٌ يحتاج" : "بنودٍ تحتاج"} انتباهك.`,
    };
  }
  return { ready: true, blocked, warnings, message: "النظام جاهز للعمل." };
}
