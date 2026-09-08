/**
 * مواعيدُ مضت ولم تُغلَق — الثغرةُ التي يتراكم فيها الغياب.
 *
 * موعدٌ يمرّ يومُه ولا يُسجَّل وصولُ صاحبه ولا غيابُه يبقى `booked` **إلى الأبد**:
 *
 * - ليس في قائمة اليوم، فتاريخُه مضى.
 * - وليس في المتابعة، فهي تختار `no_show` وحدها.
 * - ولا شيء في النظام يغيّر حالته.
 *
 * فالمريض الذي لم يحضر **لا يتّصل به أحد أبدًا** — وهو بعينه ما خافه المالك:
 * «بدي تتشوه سمعتنا أنه ما في أي اهتمام ولا تواصل». والغيابُ لا يُعدّ في تقرير،
 * فلا يُعرف كم موعدًا يضيع في الشهر.
 *
 * **ولا يُخمَّن الجواب.** فقلبُ هذه المواعيد إلى «لم يحضر» تلقائيًّا يزعم عن
 * مريضٍ ربّما حضر وعُولج ونُسي تسجيله أنّه تغيّب — ثمّ يُتّصل به ليُسأل عن
 * غيابٍ لم يقع. والنظام لا يعرف أيّهما وقع؛ **يعرف أنّ أحدًا لم يقرّر**، فيقول
 * ذلك ويطلب القرار.
 */

import type { Appointment } from "./schedule";

/**
 * إلى كم يومًا يُنظر إلى الوراء بحثًا عن معلّق.
 *
 * ومن مضى على موعده أكثرُ من ذلك لم يعد استدعاؤه متابعةً بل مبيعات — وقرارُه
 * للمالك في تقريرٍ لا في طابور عمل اليوم. والحدُّ يمنع أيضًا مسحًا لا نهاية له
 * على قاعدةٍ تكبر كل يوم.
 */
export const OPEN_LOOKBACK_DAYS = 60;

export interface OpenAppointment {
  appointmentId: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  scheduledDate: string;
  scheduledTime: string;
  /** كم يومًا مضى على موعده — والأقدم أولى بالقرار. */
  daysAgo: number;
}

/** فرقُ الأيام بين تاريخين `YYYY-MM-DD` — حسابٌ تقويميّ بحت بلا مناطق زمنية. */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  };
  const start = parse(from);
  const end = parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/**
 * المواعيد التي مضت ولم يُفصل فيها.
 *
 * **ومواعيدُ اليوم ليست منها**: يومُها لم ينتهِ بعد، وصاحبُها قد يصل بعد ساعة.
 * وعرضُها هنا يجعل الاستقبال تُغلق موعدًا لمريضٍ في الطريق — وهي في الوقت نفسه
 * معروضةٌ في «مُنتظَرون اليوم» على شاشة العمليات، فيُطلب القرار مرّتين.
 */
export function openAppointments(
  appointments: readonly Appointment[],
  today: string,
): OpenAppointment[] {
  return appointments
    .filter((one) => one.status === "booked" && one.scheduledDate < today)
    .map((one) => ({
      appointmentId: one.id,
      patientId: one.patientId,
      patientName: one.patientName,
      patientPhone: one.patientPhone,
      scheduledDate: one.scheduledDate,
      scheduledTime: one.scheduledTime,
      daysAgo: daysBetween(one.scheduledDate, today),
    }))
    // والأقدم أوّلًا: من غاب منذ أسبوعين أولى بمكالمةٍ ممّن غاب أمس.
    .sort((one, two) => one.scheduledDate.localeCompare(two.scheduledDate)
      || one.scheduledTime.localeCompare(two.scheduledTime)
      || one.appointmentId - two.appointmentId);
}
