import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "انسياب العيادة — مركز الدكتور عقلان الكامل",
  description: "لوحة تشغيل يومي: من ينتظر، ومنذ متى، وهل الكرسي فارغ.",
};

// اللوحة تُفتح على شاشة الاستقبال وعلى الهاتف معًا، فالتكبير يبقى متاحًا عمدًا:
// منعه يجعل الأرقام الصغيرة غير مقروءة لمن يحتاج تكبيرها.
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-full text-navy-900 antialiased">{children}</body>
    </html>
  );
}
