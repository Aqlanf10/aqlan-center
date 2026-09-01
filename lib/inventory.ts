/**
 * المخزون — المواد التي تُصرف على الكرسي.
 *
 * ومشكلة المركز الثالثة تبدأ هنا: «تراكم التراكيب» لا يُقاس بلا معرفة ما صُرف
 * وما بقي. وقبل ذلك مشكلةٌ أبسط: مادّةٌ تنتهي في منتصف اليوم فيُلغى موعد.
 *
 * والتصميم مأخوذٌ عن `aqlan-center-mini` بإذن المالك — وأهمّ ما فيه أن **الرصيد
 * يُشتقّ من الحركات ولا يُخزَّن في عمود**. وعمودُ رصيدٍ يُحدَّث مع كل حركة يفترق
 * عن حركاته عند أول عطل: تُكتب الحركة ويفشل التحديث، فيبقى رقمٌ لا يوافق سجلّه
 * ولا يُعرف أيّهما الصحيح. وهو نفس المبدأ الذي تُبنى عليه القيود من المستندات
 * والزوايا من المعالم.
 */

export type MovementKind = "in" | "out" | "adjust";

export const MOVEMENT_KINDS: MovementKind[] = ["in", "out", "adjust"];

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  in: "إدخال",
  out: "صرف",
  adjust: "تسوية جرد",
};

export function isMovementKind(value: unknown): value is MovementKind {
  return typeof value === "string" && (MOVEMENT_KINDS as string[]).includes(value);
}

export interface MovementLike {
  kind: MovementKind;
  /** موجبٌ للإدخال والصرف؛ والتسوية تحمل إشارتها في القيمة نفسها. */
  qty: number;
}

/** أثر حركةٍ واحدة على الرصيد: الإدخال يزيد، والصرف ينقص، والتسوية كما وُقّعت. */
export function signedQty(kind: MovementKind, qty: number): number {
  if (kind === "out") return -Math.abs(qty);
  if (kind === "adjust") return qty;
  return Math.abs(qty);
}

/** الرصيد المشتقّ — مجموع الحركات الموقَّع. */
export function deriveBalance(movements: MovementLike[]): number {
  return movements.reduce((sum, move) => sum + signedQty(move.kind, move.qty), 0);
}

export interface MovementCheck {
  ok: boolean;
  message?: string;
}

/**
 * فحص الحركة قبل كتابتها.
 *
 * ويُعاد الفحص نفسه **داخل المعاملة بعد قفل صفّ البند** — لأن موظفَين يصرفان آخر
 * علبتين في اللحظة نفسها يقرأ كلاهما رصيدًا يكفيه، فيخرج الرصيد سالبًا. والفحص
 * خارج القفل يطمئن ولا يمنع.
 */
export function validateMovement(
  kind: MovementKind, qty: number, reason: string | null, balance: number,
): MovementCheck {
  if (!Number.isFinite(qty)) return { ok: false, message: "الكمية رقمٌ غير صالح." };

  if (kind === "adjust") {
    // تسويةٌ بصفر تعني أن الجرد وافق السجلّ — وحينها لا حركة أصلًا.
    if (qty === 0) return { ok: false, message: "التسوية الصفرية لا معنى لها — إن وافق الجرد السجلّ فلا حركة." };
    // والسبب إلزامي: التسوية هي البابُ الوحيد الذي يُغيّر الرصيد بلا مستند،
    // فبلا سببٍ مكتوب يصير بابًا لتغطية النقص لا لتصحيحه.
    if (!reason || !reason.trim()) {
      return { ok: false, message: "سبب التسوية إلزامي — لا تُغيَّر كمية بلا مبرر مكتوب." };
    }
    return { ok: true };
  }

  if (qty <= 0) return { ok: false, message: "الكمية يجب أن تكون أكبر من صفر." };
  if (kind === "out" && qty > balance) {
    return { ok: false, message: `الرصيد ${formatQty(balance)} لا يكفي صرف ${formatQty(qty)}.` };
  }
  return { ok: true };
}

/**
 * الكمية للعرض — بلا أصفارٍ زائدة.
 *
 * الكميات كسريّة (نصف علبة، ٢٫٥ مليلتر)، و«2.500» تُقرأ أبطأ من «2.5» على شاشةٍ
 * يُنظر إليها بين مريضين.
 */
export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return String(Math.round(value * 1000) / 1000);
}

export type StockStatus = "out" | "low" | "ok";

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  out: "منتهي",
  low: "تحت حدّ الطلب",
  ok: "متوفّر",
};

/**
 * موضع البند من حدّ الطلب.
 *
 * و«منتهي» تشمل السالب: رصيدٌ سالب يعني صرفًا لم يُقابله إدخال — وهو خللٌ يُصحَّح
 * **بتسويةٍ موثَّقة** لا بحذف حركة. فإخفاؤه بعرضه صفرًا يمحو الدليل على الخلل.
 */
export function stockStatus(balance: number, minLevel: number): StockStatus {
  if (balance <= 0) return "out";
  if (minLevel > 0 && balance < minLevel) return "low";
  return "ok";
}

/** الدفعة «قريبة الانتهاء» ضمن هذا العدد من الأيام — مهلةٌ تكفي طلب البديل. */
export const EXPIRY_SOON_DAYS = 30;

export type ExpiryState = "expired" | "soon" | "ok";

export const EXPIRY_LABEL: Record<ExpiryState, string> = {
  expired: "منتهية الصلاحية",
  soon: "تقترب من الانتهاء",
  ok: "سارية",
};

/**
 * حال الصلاحية — بالمقارنة بيوم العيادة لا بتوقيت الخادم.
 *
 * واليوم يُمرَّر ولا يُقرأ هنا: اليمن UTC+3، ودالّةٌ تقرأ ساعة الخادم تُنهي صلاحية
 * دفعةٍ قبل أوانها كل مساء.
 */
export function expiryState(expiryDate: string, today: string): ExpiryState {
  if (expiryDate <= today) return "expired";
  const days = daysBetween(today, expiryDate);
  return days <= EXPIRY_SOON_DAYS ? "soon" : "ok";
}

export interface BatchLike extends MovementLike {
  expiryDate?: string | null;
  /** رقم الحركة — يفصل بين دفعتين بنفس تاريخ الصلاحية. */
  id?: number;
}

/**
 * أقرب صلاحيةٍ **لا تزال في المخزن** — لا أقرب صلاحيةٍ دخلت يومًا.
 *
 * والفرق هو الفرق بين تنبيهٍ يُصدَّق وتنبيهٍ يُتجاهَل: دفعةٌ انتهت صلاحيتها وقد
 * صُرفت كلّها قبل شهرين ليست خطرًا، وشاشةٌ تصرخ بها كل صباح تعلّم من يقرأها أن
 * يتجاوز الصفّ الأحمر — فحين يظهر خطرٌ حقيقي لا يراه.
 *
 * فتُوزَّع المصروفات على الدفعات بترتيب الصلاحية (الأقرب انتهاءً تُصرف أولًا، وهو
 * ما ينبغي أن يقع في المخزن فعلًا)، وتُعاد صلاحية أول دفعةٍ بقي منها شيء.
 *
 * والمصروف يُخصم من الدفعات المؤرَّخة أولًا وإن دخل مع البند ما لا تاريخ له: هذا
 * يُنقص التنبيهات ولا يزيدها — وتنبيهٌ متأخر أهون من تنبيهٍ كاذب يُفقد الثقة بالبقية.
 */
export function nearestExpiry(movements: BatchLike[]): string | null {
  const used = movements.reduce((sum, move) => {
    const signed = signedQty(move.kind, move.qty);
    return signed < 0 ? sum - signed : sum;
  }, 0);

  const batches = movements
    .filter((move) => move.kind === "in" && move.expiryDate)
    .sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1
      : a.expiryDate! > b.expiryDate! ? 1
      : (a.id ?? 0) - (b.id ?? 0)));

  let cumulative = 0;
  for (const batch of batches) {
    cumulative += Math.abs(batch.qty);
    if (cumulative > used) return batch.expiryDate ?? null;
  }
  return null;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return Math.round((end - start) / 86400000);
}

export const ITEM_CATEGORIES = ["consumable", "ortho", "lab", "medicine", "other"] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  consumable: "مستهلكات",
  ortho: "مواد تقويم",
  lab: "مواد مختبر",
  medicine: "أدوية",
  other: "أخرى",
};

export function isItemCategory(value: unknown): value is ItemCategory {
  return typeof value === "string" && (ITEM_CATEGORIES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * ما تعرضه الشاشة
 * ------------------------------------------------------------------ */

export type InventoryFilter = "attention" | "all" | "inactive";

export const INVENTORY_FILTER_LABEL: Record<InventoryFilter, string> = {
  attention: "يحتاج تصرّفًا",
  all: "كل البنود",
  inactive: "الموقوفة",
};

export interface ItemLike {
  status: StockStatus;
  isActive: boolean;
  nearestExpiry: string | null;
}

/** بندٌ يستدعي تصرّفًا اليوم: نفد، أو قارب الحدّ، أو دفعته الباقية تنتهي. */
export function needsAttention(item: ItemLike, today: string): boolean {
  if (!item.isActive) return false;
  if (item.status !== "ok") return true;
  return item.nearestExpiry ? expiryState(item.nearestExpiry, today) !== "ok" : false;
}

/**
 * ترتيب العرض — الأسوأ أولًا.
 *
 * وقائمةٌ أبجدية تُقرأ مرة ثم تُهجَر: ما نفد أمس يقع بين حرفين فلا يُرى، فتُفتح
 * الشاشة كل صباح ولا تُغيّر شيئًا. فالمنتهي أولًا، ثم ما قارب الحدّ، ثم الباقي.
 */
const RANK: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };

export function sortByNeed<T extends ItemLike & { name: string }>(items: T[], today: string): T[] {
  return [...items].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
    const expiring = (item: T) =>
      item.nearestExpiry && expiryState(item.nearestExpiry, today) !== "ok" ? 0 : 1;
    if (expiring(a) !== expiring(b)) return expiring(a) - expiring(b);
    return a.name.localeCompare(b.name, "ar");
  });
}

export function filterItems<T extends ItemLike>(
  items: T[], filter: InventoryFilter, today: string,
): T[] {
  if (filter === "inactive") return items.filter((item) => !item.isActive);
  const active = items.filter((item) => item.isActive);
  return filter === "attention" ? active.filter((item) => needsAttention(item, today)) : active;
}

/** أرقام الترويسة — تُحسب من البنود نفسها لا من عدّادٍ يُحدَّث على حدة. */
export function inventorySummary(items: ItemLike[], today: string): {
  out: number; low: number; expiring: number;
} {
  const active = items.filter((item) => item.isActive);
  return {
    out: active.filter((item) => item.status === "out").length,
    low: active.filter((item) => item.status === "low").length,
    expiring: active.filter((item) =>
      item.nearestExpiry ? expiryState(item.nearestExpiry, today) !== "ok" : false).length,
  };
}

/* ------------------------------------------------------------------ *
 * مواد الزيارة
 * ------------------------------------------------------------------ */

export interface VisitMaterialLike {
  itemId: number;
  itemName: string;
  unit: string;
  kind: MovementKind;
  qty: number;
}

export interface MaterialTotal {
  itemId: number;
  name: string;
  unit: string;
  /** ما خرج فعلًا: المصروف ناقص المردود. */
  used: number;
}

/**
 * صافي ما استُهلك على زيارة.
 *
 * والحركات تُعرض كلّها ولا تُطرح صامتًا: «صُرفت علبتان ورُدّت واحدة» تُقرأ وتُراجَع،
 * و«صُرفت واحدة» تخفي أن اثنتين خرجتا من المخزن يومًا. لكن السؤال «كم استُهلك على
 * هذه الحالة؟» يريد الصافي — فيُحسب هنا، ويبقى السجلّ كاملًا فوقه.
 *
 * ويبقى البند في الحساب ولو صار صافيه صفرًا: صرفٌ رُدّ كلّه واقعةٌ حدثت، وحذفها من
 * الصافي يجعل زيارتين مختلفتين تبدوان سواء.
 */
export function netMaterials(materials: VisitMaterialLike[]): MaterialTotal[] {
  const totals = new Map<number, MaterialTotal>();
  for (const material of materials) {
    const row = totals.get(material.itemId)
      ?? { itemId: material.itemId, name: material.itemName, unit: material.unit, used: 0 };
    // التسوية لا تُنسب إلى زيارة — وإن وقعت فهي تصحيح جردٍ لا استهلاك مريض.
    if (material.kind === "out") row.used += Math.abs(material.qty);
    else if (material.kind === "in") row.used -= Math.abs(material.qty);
    totals.set(material.itemId, row);
  }
  return [...totals.values()];
}
