import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/db";
import { consumeLoginAttempt } from "@/lib/loginLimit";
import {
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  createSessionToken,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }

  const source = (body ?? {}) as Record<string, unknown>;
  const username = typeof source.username === "string" ? source.username.trim() : "";
  const password = typeof source.password === "string" ? source.password : "";
  if (!username || !password || username.length > 80 || password.length > 1024) {
    return NextResponse.json({ message: "اسم المستخدم وكلمة المرور مطلوبان." }, { status: 400 });
  }

  try {
    const limit = await consumeLoginAttempt(username, request.headers);
    if (!limit.allowed) {
      return NextResponse.json({ message: "محاولات دخول كثيرة. انتظر قليلًا ثم حاول مجددًا." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }
    const user = await findUserByUsername(username);
    // رسالة واحدة لحالتي «المستخدم غير موجود» و«كلمة المرور خاطئة»: التفريق بينهما
    // يخبر المحاوِل أيّ أسماء الدخول صحيحة، فيحوّل التخمين من اثنين إلى واحد.
    const invalid = NextResponse.json(
      { message: "اسم المستخدم أو كلمة المرور غير صحيحة." },
      { status: 401 },
    );
    if (!user) {
      // تجزئة وهمية حتى يستغرق الرفض الزمن نفسه سواء وُجد المستخدم أم لا؛ بدونها
      // يكشف فارق التوقيت أسماء الدخول الموجودة.
      await verifyPassword(password, "scrypt:0000:0000");
      return invalid;
    }
    if (!(await verifyPassword(password, user.passwordHash))) return invalid;

    const expiresAt = Date.now() + SESSION_DURATION_MS;
    const token = createSessionToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      expiresAt,
      sessionVersion: user.sessionVersion,
    });

    const response = NextResponse.json({
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,      // لا تستطيع أي نصوص في الصفحة قراءتها
      secure: true,        // لا تُرسل على اتصال غير مشفّر
      sameSite: "lax",     // لا تُرسل مع طلب من موقع آخر
      path: "/",
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });
    return response;
  } catch (error) {
    // إعدادٌ ناقص وعطلٌ عابر يبدوان متطابقين من الخارج، وعلاجهما مختلف تمامًا: الأول
    // يحتاج متغيّرًا في لوحة النشر، والثاني يحتاج إعادة محاولة. الرسالة تفرّق بينهما.
    const missingSecret = error instanceof Error && error.message.includes("SESSION_SECRET");
    return NextResponse.json(
      {
        message: missingSecret
          ? "الأداة غير مكتملة الإعداد: SESSION_SECRET ناقص في إعدادات النشر."
          : "تعذّر تسجيل الدخول. أعد المحاولة.",
      },
      { status: missingSecret ? 503 : 500 },
    );
  }
}
