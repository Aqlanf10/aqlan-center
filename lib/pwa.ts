/**
 * تثبيت البرنامج على الجهاز — وحدود ما يُخزَّن فيه.
 *
 * الاستقبال تفتح البرنامج من المتصفّح عشرين مرة في اليوم: تبويبٌ بين تبويبات،
 * وشريط عنوانٍ يأكل ربع شاشة الهاتف، ورابطٌ يُكتب باليد كل صباح. والتثبيت يحلّ
 * هذا الثلاثة معًا — أيقونةٌ على الشاشة الرئيسة، وشاشةٌ كاملة، وفتحٌ بنقرة.
 *
 * ولهذا حدٌّ صريح: **التثبيت لا يعني العمل بلا إنترنت**. البرنامج نظام عيادةٍ
 * بياناتُه في قاعدةٍ واحدة، وتخزين شاشة مريضٍ على الهاتف يعني أن سجلّه يبقى في
 * المتصفّح بعد الخروج، وأن رقمًا قديمًا يُعرض على أنه اليوم. فما يُخزَّن هنا هو
 * **ملفات البناء وحدها** — نصوصٌ وخطوطٌ وأيقونات لا بيانات فيها — وما عداها يمرّ
 * إلى الشبكة في كل مرة. والفائدة المقبوضة فتحٌ أسرع، لا سجلٌّ محفوظ.
 */

/**
 * ما يُسمح لعامل الخدمة بتخزينه.
 *
 * قائمة **سماح** لا منع: مسارٌ جديد يُضاف غدًا لا يُخزَّن حتى يُذكر هنا صراحة —
 * وهو الاتجاه الصحيح للخطأ. القائمة كلها ملفاتٌ يُنتجها البناء باسمٍ فيه بصمة
 * محتواه، فتغيّرها يعني اسمًا آخر، فلا يبقى قديمٌ يُخدَم.
 */
const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/"];
const CACHEABLE_EXACT = ["/icon.svg", "/offline.html"];

/**
 * هل يجوز تخزين هذا المسار؟
 *
 * تُنفَّذ نسختها في `public/sw.js` أيضًا — والاختبار يُشغّل النسختين على جدول
 * مسارات واحد ويشترط تطابق الحكم، فانحرافُ إحداهما يسقط قبل أن يصل الهاتف.
 */
export function shouldCache(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  if (CACHEABLE_EXACT.includes(pathname)) return true;
  return CACHEABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** ما يُخزَّن قبل أي انقطاع — صفحة الانقطاع نفسها لا تُجلب حين لا شبكة. */
export const PRECACHE = ["/offline.html", "/icon.svg"];

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  dir: string;
  lang: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

/** اسم المركز الكامل لا يسع تحت أيقونة على شاشة هاتف — فيُقصّ للأيقونة وحدها. */
export function shortName(clinicName: string): string {
  const cleaned = clinicName.trim().replace(/\s+/g, " ");
  if (!cleaned) return "العيادة";
  if (cleaned.length <= 12) return cleaned;
  const words = cleaned.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > 12) break;
    out = next;
  }
  return out || cleaned.slice(0, 12);
}

/**
 * الملف الذي يقرؤه النظام ليعرف أن هذه صفحةٌ تُثبَّت.
 *
 * والاسم يأتي من الإعدادات لا من الكود: من يغيّر اسم مركزه من الشاشة يجب أن يرى
 * الاسم الجديد تحت الأيقونة، لا اسمًا خُبز يوم البناء.
 */
export function buildManifest(clinicName: string): WebManifest {
  return {
    name: clinicName,
    short_name: shortName(clinicName),
    description: "نظام إدارة المركز — الانتظار والمواعيد والمرضى والمختبر والمالية.",
    // يُفتح على شاشة اليوم لا على آخر صفحة زارها المتصفّح.
    start_url: "/",
    scope: "/",
    display: "standalone",
    // الاستقبال تمسك الهاتف طوليًا بيدٍ واحدة، والقلب على الجهاز يقلب الشريط السفلي.
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#f5f7fa",
    theme_color: "#0d2137",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // «القابلة للقصّ»: أندرويد يقصّ الأيقونة دائرةً أو مربّعًا مستديرًا، فتُرسم
      // هذه بهامشٍ آمن حولها لئلّا تُقصّ السنّة نفسها.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export type InstallPlatform = "prompt" | "ios" | "installed" | "unsupported";

/**
 * ما يُقال لصاحب الجهاز.
 *
 * وسفاري على iPhone لا يعطي الصفحة زرًّا تطلبه — التثبيت من قائمة المشاركة وحدها.
 * فالزرّ هناك يكون شرحًا لا زرًّا، وزرٌّ لا يفعل شيئًا أسوأ من لا زر.
 */
export function installHint(platform: InstallPlatform): string {
  switch (platform) {
    case "prompt":
      return "ثبّت البرنامج على الجهاز — يُفتح بأيقونةٍ وشاشةٍ كاملة.";
    case "ios":
      return "للتثبيت على iPhone: زرّ المشاركة ⬆︎ ثم «إضافة إلى الشاشة الرئيسية».";
    case "installed":
      return "البرنامج مثبَّت على هذا الجهاز.";
    default:
      return "هذا المتصفّح لا يدعم التثبيت — افتح البرنامج من Chrome أو Edge أو Safari.";
  }
}

/** أهو متصفّح iOS؟ كلّ متصفّحات iPhone تعمل على WebKit نفسه، فالحكم على النظام. */
export function isIosBrowser(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) ||
    // iPad الحديث يقول عن نفسه «Macintosh» — ويُميَّز باللمس.
    (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent));
}
