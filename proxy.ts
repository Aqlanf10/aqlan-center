import { NextResponse, type NextRequest } from "next/server";
import { validateSessionToken } from "@/lib/sessionValidation";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * الباب الوحيد.
 *
 * الحماية هنا لا في كل مسار على حدة: مسارٌ جديد يُضاف غدًا يصير محميًا تلقائيًا، بينما
 * الحماية الموزّعة تُنسى في أول ملف. القائمة أدناه هي **ما يُسمح به** لا ما يُمنع —
 * والفرق جوهري: نسيان إضافة مسار هنا يعني إغلاقه، لا كشفه.
 *
 * التحقق من التوقيع والانتهاء هنا؛ حالة الحساب وإصدار الجلسة يُراجعان داخل المسارات.
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/setup",
  // شاشة الصالة: تلفاز معلّق على الحائط لا لوحة مفاتيح معه. الجلسة تنتهي بعد اثنتي
  // عشرة ساعة، وربطها بها كان يعني شاشة سوداء كل صباح إلى أن يفتحها أحد ويسجّل الدخول.
  // ما يُسرّب مقابل ذلك محدود عمدًا: الاسم الأول ورقم الكرسي وعدد المنتظرين — أي ما
  // يراه ويسمعه كل جالس في الصالة أصلًا. لا هاتف ولا اسم كامل ولا رقم مريض.
  "/display",
  // صفحة طلب الموعد: مفتوحة للمرضى بالتعريف. لا تكتب في المواعيد — تكتب طلبًا
  // تؤكّده الاستقبال — فأسوأ ما يستطيعه العابث بها ملء قائمة طلبات.
  "/book",
  // بوابة المريض: شاشةٌ يفتحها المريض على هاتفه، وحارسُها جلستها هي لا جلسة
  // الطاقم. والصفحة نفسها لا تعرض شيئًا قبل الدخول — تعرض نموذج الدخول.
  "/portal",
  /*
   * ملفّا التثبيت. المتصفّح يطلبهما **قبل الدخول وبلا كوكي** — ولو رُدّا بتحويلٍ
   * إلى شاشة الدخول لما ظهر عرض التثبيت أصلًا، ولخُزّنت صفحةُ الدخول مكان صفحة
   * الانقطاع. وما فيهما لا يخصّ مريضًا: اسمُ المركز المعلن، وصفحةُ «لا اتصال».
   */
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  // أيقونة التبويب. كانت تُردّ بتحويلٍ إلى الدخول، فتبويب شاشة الدخول بلا أيقونة.
  "/icon.svg",
]);
const PUBLIC_API = new Set([
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/logout",
  // فحص الإعداد: من يحتاجه هو من لا يستطيع الدخول بعد.
  "/api/health",
  // نبض المنصة. مغلقًا كان يعني أن فاحص Railway يتلقّى 401 إلى الأبد فلا تُعتمد
  // نشرة سليمة أبدًا — والحارس الذي يمنع الفحص يمنع التطبيق من أن يُولد.
  "/api/ping",
  // تغذية شاشة الصالة — تُبنى استجابتها على الخادم بما يُعرض فقط.
  "/api/display",
  // استقبال طلب الموعد. المسار الوحيد المفتوح للكتابة بلا جلسة، ومحدود بحدّين
  // يوميّين للرقم وللمصدر داخل المسار نفسه.
  "/api/book",
]);

/**
 * مسارات بوابة المريض.
 *
 * وهي «مفتوحة» من هذا الحارس لأنها لا تُحرَس بجلسة الطاقم — بل **بجلسة البوابة
 * التي يفحصها كلُّ مسارٍ منها بنفسه** (`requirePortalSession`). والفرق جوهري:
 * لو أُلحقت بجلسة الطاقم لما استطاع مريضٌ فتحها أصلًا؛ ولو تُركت بلا فحصٍ داخلي
 * لفُتح حساب أيّ مريضٍ لمن يعرف رقمه.
 *
 * ولذلك يفحص `verify:http` كلَّ مسارٍ منها بلا كوكي ويشترط 401 — والبادئة هنا
 * تعني أن مسارًا جديدًا يُضاف غدًا يمرّ من الحارس، فوجودُ ذلك الفحص هو ما يمنع
 * أن يُنسى `requirePortalSession` فيه.
 */
const PORTAL_API_PREFIX = "/api/portal/";

/**
 * أيقونات التثبيت.
 *
 * يطلبها النظام لا الصفحة — أندرويد يجلبها وقت التثبيت وبعده لرسم الأيقونة على
 * الشاشة الرئيسة، بلا كوكي ولا جلسة. وهي صورٌ للشعار لا غير.
 */
const PUBLIC_ICON_PREFIX = "/icons/";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let hasSession = false;
  try { hasSession = Boolean(await validateSessionToken(request.cookies.get(SESSION_COOKIE)?.value)); } catch { /* incomplete setup */ }

  // Browser mutations must originate from this site. SameSite cookies remain a second layer.
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    let foreignOrigin = false;
    try { foreignOrigin = Boolean(origin && new URL(origin).host !== request.headers.get("host")); }
    catch { foreignOrigin = true; }
    if (request.headers.get("sec-fetch-site") === "cross-site" || foreignOrigin) {
      return NextResponse.json({ message: "مصدر الطلب غير مسموح." }, { status: 403 });
    }
  }
  if (PUBLIC_API.has(pathname) || pathname.startsWith(PORTAL_API_PREFIX)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (hasSession) return NextResponse.next();
    // رسالة عربية حتى لمسارات API: قد تظهر في الواجهة كما هي.
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith(PUBLIC_ICON_PREFIX)) {
    // من يملك جلسة لا يرى شاشة الدخول من جديد.
    if (hasSession && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // الملفات الساكنة وحدها خارج الحارس.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
