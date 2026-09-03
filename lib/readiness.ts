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

/** الوقائع التي تُبنى عليها الأحكام — تُجمع من القاعدة، وتُختبر هنا وحدها. */
export interface ReadinessFacts {
  clinicName: string;
  clinicPhone: string;
  baseCurrency: string;
  /** آخر يومٍ عُدِّل فيه سعر صرف — أو `null` إن لم يُعدَّل قط. */
  ratesUpdatedOn: string | null;
  activeUsersByRole: Record<string, number>;
  doctorCount: number;
  doctorsWithoutPercent: number;
  labPartyCount: number;
  serviceCount: number;
  /** آخر نسخة احتياطية نُزّلت — أو `null`. */
  lastBackupOn: string | null;
  /**
   * أرمزُ التنصيب حيٌّ؟ حيٌّ يعني: مضبوطًا وطولُه ١٦ حرفًا فأكثر — وهو بعينه
   * ما يشترطه `/api/auth/setup`، فما دونه لا يفتح شيئًا.
   */
  setupTokenLive: boolean;
  /**
   * عمرُ الوردية المفتوحة بالأيام — أو `null` إن لم تكن هناك مفتوحة.
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

  const rateAge = daysSince(facts.ratesUpdatedOn, facts.today);
  checks.push({
    key: "rates",
    title: "أسعار الصرف",
    level: rateAge === null ? "warn" : rateAge > RATE_STALE_DAYS ? "warn" : "ok",
    detail: rateAge === null ? "لم تُعدَّل بعد" : `عُدِّلت قبل ${rateAge} يومًا`,
    why: "أسعار الصرف تتغيّر في اليمن أسبوعيًّا. وسعرٌ قديم يجعل كل دفعةٍ بالسعودي أو الدولار تُقيَّد بقيمةٍ خاطئة في الدفاتر.",
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

  checks.push({
    key: "services",
    title: "دليل الخدمات وأسعارها",
    level: facts.serviceCount === 0 ? "blocked" : "ok",
    detail: `${facts.serviceCount} خدمة`,
    why: "بلا خدمات مسعّرة لا تُفوتر زيارة، ولا يُبنى شيءٌ من المالية عليها.",
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
    detail: backupAge === null ? "لم تُؤخذ نسخة بعد" : `آخر نسخة قبل ${backupAge} يومًا`,
    why: "ملفّات المرضى وحساباتهم في قاعدةٍ واحدة. وبلا نسخةٍ خارجها، عطلٌ واحد يُنهي تاريخ المركز كلَّه.",
    href: "/settings/export",
  });

  if (facts.openShiftAgeDays !== null && facts.openShiftAgeDays >= 1) {
    checks.push({
      key: "shifts",
      title: "وردية مفتوحة",
      level: "warn",
      detail: `مفتوحة منذ ${facts.openShiftAgeDays} ${facts.openShiftAgeDays === 1 ? "يوم" : "يومًا"}`,
      why: "الوردية المفتوحة تجمع قبض يومين في جردٍ واحد، فلا يُعرف فرقُ أيّ يومٍ وقع.",
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
