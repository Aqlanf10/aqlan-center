import { NextResponse } from "next/server";
import { PORTAL_COOKIE } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** الخروج: الكوكي يُمحى — ولا يُنتظر انتهاؤه على جهازٍ قد لا يكون لصاحبه. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
