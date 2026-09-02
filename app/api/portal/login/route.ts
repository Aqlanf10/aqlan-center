import { NextResponse } from "next/server";
import { patientForPortal } from "@/lib/db";
import { consumeLoginAttempt } from "@/lib/loginLimit";
import {
  PORTAL_COOKIE, PORTAL_DURATION_MS, createPortalToken,
  portalCredentialsMatch, validatePortalLogin,
} from "@/lib/portal";

export const dynamic = "force-dynamic";

/**
 * دخول المريض — بزوجٍ يملكه هو: جوالُه ورقم ملفه.
 *
 * **والردّ واحدٌ لكل فشل**: «البيانات غير مطابقة». ولو فُرّق بين «لا ملف بهذا الرقم»
 * و«الهاتف لا يطابق» لصار المسار أداةً تُعدّ بها أرقام الملفات الصحيحة رقمًا رقمًا.
 *
 * وحدّ المحاولات هو الحارس الحقيقي: عاملان قصيران بلا حدٍّ يُخمَّنان بالتجربة.
 * ويُحسب على **رقم الملف** لا على الهاتف — الهاتف يكتبه المهاجم كما يشاء، ورقم
 * الملف هو ما يجرّبه.
 */
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }

  const input = validatePortalLogin(body);
  if (!input.ok) return NextResponse.json({ message: input.message }, { status: 400 });

  try {
    const limit = await consumeLoginAttempt(`portal:${input.value.patientNumber}`, request.headers);
    if (!limit.allowed) {
      return NextResponse.json(
        { message: "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    const patient = await patientForPortal(input.value.patientNumber);
    const matched = patient
      && portalCredentialsMatch(patient, input.value.phone, input.value.patientNumber);
    if (!patient || !matched) {
      return NextResponse.json(
        { message: "البيانات غير مطابقة. تأكّد من رقم ملفك وجوالك المسجَّل في المركز." },
        { status: 401 },
      );
    }

    const token = createPortalToken({
      patientId: patient.id,
      patientNumber: patient.patientNumber,
      fullName: patient.fullName,
      expiresAt: Date.now() + PORTAL_DURATION_MS,
    });
    const response = NextResponse.json({ fullName: patient.fullName, patientNumber: patient.patientNumber });
    response.cookies.set(PORTAL_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: PORTAL_DURATION_MS / 1000,
    });
    return response;
  } catch {
    return NextResponse.json({ message: "تعذّر الدخول. حاول بعد قليل." }, { status: 500 });
  }
}
