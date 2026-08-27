import type { SettingsMap } from "@/lib/settings";

/**
 * ترويسة المستندات المطبوعة.
 *
 * هوية المركز من الإعدادات لا من الكود — قرار المالك أن يحمل كل تقرير اسم المركز
 * كاملًا واسم الطبيب وتخصصه ومؤهله. ولأنها من الإعدادات، تغييرها لا يحتاج نشرة.
 */
export function PrintHeader({ settings, title, compact = false }: {
  settings: SettingsMap;
  title: string;
  compact?: boolean;
}) {
  return (
    <header>
      <div style={{ textAlign: "center" }}>
        <p className="clinic-name">{settings["clinic.name"]}</p>
        <p className="clinic-sub">
          {settings["clinic.lead_doctor"]} — {settings["clinic.lead_doctor_title"]}
        </p>
        {!compact ? (
          <p className="clinic-sub">{settings["clinic.lead_doctor_credentials"]}</p>
        ) : null}
      </div>
      <div className="rule" />
      <p className="doc-title" style={{ textAlign: "center" }}>{title}</p>
    </header>
  );
}

export function PrintFooter({ settings }: { settings: SettingsMap }) {
  return (
    <>
      <div className="rule-light" />
      {/* الهاتف بـ`dir="ltr"`: رقمٌ مثل «04-253028» داخل نصّ عربي يُقلب إلى
          «253028-04» بقواعد الاتجاه الثنائي، فيُطبع رقم خاطئ على كل سند. */}
      <p className="footer-note" style={{ textAlign: "center" }}>
        {settings["clinic.address"]} · هاتف: <span dir="ltr">{settings["clinic.phone"]}</span>
      </p>
    </>
  );
}
