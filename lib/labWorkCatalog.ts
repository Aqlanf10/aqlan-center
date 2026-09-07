/**
 * كتالوجُ أعمال معامل الأسنان — قائمةٌ معروفةٌ في المهنة، **بلا أسعار**.
 *
 * طلبها المالك: «الكتالوج المفروض انت تبنيه لانه اشغال معامل الاسنان معروفه
 * وانا بحدد الاسعار تبعه». وهو الفصل الصحيح: **ما تعمله المعامل معروفٌ عالميًّا،
 * وما تتقاضاه اتفاقُ كلِّ مركزٍ مع كلِّ معمل** — ولا رقم هنا، ولا افتراضَ سعر.
 *
 * وقيمةُ الكتالوج ليست الاختصار: هي **توحيدُ التسمية**. فبلا قائمةٍ يُكتب العمل
 * نصًّا حرًّا، فيصير «زيركون» و«زركون» وZirconia ثلاثةَ أعمال في التقارير، ولا
 * يُعرف كم صُرف على الزيركون هذا العام ولا أيُّ معملٍ أرخص فيه.
 *
 * **والوحدة سنٌّ واحد لا حالة**: «وحدة جسر» لا «جسر»، فالجسر ثلاث وحداتٍ أو
 * خمس، وسعرُ «جسرٍ» واحدٍ لا معنى له. وهكذا تُسعَّر المعامل فعلًا.
 *
 * والمهلُ هنا **مُقترَحة تُعدَّل**: معملٌ في تعز غير معملٍ يُشحن إليه.
 */

import type { LabCategory, ServiceDraft } from "./labCatalog";

export interface LabWorkEntry extends ServiceDraft {
  category: LabCategory;
}

/**
 * القائمة — مرتّبةً كما تُقرأ: التركيبات الثابتة، ثم ما على الزرعات، ثم
 * المتحرّكة، ثم التقويم، ثم الجراحي، ثم ما سواه.
 *
 * و`requiresShade` ليست تفصيلًا شكليًّا: عملٌ بلون سنٍّ أُرسل بلا لونٍ يعود
 * ليُعاد، فتضيع أسبوعٌ ومريضٌ ينتظر. وجهازُ تقويمٍ لا لونَ له، فسؤالُه عنه
 * حقلٌ فارغٌ يُملأ عبثًا كلَّ مرّة.
 */
export const LAB_WORK_CATALOG: readonly LabWorkEntry[] = [
  // ── تيجان ثابتة ──
  { name: "تاج زيركون", category: "prostho", defaultDays: 5, requiresShade: true, sortOrder: 10 },
  { name: "تاج زيركون طبقي", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 11 },
  { name: "تاج إيماكس", category: "prostho", defaultDays: 6, requiresShade: true, sortOrder: 12 },
  { name: "تاج خزف على معدن", category: "prostho", defaultDays: 6, requiresShade: true, sortOrder: 13 },
  { name: "تاج معدني كامل", category: "prostho", defaultDays: 5, requiresShade: false, sortOrder: 14 },
  { name: "تاج مؤقت أكريل", category: "prostho", defaultDays: 2, requiresShade: true, sortOrder: 15 },
  { name: "تاج أطفال معدني", category: "prostho", defaultDays: 3, requiresShade: false, sortOrder: 16 },

  // ── وحدات الجسور — والوحدة سنٌّ لا جسر ──
  { name: "وحدة جسر زيركون", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 20 },
  { name: "وحدة جسر خزف على معدن", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 21 },
  { name: "جسر ماريلاند", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 22 },

  // ── قشور وحشوات غير مباشرة ──
  { name: "قشرة إيماكس", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 30 },
  { name: "قشرة زيركون", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 31 },
  { name: "حشوة غير مباشرة إنلاي/أونلاي", category: "prostho", defaultDays: 6, requiresShade: true, sortOrder: 32 },
  { name: "وتد مصبوب", category: "prostho", defaultDays: 4, requiresShade: false, sortOrder: 33 },

  // ── على الزرعات ──
  { name: "تاج على زرعة — مثبّت بالبرغي", category: "prostho", defaultDays: 8, requiresShade: true, sortOrder: 40 },
  { name: "تاج على زرعة — مثبّت بالإسمنت", category: "prostho", defaultDays: 8, requiresShade: true, sortOrder: 41 },
  { name: "دعامة مخصّصة للزرعة", category: "prostho", defaultDays: 8, requiresShade: false, sortOrder: 42 },
  { name: "وحدة جسر على زرعات", category: "prostho", defaultDays: 10, requiresShade: true, sortOrder: 43 },
  { name: "طقم متحرك على زرعات", category: "prostho", defaultDays: 14, requiresShade: true, sortOrder: 44 },
  { name: "دليل جراحي للزراعة", category: "surgical", defaultDays: 5, requiresShade: false, sortOrder: 45 },

  // ── الأطقم ──
  { name: "طقم كامل أكريل — فك واحد", category: "prostho", defaultDays: 14, requiresShade: true, sortOrder: 50 },
  { name: "طقم جزئي أكريل", category: "prostho", defaultDays: 10, requiresShade: true, sortOrder: 51 },
  { name: "طقم جزئي كروم كوبالت", category: "prostho", defaultDays: 14, requiresShade: true, sortOrder: 52 },
  { name: "طقم مرن", category: "prostho", defaultDays: 10, requiresShade: true, sortOrder: 53 },
  { name: "طقم فوري", category: "prostho", defaultDays: 7, requiresShade: true, sortOrder: 54 },
  { name: "تبطين طقم", category: "prostho", defaultDays: 3, requiresShade: false, sortOrder: 55 },
  { name: "إصلاح طقم مكسور", category: "prostho", defaultDays: 2, requiresShade: false, sortOrder: 56 },
  { name: "إضافة سن إلى طقم", category: "prostho", defaultDays: 3, requiresShade: true, sortOrder: 57 },

  // ── التقويم ──
  { name: "مثبّت شفاف", category: "ortho", defaultDays: 4, requiresShade: false, sortOrder: 60 },
  { name: "مثبّت هاولي", category: "ortho", defaultDays: 5, requiresShade: false, sortOrder: 61 },
  { name: "مثبّت ثابت خلف الأسنان", category: "ortho", defaultDays: 4, requiresShade: false, sortOrder: 62 },
  { name: "جهاز تقويم متحرك", category: "ortho", defaultDays: 7, requiresShade: false, sortOrder: 63 },
  { name: "موسّع حنك ثابت", category: "ortho", defaultDays: 7, requiresShade: false, sortOrder: 64 },
  { name: "قوس عبر حنكي", category: "ortho", defaultDays: 6, requiresShade: false, sortOrder: 65 },
  { name: "قوس لساني سفلي", category: "ortho", defaultDays: 6, requiresShade: false, sortOrder: 66 },
  { name: "جهاز نانس", category: "ortho", defaultDays: 6, requiresShade: false, sortOrder: 67 },
  { name: "جهاز وظيفي — توين بلوك", category: "ortho", defaultDays: 10, requiresShade: false, sortOrder: 68 },
  { name: "حافظ مسافة", category: "ortho", defaultDays: 5, requiresShade: false, sortOrder: 69 },
  { name: "سلسلة قوالب تقويم شفاف", category: "ortho", defaultDays: 21, requiresShade: false, sortOrder: 70 },

  // ── ما سوى ذلك ──
  { name: "واقي ليلي لصرير الأسنان", category: "other", defaultDays: 5, requiresShade: false, sortOrder: 80 },
  { name: "واقي رياضي", category: "other", defaultDays: 5, requiresShade: false, sortOrder: 81 },
  { name: "قوالب تبييض منزلي", category: "other", defaultDays: 3, requiresShade: false, sortOrder: 82 },
  { name: "نموذج دراسي", category: "other", defaultDays: 3, requiresShade: false, sortOrder: 83 },
];

/** الاسمُ كما يُقارَن — كفهرس القاعدة الفريد: بلا حالةِ حرفٍ ولا فراغٍ طرفيّ. */
export const workKey = (name: string): string => name.trim().toLowerCase();

export interface ImportPlan {
  /** ما سيُضاف. */
  missing: LabWorkEntry[];
  /** ما هو مسجَّلٌ بالفعل — يُقال عددُه ولا يُلمس. */
  presentCount: number;
}

/**
 * ماذا ينقص من الكتالوج في القاعدة.
 *
 * **وما هو مسجَّلٌ لا يُمسّ**: قد يكون المالك عدّل مهلته أو صنّفه، وإعادةُ
 * الاستيراد فوقه تمحو تعديله. والاستيراد يُضيف الناقص وحده، فيصلح تشغيلُه
 * مرّتين ولا يُنشئ نسخةً ثانية.
 *
 * والمقارنة بالاسم المُطبَّع لا بالنصّ الخام: «تاج زيركون» و«تاج زيركون » عملٌ
 * واحد، والفهرس الفريد في القاعدة يراهما كذلك — فلو قورن هنا بالخام لبدا
 * الاسم ناقصًا ثم سقط الإدراج عند الفهرس.
 */
export function importPlan(
  existingNames: readonly string[],
  catalog: readonly LabWorkEntry[] = LAB_WORK_CATALOG,
): ImportPlan {
  const present = new Set(existingNames.map(workKey));
  const missing = catalog.filter((entry) => !present.has(workKey(entry.name)));
  return { missing, presentCount: catalog.length - missing.length };
}
