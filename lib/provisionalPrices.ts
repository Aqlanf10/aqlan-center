/**
 * أسعارٌ تخمينية — **للتجربة وحدها، وتُوسَم بذلك في كل موضع تُرى فيه**.
 *
 * طلبها المالك ليبدأ التجربة قبل أن يُقرّ قائمته: «اعمل قائمة أسعار تخمينية انت
 * عشان نبدا نجرب وبعدين انا برجع اغيرها».
 *
 * **وخطرُها أنّها تعمل.** فسعرٌ مخترعٌ يُفوتر مريضًا حقيقيًّا بمبلغٍ لم يُقرّه أحد،
 * ولا شيء في الفاتورة يقول إنّه تخمين. فلا تُحفظ كسعرٍ عاديّ: تُوسَم
 * `price_provisional`، وتقول شاشةُ الأسعار «تخميني» بجانب كلٍّ منها، وتُنبّه شاشةُ
 * الجاهزية عليها بعددها ما بقيت. **وتعديلُ السعر بيد المالك يمسح الوسم** — لأنّه
 * حينها قرارُه هو لا تخميني.
 *
 * والأرقام بالريال اليمني، **وهي تقديرٌ منّي لا قائمةُ سوقٍ ولا سعرُ هذا المركز**.
 * بُنيت على ترتيبٍ نسبيّ معقول (كشفٌ أرخص من حشوة، وحشوةٌ أرخص من عصب، وعصبٌ أرخص
 * من تاج، وزراعةٌ أعلاها) لا على مسحٍ للأسعار. فالنسب بينها أقربُ إلى الصواب من
 * قيمها المطلقة، والمالك يستبدلها.
 */

/** السعر التخميني بالريال اليمني لكل رمزٍ في دليل الأعمال. */
export const PROVISIONAL_PRICES: Record<string, number> = {
  // الكشف والاستشارة
  exam: 3_000, consult: 5_000, comprehensive_exam: 8_000,
  // الأشعة والتوثيق
  periapical: 2_000, bitewing: 2_000, panorama: 6_000, ceph: 6_000,
  cbct: 25_000, scan: 15_000, photos: 3_000,
  // الحشوات والبناء
  composite: 12_000, glass_ionomer: 9_000, temporary: 4_000, core: 15_000,
  inlay: 35_000, filling_repair: 6_000,
  // علاج العصب
  rct: 30_000, rct_anterior: 25_000, rct_premolar: 30_000, rct_molar: 40_000,
  rct_retreatment: 50_000, pulp_cap: 8_000,
  // الأوتاد
  post: 12_000, metal_post: 10_000, cast_post: 18_000, post_removal: 10_000,
  // الخلع والجراحة
  simple_extraction: 6_000, surgical_extraction: 15_000, wisdom_extraction: 25_000,
  retained_root: 10_000, abscess_drainage: 8_000, suture: 5_000, apicoectomy: 35_000,
  // اللثة والتنظيف
  scaling: 8_000, deep_scaling: 20_000, gingivectomy: 15_000,
  perio_surgery: 40_000, crown_lengthening: 25_000,
  // التيجان
  zirconia: 60_000, porcelain_metal: 40_000, emax: 70_000,
  temporary_crown: 8_000, recement_crown: 5_000, remove_crown: 6_000,
  // الجسور
  bridge: 120_000, bridge_repair: 20_000, bridge_cement: 8_000,
  // الأطقم
  full_denture: 150_000, partial_denture: 90_000, flexible_denture: 120_000,
  denture_repair: 15_000, reline: 20_000,
  // الزراعة
  implant: 250_000, implant_abutment: 60_000, implant_crown: 80_000,
  bone_graft: 80_000, sinus_lift: 150_000,
  // القشور التجميلية
  veneer: 70_000, composite_veneer: 30_000,
  // التجميل
  office_whitening: 40_000, home_whitening: 30_000, cosmetic_recontour: 10_000,
  // أسنان الأطفال
  child_filling: 8_000, pulpotomy: 15_000, pulpectomy: 20_000,
  child_crown: 18_000, child_extraction: 5_000, space_maintainer: 20_000,
  // الوقاية
  sealant: 5_000, fluoride: 4_000, hygiene_instruction: 2_000,
  // التقويم
  ortho_records: 15_000, fixed_ortho: 250_000, aligner: 600_000,
  ortho_adjustment: 5_000, bracket_repair: 5_000, ortho_remove: 15_000, retainer: 30_000,
  // الأجهزة والواقيات
  night_guard: 35_000, sports_guard: 30_000, appliance_repair: 10_000,
  // المتابعة والطوارئ
  followup: 2_000, emergency: 8_000, suture_removal: 3_000,
  dressing: 3_000, occlusal_adjustment: 5_000,
};

/** السعر التخميني لرمزٍ — أو `null` إن لم يُقدَّر له سعر. */
export function provisionalPriceOf(catalogCode: string | null | undefined): number | null {
  if (!catalogCode) return null;
  const price = PROVISIONAL_PRICES[catalogCode];
  return typeof price === "number" && price > 0 ? price : null;
}

export interface PriceableService {
  id: number;
  catalogCode: string | null;
  priceConfigured: boolean;
  isActive: boolean;
}

/**
 * أيُّ الخدمات تُملأ بسعرٍ تخميني.
 *
 * **وما سُعّر لا يُمسّ**: من سعّر خدمةً بيده قرّر، وكتابةُ تخمينٍ فوقه تمحو قراره.
 * والمعطّلة لا تُفوتر فلا تُسعَّر. والتي بلا رمزٍ في الدليل لا تُقدَّر — أُضيفت
 * بيدٍ ولا يُعرف ما هي.
 */
export function provisionalFills(
  services: readonly PriceableService[],
): { id: number; priceMinor: number }[] {
  const fills: { id: number; priceMinor: number }[] = [];
  for (const service of services) {
    if (!service.isActive || service.priceConfigured) continue;
    const price = provisionalPriceOf(service.catalogCode);
    if (price !== null) fills.push({ id: service.id, priceMinor: price });
  }
  return fills;
}
