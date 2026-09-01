"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, ActionButton, StatCard as Stat } from "@/components/PageHeader";
import { useSession } from "@/components/SessionProvider";
import { isAdmin } from "@/lib/roles";
import { clinicDateString } from "@/lib/schedule";
import { friendlyDate } from "@/lib/reminders";
import {
  CATEGORY_LABEL,
  EXPIRY_LABEL,
  INVENTORY_FILTER_LABEL,
  ITEM_CATEGORIES,
  MOVEMENT_LABEL,
  MOVEMENT_KINDS,
  STOCK_STATUS_LABEL,
  expiryState,
  filterItems,
  formatQty,
  inventorySummary,
  sortByNeed,
  type InventoryFilter,
  type ItemCategory,
  type MovementKind,
  type StockStatus,
} from "@/lib/inventory";

/**
 * المخزون.
 *
 * والشاشة تفتح على **ما يحتاج تصرّفًا** لا على «الكل» — كالمختبر تمامًا: قائمةٌ
 * أبجدية بمئة بند تُقرأ مرة ثم تُهجَر، وما نفد فيها يقع بين حرفين فلا يُرى. ومن
 * أراد الجرد كلّه فزرٌّ واحد يُظهره.
 *
 * والصرف من الشاشة نفسها بلا انتقال: المادّة تُصرف على الكرسي بين مريضين، وخطوةٌ
 * زائدة في تلك اللحظة تعني أن الصرف لا يُسجَّل — ثم يفترق الرصيد عن الواقع فلا
 * يُصدَّق شيء منه.
 */

interface Item {
  id: number;
  name: string;
  category: ItemCategory;
  unit: string;
  minLevel: number;
  note: string | null;
  isActive: boolean;
  balance: number;
  status: StockStatus;
  nearestExpiry: string | null;
}

interface Movement {
  id: number;
  kind: MovementKind;
  qty: number;
  expiryDate: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

// «الموقوفة» للمدير وحده: الخادم لا يعيد الموقوفة لغيره، وزرٌّ يفتح على فراغٍ دائم
// يعلّم صاحبه ألّا يثق بالأزرار.
const FILTERS: InventoryFilter[] = ["attention", "all"];
const ADMIN_FILTERS: InventoryFilter[] = [...FILTERS, "inactive"];

const STATUS_STYLE: Record<StockStatus, string> = {
  out: "border-danger-300 bg-danger-50 text-danger-900",
  low: "border-warning-300 bg-warning-50 text-warning-900",
  ok: "border-slate-200 bg-white text-navy-900",
};

export default function InventoryPage() {
  const session = useSession();
  const admin = isAdmin(session?.role);

  // اليوم بتوقيت العيادة: دالّةٌ تقرأ ساعة الخادم تُنهي صلاحية دفعةٍ قبل أوانها كل
  // مساء — اليمن UTC+3.
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);

  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<InventoryFilter>("attention");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openItem, setOpenItem] = useState<number | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const inFlight = useRef(false);
  // أيُّ بندٍ تخصّه الحركات المعروضة الآن. ومن يفتح بندًا ثم يفتح آخر قبل وصول
  // الأول يرى حركات الأول تحت اسم الثاني — وسجلُّ صرفٍ منسوبٌ إلى بندٍ لم يقع
  // عليه أسوأ من لا سجلّ: يُقرأ ويُبنى عليه.
  const movementsFor = useRef<number | null>(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await fetch("/api/inventory?all=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message ?? "تعذّر التحميل.");
      setItems((payload as { items: Item[] }).items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر التحميل.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  /*
   * الشاشة تُفتح صباحًا وتبقى مفتوحة: الاستقبال على جهازٍ والطبيب على آخر. وما
   * يصرفه أحدهما لا يظهر عند الثاني إن لم تُحدَّث الشاشة إلا بفعلٍ منه هو — فيُخطَّط
   * ليومٍ كامل على رصيدٍ استُهلك، وهو بعينه العطل الذي بُنيت الوحدة لمنعه.
   *
   * ودقيقة تكفي: هذه أرقام مخزون لا نداءُ مريضٍ ينتظر. ومعها تحديثٌ عند العودة إلى
   * اللسان — من غاب ثم عاد أولى الناس برقمٍ جديد، ولا يُنتظر به دورُ المؤقّت.
   */
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(false); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const loadMovements = useCallback(async (itemId: number) => {
    movementsFor.current = itemId;
    setMovements([]);
    try {
      const response = await fetch(`/api/inventory/${itemId}/movements`, { cache: "no-store" });
      const payload = response.ok ? ((await response.json()).movements as Movement[]) : [];
      // وصل الردّ وقد أُغلق بنده أو فُتح غيره — فيُطرح، ولا يُكتب فوق حركات سواه.
      if (movementsFor.current !== itemId) return;
      setMovements(payload);
    } catch {
      if (movementsFor.current === itemId) setMovements([]);
    }
  }, []);

  const act = useCallback(async (run: () => Promise<Response>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await run();
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? "تعذّر تنفيذ الإجراء."); return false; }
      setError(null);
      await load(false);
      return true;
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [load]);

  const summary = useMemo(() => inventorySummary(items, today), [items, today]);
  // البند المفتوح يبقى معروضًا وإن خرج من التصفية بالحركة التي سُجّلت للتوّ.
  // ومن يسجّل إدخالًا فيختفي البند من تحت يده لا يرى أثر ما سجّل — فيظنّه لم يُحفظ
  // ويعيده. أما الموقوف فيختفي: لا حركة عليه، ولوحُه بلا معنى.
  const visible = useMemo(() => {
    const shown = filterItems(items, filter, today);
    const held = openItem && filter !== "inactive" && !shown.some((one) => one.id === openItem)
      ? items.find((one) => one.id === openItem && one.isActive)
      : undefined;
    return sortByNeed(held ? [...shown, held] : shown, today);
  }, [items, filter, today, openItem]);

  const openDetails = useCallback((itemId: number) => {
    setOpenItem((current) => {
      const next = current === itemId ? null : itemId;
      if (next) void loadMovements(next);
      else { movementsFor.current = null; setMovements([]); }
      return next;
    });
  }, [loadMovements]);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageHeader title="المخزون" subtitle="المواد والمستهلكات — ما نفد أو قارب أولًا">
        {admin ? (
          <ActionButton tone={adding ? "quiet" : "primary"} onClick={() => setAdding((open) => !open)}>
            {adding ? "إلغاء" : "+ بند جديد"}
          </ActionButton>
        ) : null}
      </PageHeader>

      <section className="mb-4 grid grid-cols-3 gap-2" aria-label="ملخص المخزون">
        <Stat label="نفد" value={summary.out} tone={summary.out > 0 ? "bad" : "calm"} />
        <Stat label="تحت حدّ الطلب" value={summary.low} tone={summary.low > 0 ? "warn" : "calm"} />
        <Stat label="صلاحيتها تقترب" value={summary.expiring} tone={summary.expiring > 0 ? "warn" : "calm"} />
      </section>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {adding && admin ? <NewItemForm busy={busy} act={act} onDone={() => setAdding(false)} /> : null}

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="تصفية المخزون">
        {(admin ? ADMIN_FILTERS : FILTERS).map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              filter === option
                ? "bg-navy-900 text-white"
                : "border border-slate-200 bg-white text-navy-800"
            }`}
          >
            {INVENTORY_FILTER_LABEL[option]}
          </button>
        ))}
      </nav>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
          {filter === "attention"
            ? "لا بند يحتاج تصرّفًا — كل ما هو مسجَّل فوق حدّه وصلاحياته سارية."
            : filter === "inactive"
            ? "لا بنود موقوفة."
            : "لا بنود بعد. يضيفها المدير من «بند جديد»."}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="بنود المخزون">
          {visible.map((item) => {
            const expiry = item.nearestExpiry ? expiryState(item.nearestExpiry, today) : null;
            return (
              <li key={item.id} className={`rounded-2xl border p-3 ${STATUS_STYLE[item.status]}`}>
                <button
                  onClick={() => openDetails(item.id)}
                  aria-expanded={openItem === item.id}
                  className="flex w-full items-center justify-between gap-3 text-right"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{item.name}</span>
                    <span className="mt-0.5 block text-[11px] font-semibold opacity-60">
                      {CATEGORY_LABEL[item.category]}
                      {item.isActive ? "" : " · موقوف"}
                      {item.minLevel > 0 ? ` · حدّ الطلب ${formatQty(item.minLevel)}` : ""}
                    </span>
                    {expiry && expiry !== "ok" ? (
                      <span className="mt-1 inline-block rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">
                        {EXPIRY_LABEL[expiry]} — {friendlyDate(item.nearestExpiry!)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-left">
                    <span className="block text-lg font-bold leading-none" dir="ltr">
                      {formatQty(item.balance)}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-semibold opacity-60">
                      {item.unit} · {STOCK_STATUS_LABEL[item.status]}
                    </span>
                  </span>
                </button>

                {openItem === item.id ? (
                  <ItemDetails
                    item={item}
                    admin={admin}
                    busy={busy}
                    movements={movements}
                    act={act}
                    reload={() => loadMovements(item.id)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

function NewItemForm({ busy, act, onDone }: {
  busy: boolean;
  act: (run: () => Promise<Response>) => Promise<boolean>;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ItemCategory>("consumable");
  const [unit, setUnit] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [note, setNote] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await act(() => fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, unit, minLevel: Number(minLevel) || 0, note }),
    }));
    if (ok) { setName(""); setUnit(""); setMinLevel(""); setNote(""); onDone(); }
  };

  return (
    <form onSubmit={submit} className="mb-5 rounded-2xl border border-slate-200 bg-white p-4" aria-label="بند جديد">
      <h2 className="mb-3 text-sm font-bold">بند جديد</h2>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="اسم البند"
        placeholder="اسم البند — مثل: قفازات مقاس M"
        className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
      <div className="mb-2 flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as ItemCategory)}
          aria-label="تصنيف البند"
          className="min-w-[8rem] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          {ITEM_CATEGORIES.map((value) => (
            <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>
          ))}
        </select>
        <input
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          aria-label="وحدة القياس"
          placeholder="الوحدة — علبة، مليلتر"
          className="min-w-[8rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      <input
        value={minLevel}
        onChange={(event) => setMinLevel(event.target.value)}
        aria-label="حدّ الطلب"
        inputMode="decimal"
        dir="ltr"
        placeholder="حدّ الطلب — دونه يُنبَّه قبل أن ينفد"
        className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label="ملاحظة"
        placeholder="ملاحظة — المورّد مثلًا"
        className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
      <ActionButton type="submit" disabled={busy || !name.trim()}>حفظ البند</ActionButton>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function ItemDetails({ item, admin, busy, movements, act, reload }: {
  item: Item;
  admin: boolean;
  busy: boolean;
  movements: Movement[];
  act: (run: () => Promise<Response>) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const [kind, setKind] = useState<MovementKind>("out");
  const [qty, setQty] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [reason, setReason] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await act(() => fetch(`/api/inventory/${item.id}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, qty: Number(qty), expiryDate: expiryDate || null, reason }),
    }));
    if (ok) { setQty(""); setExpiryDate(""); setReason(""); await reload(); }
  };

  const toggleActive = async () => {
    const ok = await act(() => fetch(`/api/inventory/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    }));
    if (ok) await reload();
  };

  return (
    <div className="mt-3 border-t border-slate-200/70 pt-3">
      {item.isActive ? (
        <form onSubmit={submit} className="mb-3" aria-label={`حركة على ${item.name}`}>
          <div className="mb-2 flex flex-wrap gap-2">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MovementKind)}
              aria-label="نوع الحركة"
              className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {MOVEMENT_KINDS.map((value) => (
                <option key={value} value={value}>{MOVEMENT_LABEL[value]}</option>
              ))}
            </select>
            <input
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              aria-label="الكمية"
              inputMode="decimal"
              dir="ltr"
              placeholder={kind === "adjust" ? "الفرق — بإشارته" : "الكمية"}
              className="min-w-[6rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          {/* الصلاحية تُسجَّل مع الدخول وحدها: صرفٌ لا صلاحية له، والتسوية تصحيح رقم. */}
          {kind === "in" ? (
            <label className="mb-2 block">
              <span className="mb-1 block text-[11px] font-bold opacity-60">صلاحية الدفعة (اختياري)</span>
              <input
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
                aria-label="صلاحية الدفعة"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          ) : null}

          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="السبب"
            placeholder={kind === "adjust" ? "سبب التسوية — إلزامي" : "ملاحظة (اختياري)"}
            className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />

          <ActionButton
            type="submit"
            tone={kind === "adjust" ? "quiet" : "primary"}
            disabled={busy || !qty.trim()}
          >
            تسجيل {MOVEMENT_LABEL[kind]}
          </ActionButton>
        </form>
      ) : (
        <p className="mb-3 text-xs font-semibold opacity-70">
          البند موقوف — سجلّه محفوظ ولا تُسجَّل عليه حركة حتى يُعاد تفعيله.
        </p>
      )}

      {admin ? (
        <ActionButton tone="quiet" onClick={toggleActive} disabled={busy} className="mb-3">
          {item.isActive ? "إيقاف البند" : "إعادة تفعيل البند"}
        </ActionButton>
      ) : null}

      <h3 className="mb-1.5 text-[11px] font-bold opacity-60">آخر الحركات</h3>
      {movements.length === 0 ? (
        <p className="text-xs opacity-60">لا حركات بعد.</p>
      ) : (
        <ul className="space-y-1" aria-label={`حركات ${item.name}`}>
          {movements.slice(0, 12).map((move) => (
            <li key={move.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 truncate">
                <span className="font-bold">{MOVEMENT_LABEL[move.kind]}</span>
                <span className="mr-1.5 opacity-60">{move.createdBy}</span>
                {move.reason ? <span className="mr-1.5 opacity-60">— {move.reason}</span> : null}
              </span>
              <span className="shrink-0 font-bold" dir="ltr">
                {move.kind === "out" ? "−" : move.kind === "adjust" && move.qty < 0 ? "−" : "+"}
                {formatQty(Math.abs(move.qty))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
