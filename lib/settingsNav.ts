/**
 * تبويبات الإعدادات — في مكانٍ واحد.
 *
 * كانت القائمة مكتوبةً في كل صفحةٍ على حدة، فإضافةُ تبويبٍ تعني تعديل كل صفحة —
 * ونسيانُ واحدة يجعل التبويب يظهر من هنا ويختفي من هناك بلا سبب ظاهر.
 */
export interface SettingsTab {
  href: string;
  label: string;
  current?: boolean;
}

const TABS: SettingsTab[] = [
  { href: "/settings", label: "عام" },
  // الجاهزية أوّل ما يُفتح عند بدء التشغيل: تقول ما بقي قبل أن يُبدأ العمل.
  { href: "/settings/readiness", label: "جاهزية النظام" },
  { href: "/settings/users", label: "المستخدمون والصلاحيات" },
  { href: "/settings/lab", label: "أعمال المختبر وأسعارها" },
  { href: "/settings/ceph", label: "المعايير السيفالومترية" },
  { href: "/settings/audit", label: "سجل التدقيق" },
  { href: "/settings/export", label: "النسخ والتصدير" },
];

/** التبويبات مع تعليم الحالي — والمطابقة بالمسار لا بالاسم. */
export function settingsTabs(current: string): SettingsTab[] {
  return TABS.map((tab) => (tab.href === current ? { ...tab, current: true } : tab));
}
