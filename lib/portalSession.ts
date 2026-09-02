import { cookies } from "next/headers";
import { PORTAL_COOKIE, readPortalToken, type PortalPayload } from "./portal";

/**
 * جلسة البوابة على الخادم — بصلابة جلسة الطاقم لا أقلّ.
 *
 * والوسيط (`proxy.ts`) يُمرّر مسارات البوابة لأنها مفتوحة للمرضى بالتعريف، فالحارس
 * الحقيقي هنا: **كل مسار بوابةٍ يستدعي هذه قبل أي قراءة**. ونسيانُها في مسارٍ واحد
 * يكشف حساب مريضٍ لمن يعرف رقمه — ولذلك يفحص `verify:http` كل مسارٍ منها بلا كوكي.
 */
export async function requirePortalSession(): Promise<PortalPayload | null> {
  const store = await cookies();
  return readPortalToken(store.get(PORTAL_COOKIE)?.value);
}
