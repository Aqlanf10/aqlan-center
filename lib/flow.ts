/**
 * انسياب يوم العيادة — المنطق الخالص.
 *
 * هذه الأداة وُجدت لسبب واحد: مركز بكرسيين، والمرضى ينتظرون ساعات ولا أحد في العيادة
 * يعرف الرقم الحقيقي — كم واحدًا ينتظر، ومنذ متى، وهل الكرسي فارغ الآن. النظام الأساسي
 * يملك هذه القدرات لكنه لم يدخل الخدمة بعد، فهذه أداة مؤقتة مهمتها أن تُستخدم صباح الغد.
 *
 * الحساب هنا منفصل عن الواجهة لأنه الجزء الذي يجب أن يكون صحيحًا: وقت انتظار يُعرض أقل
 * من حقيقته بخمس دقائق أسوأ من عدم عرضه أصلًا — لأنه يقول لموظفة الاستقبال إن المريض
 * الجالس أمامها ليس منتظرًا فعلًا.
 */

export type VisitStatus = "waiting" | "in_chair" | "done";

export interface Visit {
  id: number;
  patientName: string;
  patientPhone: string | null;
  note: string | null;
  status: VisitStatus;
  chair: number | null;
  arrivedAt: string;
  seatedAt: string | null;
  finishedAt: string | null;
}

/** بعد هذا الحد يكون المريض قد لاحظ الانتظار. */
export const WAIT_WARNING_MINUTES = 15;
/** وبعد هذا الحد صار يحكي عنه لغيره. */
export const WAIT_CRITICAL_MINUTES = 30;

export type WaitLevel = "calm" | "warning" | "critical";

export function waitLevel(minutes: number): WaitLevel {
  if (minutes >= WAIT_CRITICAL_MINUTES) return "critical";
  if (minutes >= WAIT_WARNING_MINUTES) return "warning";
  return "calm";
}

/**
 * الدقائق المنقضية منذ لحظة، وأدناها صفر.
 *
 * الطوابع الزمنية كلها UTC، والفرق بين لحظتين لا يحمل منطقة زمنية — فهذا الحساب الوحيد
 * في الأداة الذي لا يستطيع فارق توقيت اليمن (UTC+3) أن يفسده. وإن سبق ختمُ الوقت الساعةَ
 * لانحراف بسيط في ساعة الجهاز، يُقرأ صفرًا لا رقمًا سالبًا.
 */
export function minutesSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now.getTime() - started) / 60_000));
}

export interface WaitingRow {
  visit: Visit;
  waitedMinutes: number;
  level: WaitLevel;
}

/**
 * المنتظرون مرتبين بالأطول انتظارًا أولًا — وهو ترتيب النداء الصحيح.
 *
 * الترتيب بالأطول انتظارًا لا بوقت الوصول يعطي النتيجة نفسها اليوم، لكنه يبقى صحيحًا
 * لو أُضيف مريض بأثر رجعي بوقت وصول أقدم — وهو ما يحدث فعلًا حين تُدخل الاستقبال
 * مريضًا تأخرت في تسجيله.
 */
export function waitingRows(visits: Visit[], now: Date): WaitingRow[] {
  return visits
    .filter((visit) => visit.status === "waiting")
    .map((visit) => {
      const waitedMinutes = minutesSince(visit.arrivedAt, now);
      return { visit, waitedMinutes, level: waitLevel(waitedMinutes) };
    })
    .sort((a, b) => b.waitedMinutes - a.waitedMinutes);
}

export interface ChairRow {
  chair: number;
  occupant: Visit | null;
  busyMinutes: number;
}

/**
 * حالة كل كرسي، مشغولًا كان أو فارغًا.
 *
 * الكراسي تأتي من عددها المُهيّأ لا ممن يجلس عليها، حتى يظهر الكرسي الفارغ كفارغ. وهذا
 * هو بيت القصيد حين يكون هناك منتظرون: كرسي شاغر لم ينتبه إليه أحد هو أرخص دقيقة
 * يمكن استرجاعها في العيادة.
 */
export function chairRows(chairCount: number, visits: Visit[], now: Date): ChairRow[] {
  const seated = visits.filter((visit) => visit.status === "in_chair");
  return Array.from({ length: chairCount }, (_, index) => {
    const chair = index + 1;
    const occupant = seated.find((visit) => visit.chair === chair) ?? null;
    return { chair, occupant, busyMinutes: occupant ? minutesSince(occupant.seatedAt, now) : 0 };
  });
}

/** أول كرسي فارغ، أو null إن كان الكرسيان مشغولين. */
export function firstFreeChair(chairCount: number, visits: Visit[]): number | null {
  const taken = new Set(
    visits.filter((visit) => visit.status === "in_chair").map((visit) => visit.chair),
  );
  for (let chair = 1; chair <= chairCount; chair += 1) {
    if (!taken.has(chair)) return chair;
  }
  return null;
}

export interface DaySummary {
  waiting: number;
  inChair: number;
  done: number;
  longestWaitMinutes: number;
  freeChairs: number;
}

export function daySummary(chairCount: number, visits: Visit[], now: Date): DaySummary {
  const waiting = waitingRows(visits, now);
  const inChair = visits.filter((visit) => visit.status === "in_chair").length;
  return {
    waiting: waiting.length,
    inChair,
    done: visits.filter((visit) => visit.status === "done").length,
    longestWaitMinutes: waiting[0]?.waitedMinutes ?? 0,
    freeChairs: Math.max(0, chairCount - inChair),
  };
}
