import { canHandleMoney, canTreat } from "./roles";

/**
 * أنواع المستندات التي تُسجَّل طبعاتها — في مكانٍ واحد.
 *
 * كانت القائمة مكتوبةً مرّتين: في مسار التسجيل على الخادم وفي زرّ الطباعة. ونوعٌ
 * يُضاف إلى إحداهما دون الأخرى يُنتج زرًّا يطبع ولا يُسجَّل — أو مسارًا يرفض ما
 * ترسله الشاشة. والتسجيل هو ما يجعل «نسخة معاد طباعتها» تظهر على الورقة الثانية.
 */
export const PRINTABLE_DOCS =
  ["receipt", "invoice", "voucher", "statement", "ceph", "ceph-compare", "prescription"] as const;

export type PrintableDoc = (typeof PRINTABLE_DOCS)[number];

export function isPrintableDoc(value: unknown): value is PrintableDoc {
  return typeof value === "string" && (PRINTABLE_DOCS as readonly string[]).includes(value);
}

/**
 * من يطبع أيّ نوع — والصلاحية تتبع المستند لا العكس.
 *
 * وكان المسار يشترط صلاحية المال على **كل** الطبعات. وورقة السيفالو للطبيب
 * والمدير وحدهما — فالطبيب يفتحها ويضغط «اطبع»، فيردّه المسار ٤٠٣ ولا تُسجَّل
 * الطبعة. فلا تظهر «نسخة معاد طباعتها» على الطبعة الثانية أبدًا في الأوراق
 * التي هي أصلًا من اختصاصه، وتفقد العلامة معناها بصمت.
 */
export type PrintAudience = "money" | "clinical";

export const PRINT_AUDIENCE: Record<PrintableDoc, PrintAudience> = {
  receipt: "money",
  invoice: "money",
  voucher: "money",
  statement: "money",
  ceph: "clinical",
  "ceph-compare": "clinical",
  prescription: "clinical",
};

/**
 * أيملك هذا الدور طباعة هذا المستند؟
 *
 * والجواب هنا هو نفسه الذي تعطيه الصفحة عند فتحها: المالية للإدارة والاستقبال،
 * والسريرية للطبيب والمدير. ومسارٌ يجيب غير ما تجيب صفحتُه يُنتج زرًّا يطبع ولا
 * يُسجَّل — وهو ما كان.
 */
export function canPrintDoc(role: string | undefined | null, doc: PrintableDoc): boolean {
  return PRINT_AUDIENCE[doc] === "clinical" ? canTreat(role) : canHandleMoney(role);
}
