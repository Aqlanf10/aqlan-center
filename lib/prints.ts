/**
 * أنواع المستندات التي تُسجَّل طبعاتها — في مكانٍ واحد.
 *
 * كانت القائمة مكتوبةً مرّتين: في مسار التسجيل على الخادم وفي زرّ الطباعة. ونوعٌ
 * يُضاف إلى إحداهما دون الأخرى يُنتج زرًّا يطبع ولا يُسجَّل — أو مسارًا يرفض ما
 * ترسله الشاشة. والتسجيل هو ما يجعل «نسخة معاد طباعتها» تظهر على الورقة الثانية.
 */
export const PRINTABLE_DOCS = ["receipt", "invoice", "voucher", "statement", "ceph"] as const;

export type PrintableDoc = (typeof PRINTABLE_DOCS)[number];

export function isPrintableDoc(value: unknown): value is PrintableDoc {
  return typeof value === "string" && (PRINTABLE_DOCS as readonly string[]).includes(value);
}
