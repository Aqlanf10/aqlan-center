/**
 * مُنتظَرو اليوم — من حجز ولم يصل بعد.
 *
 * شاشةُ العمليات اليومية كانت **لا تعرف مواعيد اليوم إطلاقًا**. فمريضٌ حجز قبل
 * شهرٍ يقف أمام الاستقبال، فتُكتب اسمُه من جديد ويُنتظر البحث ويُختار من
 * المتشابهين — والطابور خلفه. والقدرة موجودة في الخادم منذ بُنيت المواعيد
 * (`arriveAppointment` تفتح الزيارة في معاملة واحدة)، لكنّها في شاشةٍ أخرى:
 * فتنتقل الاستقبال بين شاشتين في أزحم لحظة، أو لا تنتقل فتكتب باليد.
 *
 * **والقائمة مشتقّة لا محفوظة**: من وصل تنقلب حالة موعده إلى `arrived` فيسقط من
 * هنا وحده. ولو كانت عمودًا يُصان لبقي مريضٌ في «المنتظَرين» بعد جلوسه على
 * الكرسي، ولا شيء يكشف ذلك إلّا عينُ من يقرأ.
 */

import { toMinutes, type Appointment } from "./schedule";

export interface ExpectedArrival {
  appointmentId: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  scheduledTime: string;
  /** كم دقيقة مضت على موعده — وصفرٌ لمن لم يحن وقته بعد. */
  lateMinutes: number;
  /** أأكّد حضوره من البوّابة؟ — يُعرض ولا يُغني عن تسجيل الوصول. */
  confirmed: boolean;
}

/**
 * من يُنتظَر الآن، مرتّبين بوقت موعدهم.
 *
 * **و`booked` وحدها تُنتظَر.** فمن وصل له صفٌّ في اللوحة، والملغى ومن لم يحضر
 * قد فُصل فيهما. وعرضُ أيٍّ من هؤلاء هنا يجعل الاستقبال تضغط «حضر» على من هو
 * جالسٌ على الكرسي أصلًا.
 *
 * و`nowTime` بساعة العيادة (`clinicTimeString`) لا بساعة الخادم: التأخّر محسوبٌ
 * بالفرق بينها وبين وقت الموعد، وساعةُ غرينتش تقول عن مريضٍ في موعده إنّه
 * تأخّر ثلاث ساعات.
 */
export function expectedArrivals(
  appointments: readonly Appointment[],
  nowTime: string,
): ExpectedArrival[] {
  const now = toMinutes(nowTime);
  return appointments
    .filter((one) => one.status === "booked")
    .map((one) => {
      const at = toMinutes(one.scheduledTime);
      return {
        appointmentId: one.id,
        patientId: one.patientId,
        patientName: one.patientName,
        patientPhone: one.patientPhone,
        scheduledTime: one.scheduledTime,
        // ولا تأخّرَ بالسالب: موعدُ العصر ليس «متأخّرًا سالبَ مئتي دقيقة» صباحًا.
        lateMinutes: now === null || at === null ? 0 : Math.max(0, now - at),
        confirmed: Boolean(one.patientConfirmedAt),
      };
    })
    // والترتيب بالوقت لا برقم الحجز: من حجز أمس لموعد التاسعة قبل من حجز
    // الأسبوع الماضي لموعد الحادية عشرة — والاستقبال تقرأ الطابور بالساعة.
    .sort((one, two) => one.scheduledTime.localeCompare(two.scheduledTime) || one.appointmentId - two.appointmentId);
}

/** بعد هذا الحدّ يصير التأخّر ظاهرًا يستحقّ اتصالًا. */
export const LATE_MINUTES = 15;

export const isLate = (arrival: ExpectedArrival): boolean => arrival.lateMinutes >= LATE_MINUTES;
