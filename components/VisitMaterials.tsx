"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatQty, netMaterials, type ItemCategory, type StockStatus } from "@/lib/inventory";

/**
 * المواد المصروفة على الزيارة.
 *
 * وموضعها هنا لا في شاشة المخزون هو الميزة كلّها: المادّة تُصرف على الكرسي بين
 * مريضين، ومن يُطلب منه أن يترك الشاشة ويفتح المخزون ويبحث عن البند ليسجّل علبة
 * قفازات **لن يفعلها**. ثم يفترق الرصيد عن الواقع فلا يُصدَّق شيء منه — والوحدة
 * كلّها تصير عبئًا بلا فائدة.
 *
 * وهي كذلك الجواب على «كم كلّفت هذه الحالة؟»: صرفٌ بلا زيارةٍ يقول كم خرج من
 * المخزن، وصرفٌ مربوطٌ بزيارةٍ يقول على مَن خرج.
 */

interface Item {
  id: number;
  name: string;
  category: ItemCategory;
  unit: string;
  balance: number;
  status: StockStatus;
}

interface Material {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  kind: "in" | "out" | "adjust";
  qty: number;
  reason: string | null;
  createdBy: string;
}

export function VisitMaterials({ visitId, patientId, canWrite }: {
  visitId: number;
  patientId: number | null;
  /** الزيارة الموقَّعة تُقرأ ولا تُصرف عليها — كالإجراءات تمامًا. */
  canWrite: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const [itemsResponse, usedResponse] = await Promise.all([
        fetch("/api/inventory", { cache: "no-store" }),
        fetch(`/api/visits/${visitId}/materials`, { cache: "no-store" }),
      ]);
      if (itemsResponse.ok) setItems(((await itemsResponse.json()).items as Item[]));
      if (usedResponse.ok) setMaterials(((await usedResponse.json()).materials as Material[]));
    } catch {
      // القائمة تبقى على آخر ما وصل: قسمٌ يختفي وسط شاشة التوثيق أسوأ من قائمةٍ قديمة.
    }
  }, [visitId]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<Response>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await run();
      const payload = await response.json().catch(() => null);
      // رسالة الخادم بالعربية وتقول الرقم: «الرصيد ٣ لا يكفي صرف ٥» — فتُعرض كما هي
      // ولا تُستبدل بـ«تعذّر». والطبيب حينها يعرف أن عليه أن يطلب لا أن يعيد الضغط.
      setError(response.ok ? null : (payload?.message ?? "تعذّر تسجيل الصرف."));
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [load]);

  const dispense = useCallback(async () => {
    const id = Number(itemId);
    if (!id) { setError("اختر المادّة أولًا."); return; }
    await act(() => fetch(`/api/inventory/${id}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "out", qty: Number(qty), visitId, patientId }),
    }));
    setQty("1");
  }, [act, itemId, qty, visitId, patientId]);

  /*
   * الردّ حركةُ إدخالٍ بسببٍ مكتوب، لا حذفًا للحركة الأولى.
   *
   * وحذفُها يجعل الرصيد يوافق الواقع ويمحو أن علبةً خرجت ورجعت — فلا يُعرف من
   * كثرة الردّ أن بندًا يُصرف زيادةً كل يوم. والسجلّ الذي يُصحَّح بالحذف يُصحَّح
   * بالحذف مرّتين.
   */
  const takeBack = useCallback(async (material: Material) => {
    await act(() => fetch(`/api/inventory/${material.itemId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "in", qty: Math.abs(material.qty), visitId, patientId,
        reason: `ردُّ ما لم يُستعمل — زيارة ${visitId}`,
      }),
    }));
  }, [act, visitId, patientId]);

  const net = useMemo(() => netMaterials(materials), [materials]);

  const usable = items.filter((item) => item.balance > 0);
  if (!canWrite && materials.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4" aria-label="المواد المصروفة">
      <h3 className="mb-1 text-sm font-bold">المواد المصروفة</h3>
      <p className="mb-3 text-[11px] font-medium text-slate-500">
        ما استُهلك على هذه الزيارة — يُخصم من المخزن ويُنسب إلى الحالة.
      </p>

      {error ? (
        <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {canWrite ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {/* تسميتان لا تحتوي إحداهما الأخرى: «المادّة» و«كمية المادّة» تجعلان كل
              بحثٍ بالتسمية يلتقط الاثنين — وهو العطل نفسه الذي عطّل رحلتين. */}
          <select
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            aria-label="المادّة المصروفة"
            className="min-w-[10rem] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">— اختر مادّة —</option>
            {usable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {formatQty(item.balance)} {item.unit}
                {item.status === "low" ? " (تحت الحدّ)" : ""}
              </option>
            ))}
          </select>
          <input
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            aria-label="كمية المصروف"
            inputMode="decimal"
            dir="ltr"
            className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => { void dispense(); }}
            disabled={busy || !itemId}
            className="rounded-xl bg-navy-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            اصرف
          </button>
        </div>
      ) : null}

      {/* لا مادّةَ في المخزن أصلًا: تُقال العلّة ولا تُترك قائمةٌ فارغة تُفهم عطلًا. */}
      {canWrite && items.length > 0 && usable.length === 0 ? (
        <p className="mb-3 text-[11px] font-semibold text-warning-900">
          لا مادّة برصيدٍ موجب — راجع المخزون قبل الصرف.
        </p>
      ) : null}
      {canWrite && items.length === 0 ? (
        <p className="mb-3 text-[11px] font-semibold text-slate-500">
          لا بنود مخزون بعد. يضيفها المدير من شاشة المخزون.
        </p>
      ) : null}

      {materials.length === 0 ? (
        <p className="text-xs text-slate-400">لم تُصرف مواد على هذه الزيارة.</p>
      ) : (
        <ul className="space-y-1" aria-label="سجلّ مواد الزيارة">
          {materials.map((material) => (
            <li key={material.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 truncate">
                <span className="font-bold">{material.itemName}</span>
                <span className="mr-1.5 text-slate-500">
                  {material.kind === "out" ? "صُرفت" : "رُدّت"} {formatQty(Math.abs(material.qty))} {material.unit}
                </span>
                <span className="mr-1.5 text-slate-400">{material.createdBy}</span>
              </span>
              {canWrite && material.kind === "out" ? (
                <button
                  type="button"
                  onClick={() => { void takeBack(material); }}
                  disabled={busy}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-navy-800 disabled:opacity-40"
                >
                  رُدَّت للمخزن
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {net.some((row) => row.used !== 0) ? (
        <p className="mt-2 text-[11px] font-bold text-navy-900">
          الصافي على الزيارة:{" "}
          {net.filter((row) => row.used !== 0)
            .map((row) => `${row.name} ${formatQty(row.used)} ${row.unit}`)
            .join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
