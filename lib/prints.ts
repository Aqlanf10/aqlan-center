import { canHandleMoney, canTreat, isRole } from "./roles";

/**
 * أنواع المستندات التي تُسجَّل طبعاتها — في مكانٍ واحد.
 *
 * كانت القائمة مكتوبةً مرّتين: في مسار التسجيل على الخادم وفي زرّ الطباعة. ونوعٌ
 * يُضاف إلى إحداهما دون الأخرى يُنتج زرًّا يطبع ولا يُسجَّل — أو مسارًا يرفض ما
 * ترسله الشاشة. والتسجيل هو ما يجعل «نسخة معاد طباعتها» تظهر على الورقة الثانية.
 */
export const PRINTABLE_DOCS =
  ["receipt", "invoice", "voucher", "statement", "ceph", "ceph-compare", "prescription",
   "patient-card"] as const;

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
/**
 * وثالثةٌ ليست مالًا ولا تشخيصًا: **بطاقة المريض**.
 *
 * الاستقبال تطبعها عند التسجيل، والطبيب قد يطبعها في الكرسي، والمدير كذلك. وليس
 * فيها مبلغٌ ولا تشخيص — فيها اسمُ المريض ورقمُ ملفّه وموعدُه القادم، وهي ثلاثةٌ
 * يراها الثلاثة أصلًا في شاشة المريض. فحصرُها في «المال» يمنع الطبيب، وحصرُها في
 * «السريري» يمنع الاستقبال — وهي عملُ الاستقبال أوّلًا.
 */
export const PRINT_AUDIENCES = ["money", "clinical", "front-desk"] as const;

export type PrintAudience = (typeof PRINT_AUDIENCES)[number];

export const PRINT_AUDIENCE: Record<PrintableDoc, PrintAudience> = {
  receipt: "money",
  invoice: "money",
  voucher: "money",
  statement: "money",
  ceph: "clinical",
  "ceph-compare": "clinical",
  prescription: "clinical",
  "patient-card": "front-desk",
};

/**
 * أيملك هذا الدور طباعة هذا المستند؟
 *
 * والجواب هنا هو نفسه الذي تعطيه الصفحة عند فتحها: المالية للإدارة والاستقبال،
 * والسريرية للطبيب والمدير. ومسارٌ يجيب غير ما تجيب صفحتُه يُنتج زرًّا يطبع ولا
 * يُسجَّل — وهو ما كان.
 */
export function canPrintDoc(role: string | undefined | null, doc: PrintableDoc): boolean {
  const audience = PRINT_AUDIENCE[doc];
  if (audience === "clinical") return canTreat(role);
  if (audience === "money") return canHandleMoney(role);
  // ولا يعني «للجميع» أنّ لمن لا دور له: الدور يُتحقّق منه لا يُفترض.
  return isRole(role);
}
