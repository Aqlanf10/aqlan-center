/**
 * خدمات المختبر وأسعارها — **كتالوجٌ يُدار، لا قائمةٌ في الكود.**
 *
 * كانت أنواع العمل تسعةً مكتوبةً في `WORK_TYPES`: تاجٌ وجسرٌ وطقم. وكلُّ عملٍ
 * لا يشبهها يُكتب نصًّا حرًّا، فيصير «زيركون» و«زركون» و«Zirconia» ثلاثةَ
 * أعمال في التقارير، ولا يُعرف كم صُرف على الزيركون هذا العام.
 *
 * والأهمّ: **لكلّ مختبرٍ سعرُه، والسعرُ يتغيّر.** فالمركز يتّفق مع مختبرٍ على
 * تاجٍ بكذا، ثم يرفع المختبر سعره في رمضان. وبلا قائمة أسعار:
 *
 * - تُكتب التكلفة من الذاكرة في كل أمر، فتختلف عن المتّفق ولا أحد يلاحظ.
 * - ولا يُعرف **متى** تغيّر السعر، فتُراجَع فاتورة الشهر الماضي بسعر اليوم.
 *
 * فالسعر هنا **بتاريخ سريان**: ما كان ساريًا يوم أُرسل العمل هو سعره، ورفعُ
 * السعر اليوم لا يغيّر أمرًا أُرسل الشهر الماضي.
 */

import { addDays } from "./schedule";

/** تصنيف العمل — يُجمَع به في التقارير. */
export const LAB_CATEGORIES = ["prostho", "ortho", "surgical", "other"] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

export const LAB_CATEGORY_LABEL: Record<LabCategory, string> = {
  prostho: "تركيبات",
  ortho: "تقويم",
  surgical: "جراحي",
  other: "أخرى",
};

export function isLabCategory(value: unknown): value is LabCategory {
  return typeof value === "string" && (LAB_CATEGORIES as readonly string[]).includes(value);
}

export interface LabService {
  id: number;
  name: string;
  category: LabCategory;
  /** المهلة المعتادة لهذا العمل بالأيام — تُقترح عند الإنشاء. */
  defaultDays: number;
  /** أيلزم لونٌ للسنّ؟ تاجٌ نعم، وجهازُ تقويمٍ لا. */
  requiresShade: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** سعرٌ متّفق عليه مع مختبرٍ لخدمةٍ، من تاريخٍ إلى تاريخ. */
export interface LabPrice {
  id: number;
  partyId: number;
  serviceId: number;
  costMinor: number;
  currency: string;
  /** أوّل يومٍ يسري فيه — `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** آخر يوم، أو `null` إن كان ساريًا إلى الآن. */
  effectiveTo: string | null;
}

/**
 * السعر الساري يوم كذا.
 *
 * ويُختار **الأحدث سريانًا** ممّا يشمل ذلك اليوم: قوائم الأسعار تتراكم، وقاعدةٌ
 * قديمة نُسي إغلاقها تبقى مفتوحة إلى الأبد. فالأحدث هو المتّفق عليه، والأقدم
 * تاريخ.
 *
 * ويُردّ `null` حين لا سعر — ولا يُخترع صفر: صفرٌ يعني «مجّانًا» في الحساب،
 * فيظهر عملُ مختبرٍ بلا تكلفة وتظهر العيادة رابحة وهي مدينة.
 */
export function priceOn(
  prices: readonly LabPrice[],
  partyId: number,
  serviceId: number,
  onDate: string,
): LabPrice | null {
  let best: LabPrice | null = null;
  for (const price of prices) {
    if (price.partyId !== partyId || price.serviceId !== serviceId) continue;
    if (price.effectiveFrom > onDate) continue;
    if (price.effectiveTo !== null && price.effectiveTo < onDate) continue;
    if (!best || price.effectiveFrom > best.effectiveFrom
      // وعند تساوي يوم السريان يُؤخذ الأحدث إدخالًا — تصحيحٌ كُتب بعد خطأ.
      || (price.effectiveFrom === best.effectiveFrom && price.id > best.id)) {
      best = price;
    }
  }
  return best;
}

export type PriceCheck =
  | { ok: true }
  | { ok: false; message: string };

/**
 * أيتعارض سعرٌ جديد مع القائم؟
 *
 * ومدّتان متداخلتان لخدمةٍ واحدة عند مختبرٍ واحد تجعلان للسعر جوابين في يومٍ
 * واحد. والقراءة تختار أحدهما بقاعدةٍ داخلية لا يعرفها من أدخل، فيُحاسَب
 * المختبر بسعرٍ لم يتّفق عليه ولا يُفهم من أين جاء.
 */
export function overlaps(
  existing: readonly LabPrice[],
  candidate: { partyId: number; serviceId: number; effectiveFrom: string; effectiveTo: string | null; id?: number },
): PriceCheck {
  if (candidate.effectiveTo !== null && candidate.effectiveTo < candidate.effectiveFrom) {
    return { ok: false, message: "تاريخ نهاية السريان قبل بدايته." };
  }
  for (const price of existing) {
    if (price.partyId !== candidate.partyId || price.serviceId !== candidate.serviceId) continue;
    if (candidate.id !== undefined && price.id === candidate.id) continue;
    const startsAfterOther = candidate.effectiveFrom > (price.effectiveTo ?? "9999-12-31");
    const endsBeforeOther = (candidate.effectiveTo ?? "9999-12-31") < price.effectiveFrom;
    if (!startsAfterOther && !endsBeforeOther) {
      return {
        ok: false,
        message: `يتداخل مع سعرٍ ساري من ${price.effectiveFrom}`
          + `${price.effectiveTo ? ` إلى ${price.effectiveTo}` : " وما زال"}`
          + " — أغلق القديم أوّلًا.",
      };
    }
  }
  return { ok: true };
}

/**
 * خطّة استبدال سعرٍ نافذ: أيُّ الأسعار يُغلق ليبدأ الجديد من يومه.
 *
 * **وهذا أشيع ما يقع في الوحدة**: يرفع المختبر سعره فيُسجَّل اليوم. والحدود
 * شاملة في الطرفين، فإغلاق القديم اليوم وبدء الجديد اليوم يجعلان يومًا واحدًا
 * له سعران — وهو ما يمنعه `overlaps` بحقّ. فكان المالك يُردّ «يتداخل» في أشيع
 * سير عملٍ عنده، ولا سبيل في الشاشة لإغلاق القديم أمس.
 *
 * فالإغلاق **في اليوم السابق لبدء الجديد**: يوم ينتهي ويوم يبدأ، ولا يضيع
 * تاريخ القديم — يبقى صفُّه بتاريخ بدايته، وأوامرُ مدّته تُقرأ بسعرها.
 *
 * ولا يُغلق إلّا ما بدأ **قبل** الجديد: سعرٌ يبدأ في يومه أو بعده لا يُغلق في
 * يومٍ سابقٍ لبدايته — لأنّ ذلك يجعل نهايته قبل بدايته، والقيد في القاعدة
 * يمنعه. فيُردّ `blocking` ليُقال للمستعمِل أيُّ سعرٍ منع، لا «تعذّر الحفظ».
 */
export function planReplacement(
  existing: readonly LabPrice[],
  candidate: { partyId: number; serviceId: number; effectiveFrom: string; effectiveTo: string | null },
): { closeIds: number[]; closeOn: string; remaining: LabPrice[]; blocking: LabPrice | null } {
  const closeOn = addDays(candidate.effectiveFrom, -1);
  const closeIds: number[] = [];
  const remaining: LabPrice[] = [];
  let blocking: LabPrice | null = null;

  for (const price of existing) {
    const samePair = price.partyId === candidate.partyId && price.serviceId === candidate.serviceId;
    // ما لا يتداخل يبقى كما هو: الاستبدال يمسّ الساري لا كلَّ تاريخ المختبر.
    const clashes = samePair
      && !(candidate.effectiveFrom > (price.effectiveTo ?? "9999-12-31"))
      && !((candidate.effectiveTo ?? "9999-12-31") < price.effectiveFrom);
    if (!clashes) { remaining.push(price); continue; }
    if (price.effectiveFrom <= closeOn) {
      closeIds.push(price.id);
      remaining.push({ ...price, effectiveTo: closeOn });
      continue;
    }
    if (!blocking) blocking = price;
    remaining.push(price);
  }

  return { closeIds, closeOn, remaining, blocking };
}

/**
 * الخدمة التي يعنيها الاسمُ المعروض في قائمة نوع العمل.
 *
 * ورقمُ الخدمة **يُشتقّ من المعروض ولا يُحفظ على حدة**: القائمة تعرض الكتالوج
 * أوّلًا والأنواع القديمة بعده، فحين يحمل الكتالوج قيمةً قديمة — «تاج» مثلًا —
 * يحلّ خيارُ الكتالوج محلّ القديم بالقيمة المعروضة نفسها، فلا يقع `onChange`.
 * فمن قبِل المعروض دون أن يلمسه أرسله نصًّا حرًّا: يضيع ربط الخدمة، ومقارنةُ
 * السعر المتّفق عليه، والمهلةُ الافتراضية — ولا يظهر شيءٌ من ذلك على الشاشة.
 */
export function serviceForWorkType<T extends { id: number; name: string }>(
  services: readonly T[], workType: string,
): T | null {
  return services.find((one) => one.name === workType) ?? null;
}

/**
 * الفرق بين المتّفق والمكتوب على الأمر.
 *
 * ولا يُمنع الاختلاف: قد يتّفق الطبيب على سعرٍ خاصّ لحالةٍ، أو يزيد المختبر
 * لعملٍ مركّب. وإنما **يُقال**: فرقٌ يمرّ بلا أن يُرى مرّةً يمرّ كلَّ مرّة،
 * وآخرُ الشهر يجد المالك فاتورةً لا تشبه ما اتّفق عليه.
 */
export function priceGap(
  agreedMinor: number | null, chargedMinor: number | null,
): { differs: boolean; deltaMinor: number } {
  if (agreedMinor === null || chargedMinor === null) return { differs: false, deltaMinor: 0 };
  const deltaMinor = chargedMinor - agreedMinor;
  return { differs: deltaMinor !== 0, deltaMinor };
}

const text = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export type ServiceDraft = {
  name: string; category: LabCategory; defaultDays: number;
  requiresShade: boolean; sortOrder: number;
};

export type ServiceCheck =
  | { ok: true; value: ServiceDraft }
  | { ok: false; message: string };

/** يقرأ خدمةً من طلبٍ غير موثوق ويقول لماذا تُرفض. */
export function readService(input: unknown): ServiceCheck {
  const source = (input ?? {}) as Record<string, unknown>;
  const name = text(source.name, 120);
  if (name.length < 2) return { ok: false, message: "اكتب اسم العمل." };

  const category = source.category;
  if (category !== undefined && !isLabCategory(category)) {
    return { ok: false, message: "تصنيف غير معروف." };
  }

  const days = Number(source.defaultDays ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 120) {
    return { ok: false, message: "المهلة بين يومٍ و120 يومًا." };
  }

  const sortOrder = Number(source.sortOrder ?? 100);
  if (!Number.isFinite(sortOrder)) return { ok: false, message: "ترتيب غير صالح." };

  return {
    ok: true,
    value: {
      name,
      category: isLabCategory(category) ? category : "prostho",
      defaultDays: days,
      requiresShade: source.requiresShade !== false,
      sortOrder: Math.trunc(sortOrder),
    },
  };
}
