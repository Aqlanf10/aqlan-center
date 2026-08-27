import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSettingsSafe } from "@/lib/db";
import { publicSubset } from "@/lib/settings";
import { SettingsProvider } from "@/components/SettingsProvider";
import { SessionProvider } from "@/components/SessionProvider";
import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "عيادة عقلان — نظام إدارة المركز",
  description: "تشغيل يومي: الانتظار والمواعيد والمرضى والمختبر والمالية.",
};

// اللوحة تُفتح على شاشة الاستقبال وعلى الهاتف معًا، فالتكبير يبقى متاحًا عمدًا:
// منعه يجعل الأرقام الصغيرة غير مقروءة لمن يحتاج تكبيرها.
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * التخطيط الجذري يقرأ الإعدادات مرة لكل طلب ويمرّرها إلى الشجرة كلها.
 *
 * وهو `dynamic` لهذا السبب: صفحاتٌ ساكنة كانت ستُخبز باسم المركز القديم وقت البناء
 * ولا تتغيّر حتى النشرة التالية — وهذا بالضبط ما تُلغيه شاشة الإعدادات.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, session] = await Promise.all([
    getSettingsSafe(),
    // الجلسة قد تكون غائبة — صفحة الدخول والشاشات العامة تُصيَّر بلا واحدة.
    requireSession().catch(() => null),
  ]);

  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-full text-navy-900 antialiased">
        <SettingsProvider value={publicSubset(settings)}>
          <SessionProvider value={session ? { username: session.username, role: session.role } : null}>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
