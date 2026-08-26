import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/sessionCookie";

/**
 * الباب الوحيد.
 *
 * الحماية هنا لا في كل مسار على حدة: مسارٌ جديد يُضاف غدًا يصير محميًا تلقائيًا، بينما
 * الحماية الموزّعة تُنسى في أول ملف. القائمة أدناه هي **ما يُسمح به** لا ما يُمنع —
 * والفرق جوهري: نسيان إضافة مسار هنا يعني إغلاقه، لا كشفه.
 *
 * التحقق هنا من وجود الكوكي وشكلها فقط؛ التحقق من التوقيع يجري في مسارات API نفسها،
 * لأن middleware يعمل على Edge حيث `node:crypto` غير متاح.
 */
const PUBLIC_PATHS = new Set(["/login", "/setup"]);
const PUBLIC_API = new Set([
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/logout",
  // فحص الإعداد: من يحتاجه هو من لا يستطيع الدخول بعد.
  "/api/health",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_API.has(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    if (hasSession) return NextResponse.next();
    // رسالة عربية حتى لمسارات API: قد تظهر في الواجهة كما هي.
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }

  if (PUBLIC_PATHS.has(pathname)) {
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
