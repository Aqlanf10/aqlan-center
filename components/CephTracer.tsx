"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GROUP_LABEL, LANDMARKS, LANDMARK_BY_CODE, LANDMARK_MANUAL, SKELETAL_LABEL, analyse, formatMeasurement, say,
  type Calibration, type Lang, type LandmarkCode, type Norm, type TracedPoint, type Tracing,
} from "@/lib/ceph";

/**
 * التتبّع السيفالومتري — تعليم النقاط على الأشعة.
 *
 * العمل هنا يدوي عمدًا: الطبيب ينقر على المَعلم فتُثبَّت النقطة. ولا يضع البرنامج
 * نقطةً من عنده — الدستور صريح: **الذكاء يقترح ولا يعتمد**، ولم يُضف اقتراحٌ بعد
 * أصلًا. وموضعُ نقطةٍ بمليمتر يُغيّر زاويةً بدرجة، ودرجةٌ قد تقلب التصنيف.
 *
 * والقياسات تُحسب في المتصفّح لحظةً بلحظة من النقاط نفسها — بنفس الدالّة التي
 * يحسب بها الخادم. فما يراه الطبيب وهو يحرّك النقطة هو ما سيُحفظ، لا تقريبٌ له.
 */

interface Props {
  documentId: number;
  title: string;
  onClose: () => void;
  canWrite: boolean;
}

const VERDICT_STYLE: Record<string, string> = {
  normal: "text-emerald-700",
  low: "text-amber-700",
  high: "text-amber-700",
};

/**
 * الشاشة بلغتين، وتُبدَّل بزرّ واحد.
 *
 * التقويم علمٌ مصطلحاته إنجليزية: SNA وIMPA تُكتبان كما هما في كل مرجع وكل مؤتمر.
 * والعمل اليومي في المركز عربي. فمن يقرأ التحليل قد يكون الطبيب نفسه، أو زميلًا
 * يُحال إليه المريض، أو مراجعًا لا يقرأ العربية — والاختيار له لا للبرنامج.
 *
 * ورموز النقاط (S وN وGo) لا تُترجم في الحالين: هي مصطلحٌ عالمي، وترجمتُها تقطع
 * صلة الطبيب بكل مرجعٍ قرأه.
 */
const T = {
  title: { ar: "تتبّع سيفالومتري", en: "Cephalometric tracing" },
  points: { ar: "نقطة", en: "points" },
  of: { ar: "من", en: "of" },
  saved: { ar: "محفوظ", en: "saved" },
  unsaved: { ar: "غير محفوظ", en: "unsaved" },
  save: { ar: "احفظ التتبّع", en: "Save tracing" },
  saving: { ar: "جارٍ الحفظ…", en: "Saving…" },
  close: { ar: "إغلاق", en: "Close" },
  next: { ar: "النقطة التالية — انقر موضعها", en: "Next landmark — click its position" },
  analysis: { ar: "التحليل — يُحسب من النقاط لحظةً بلحظة", en: "Analysis — computed live from the landmarks" },
  missing: { ar: "ينقص", en: "Missing" },
  markToStart: { ar: "علّم النقاط المطلوبة ليظهر التحليل.", en: "Mark the required landmarks to see the analysis." },
  norm: { ar: "المعيار", en: "norm" },
  manual: { ar: "الدليل المعتمد", en: "Approved manual" },
  verdict: {
    normal: { ar: "ضمن المعيار", en: "within norm" },
    low: { ar: "أقل من المعيار", en: "below norm" },
    high: { ar: "أعلى من المعيار", en: "above norm" },
  },
  note: {
    ar: "تعريفات النقاط منقولة من الدليل السريري المعتمد والموقَّع. وأيّ تعديل عليها يستلزم إصدارًا جديدًا منه لا تغييرًا في البرنامج.",
    en: "Landmark definitions are taken from the approved and signed clinical manual. Any change requires a new manual version, not a code change.",
  },
  undo: { ar: "تراجع", en: "Undo" },
  redo: { ar: "إعادة", en: "Redo" },
  magnifier: { ar: "المكبّرة", en: "Magnifier" },
  keys: {
    ar: "اسحب النقطة لتصحيحها · الأسهم تُزيحها بدقّة (مع Shift أسرع) · Ctrl+Z تراجع",
    en: "Drag a point to correct it · arrows nudge it finely (Shift for faster) · Ctrl+Z undo",
  },
  calibration: { ar: "المعايرة", en: "Calibration" },
  calibrateHint: {
    ar: "انقر طرفَي مسطرة الأشعة أو أيّ طولٍ معلوم على الصورة، ثم اكتب طوله الحقيقي بالمليمتر.",
    en: "Click the two ends of the ruler — or any known length on the film — then type its true length in millimetres.",
  },
  calibrateStart: { ar: "عايِر الصورة", en: "Calibrate image" },
  calibrateStop: { ar: "عُد إلى المعالم", en: "Back to landmarks" },
  calibrateApply: { ar: "اعتمد المعايرة", en: "Apply calibration" },
  calibrateClear: { ar: "أزل المعايرة", en: "Remove calibration" },
  calibrateFirst: { ar: "انقر الطرف الأول.", en: "Click the first end." },
  calibrateSecond: { ar: "انقر الطرف الآخر.", en: "Click the other end." },
  calibrateMm: { ar: "الطول الحقيقي (مم)", en: "True length (mm)" },
  calibrated: { ar: "معايَرة", en: "Calibrated" },
  notCalibrated: { ar: "غير معايَرة", en: "Not calibrated" },
  // الحدّ يُقال حيث يُقرأ العمل لا في مستندٍ جانبي.
  needsCalibration: {
    ar: "الزوايا والنسب تُحسب بلا معايرة. أمّا المسافات بالمليمتر فلا تُعرض حتى تُعايَر الصورة — ورقمٌ بلا وحدةٍ صحيحة يُقرأ كأنه مليمترات ويُبنى عليه قرار.",
    en: "Angles and ratios need no calibration. Millimetre distances stay hidden until the image is calibrated — a number without a true unit gets read as millimetres and decisions get built on it.",
  },
  // ورسائل العطل بلغتين كذلك: من يقرأ الشاشة بالإنجليزية يقرأ عطلها بها.
  saveFailed: { ar: "تعذّر الحفظ.", en: "Could not save." },
  offline: { ar: "تعذّر الاتصال بالخادم.", en: "Could not reach the server." },
} as const;

export function CephTracer({ documentId, title, onClose, canWrite }: Props) {
  const [points, setPoints] = useState<Tracing>({});
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [active, setActive] = useState<LandmarkCode>("S");
  const [aspect, setAspect] = useState(1);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lang, setLang] = useState<Lang>("ar");
  /*
   * وضع المعايرة: النقر يرسم طرفَي المؤشّر المعلوم بدل أن يضع معلمًا.
   *
   * وهو وضعٌ مستقلّ لا زرٌّ جانبي، لأن النقرة نفسها تعني شيئين مختلفين — ولو
   * تُرك التمييز للسياق لَوضع الطبيبُ معلمًا وهو يظنّ أنه يعاير.
   */
  const [mode, setMode] = useState<"landmark" | "calibrate">("landmark");
  const [draft, setDraft] = useState<{ from: TracedPoint; to: TracedPoint | null } | null>(null);
  const [millimetres, setMillimetres] = useState("");
  // المعايير من المجموعة المرجعية لا من الكود — تصل مع التتبّع.
  const [norms, setNorms] = useState<Record<string, Norm> | undefined>(undefined);
  const [hover, setHover] = useState<TracedPoint | null>(null);
  const [magnify, setMagnify] = useState(true);
  const imageRef = useRef<HTMLImageElement>(null);
  const rtl = lang === "ar";

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/tracing`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.norms) setNorms(payload.norms);
        if (payload.tracing) {
          const loaded = payload.tracing.points ?? {};
          // التاريخ يبدأ من المحفوظ لا من الفراغ: تراجعٌ إلى «لا نقاط» بعد فتح
          // تتبّعٍ قديم يمحو عمل جلسةٍ سابقة بضغطة.
          history.current = [loaded];
          cursor.current = 0;
          setPoints(loaded);
          setCalibration(payload.tracing.calibration ?? null);
          setSavedAt(payload.tracing.updatedAt ?? payload.tracing.tracedAt);
        }
      } catch {
        // غياب التتبّع ليس خطأً — الصورة قد تكون جديدة.
      }
    })();
  }, [documentId]);

  /*
   * التاريخ — تراجعٌ وإعادة.
   *
   * وضعُ نقطةٍ فوق نقطةٍ موضوعة يمحو الأولى بلا أثر، ونقرةٌ في غير موضعها تُفسد
   * معلمًا وُضع بدقّة قبل دقيقة. وبلا تراجعٍ يُعاد وضعُه بالتخمين — أو يُترك خطأً.
   */
  const history = useRef<Tracing[]>([{}]);
  const cursor = useRef(0);
  const dragging = useRef<LandmarkCode | null>(null);
  const moved = useRef(false);
  /*
   * ولا كبحَ للنقرة بعد السحب — ولا حاجة إليه.
   *
   * السحب يبدأ بضغطةٍ على مِقبض النقطة لا على الصورة، فالنقرة التي يُطلقها المتصفّح
   * بعده هدفُها الحاوي المشترك لا الصورة، ولا تبلغ `place` أصلًا. وقد جرّبتُ كبحها
   * بعَلَمٍ يُرفع عند نهاية السحب ويُخفض عند النقرة التالية — فابتلع أوّل طرفَي
   * المعايرة، لأن نقرة السحب لا تصل لتخفضه فيبقى مرفوعًا إلى أوّل نقرةٍ حقيقية.
   * والحارس الذي يمنع ما لا يقع يمنع ما يقع.
   */
  /*
   * آخر النقاط في مرجع.
   *
   * كان التاريخ يُسجَّل من داخل دالّة تحديث الحالة، ودوالّ التحديث يجب أن تبقى
   * نقيّة — فتُشغّلها React مرّتين في الوضع الصارم، فتُسجَّل الخطوة مرّتين ويصير
   * التراجع الواحد نصف تراجع. والرحلة أمسكتها: سحبةٌ ثم تراجعٌ لم يُعِد شيئًا.
   */
  const latest = useRef<Tracing>({});
  latest.current = points;

  const commit = useCallback((next: Tracing) => {
    history.current = [...history.current.slice(0, cursor.current + 1), next];
    cursor.current = history.current.length - 1;
    setPoints(next);
    setDirty(true);
  }, []);

  const step = useCallback((by: number) => {
    const target = cursor.current + by;
    if (target < 0 || target >= history.current.length) return;
    cursor.current = target;
    setPoints(history.current[target]);
    setDirty(true);
  }, []);

  const relative = (event: { clientX: number; clientY: number }, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const place = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    if (!canWrite) return;
    const { x, y } = relative(event, event.currentTarget);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    if (mode === "calibrate") {
      // النقرة الأولى طرفٌ، والثانية الطرف الآخر، والثالثة تبدأ من جديد.
      setDraft((current) => (!current || current.to ? { from: { x, y }, to: null } : { ...current, to: { x, y } }));
      return;
    }

    commit({ ...points, [active]: { x, y } });

    // ينتقل تلقائيًّا إلى النقطة التالية غير الموضوعة: التتبّع عشرون نقرة، وأن
    // يختار الطبيب النقطة بيده بين كل نقرتين يضاعف العمل بلا فائدة.
    const order = LANDMARKS.map((item) => item.code);
    const next = order.slice(order.indexOf(active) + 1)
      .find((code) => !points[code] && code !== active);
    if (next) setActive(next);
  }, [active, canWrite, commit, mode, points]);

  /*
   * السحب — تصحيحُ النقطة في مكانها.
   *
   * كان تصحيحُ معلمٍ يعني اختيارَه من القائمة ثم النقر من جديد؛ وهو في وجهٍ فيه
   * أربعٌ وعشرون نقطة عملٌ يُنفّر منه فتُترك النقطة قريبةً «كفاية». والقرب كفايةً
   * في السيفالو مليمترٌ يزيح زاويةً درجة.
   */
  const startDrag = useCallback((code: LandmarkCode) => (event: React.PointerEvent) => {
    if (!canWrite || mode === "calibrate") return;
    event.stopPropagation();
    event.preventDefault();
    dragging.current = code;
    moved.current = false;
    setActive(code);
  }, [canWrite, mode]);

  const onImageMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const { x, y } = relative(event, event.currentTarget);
    setHover(x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null);
    const code = dragging.current;
    if (!code) return;
    moved.current = true;
    setPoints((current) => ({
      ...current,
      [code]: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) },
    }));
  }, []);

  const endDrag = useCallback(() => {
    const code = dragging.current;
    dragging.current = null;
    // خطوةٌ واحدة في التاريخ لكل سحبة، لا خطوةٌ لكل بكسل مرّ عليه المؤشّر.
    if (code && moved.current) commit(latest.current);
    moved.current = false;
  }, [commit]);

  /*
   * لوحة المفاتيح — لأن الفأرة لا تضع مليمترًا.
   *
   * أدقُّ ما تبلغه اليد على شاشةٍ عرضها ألف بكسل نحو بكسلين، وهما على أشعةٍ حقيقية
   * قرابة المليمتر. فالأسهم تُزيح النقطة إزاحةً لا تبلغها اليد، والعالية معها
   * تُزيح عشرة أضعاف للانتقال السريع.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        step(event.shiftKey ? 1 : -1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        step(1);
        return;
      }

      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const move = nudge[event.key];
      if (!move || !canWrite) return;
      const point = latest.current[active];
      if (!point) return;
      event.preventDefault();
      const stepSize = event.shiftKey ? 0.01 : 0.001;
      commit({
        ...latest.current,
        [active]: {
          x: Math.min(1, Math.max(0, point.x + move[0] * stepSize)),
          y: Math.min(1, Math.max(0, point.y + move[1] * stepSize)),
        },
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, canWrite, commit, step]);

  const analysis = analyse({ tracing: points, calibration, aspect, norms });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/tracing`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points, calibration }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.message ?? say(T.saveFailed, lang)); return; }
      setSavedAt(new Date().toISOString());
      setDirty(false);
    } catch {
      setError(say(T.offline, lang));
    } finally {
      setSaving(false);
    }
  };

  const placed = LANDMARKS.filter((item) => points[item.code]).length;
  const current = LANDMARK_BY_CODE.get(active)!;

  // الخلفية معتمةٌ تمامًا لا شبه شفافة: ما خلفها يظهر من تحتها فيبدو كأنه خللٌ في
  // الرسم، والتتبّع عملُ دقّةٍ لا يحتمل تشويشًا بصريًّا خلف الصورة.
  return (
    <div role="dialog" aria-label={`تتبّع سيفالومتري — ${title}`}
      dir={rtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex flex-col bg-slate-900 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-white">{say(T.title, lang)} — {title}</p>
          <p className="text-[11px] text-slate-300">
            {placed} {say(T.of, lang)} {LANDMARKS.length} {say(T.points, lang)}
            {savedAt ? ` · ${say(T.saved, lang)}` : dirty ? ` · ${say(T.unsaved, lang)}` : ""}
          </p>
          {/* الاختصارات تُقال حيث يُعمل: أداةٌ لا يُعرف بها لا توجد. */}
          {canWrite ? <p className="mt-0.5 text-[10px] text-slate-400">{say(T.keys, lang)}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <>
              {/* التراجع والإعادة قبل الحفظ: أكثر ما يُحتاج إليه أثناء العمل لا بعده. */}
              <button onClick={() => step(-1)} title={say(T.undo, lang)}
                className="rounded-lg border border-slate-500 px-3 py-1.5 text-xs font-bold text-slate-200">
                ↶
              </button>
              <button onClick={() => step(1)} title={say(T.redo, lang)}
                className="rounded-lg border border-slate-500 px-3 py-1.5 text-xs font-bold text-slate-200">
                ↷
              </button>
              <button onClick={() => setMagnify((on) => !on)}
                title={say(T.magnifier, lang)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                  magnify ? "border-sky-300 bg-sky-900/40 text-sky-200" : "border-slate-500 text-slate-200"
                }`}>
                ⌖
              </button>
            </>
          ) : null}
          {/* زرّ اللغة: حرفان لا قائمة — التبديل يتكرّر، والقائمة تكلّف نقرتين. */}
          <button onClick={() => setLang((current) => (current === "ar" ? "en" : "ar"))}
            aria-label={lang === "ar" ? "English" : "العربية"}
            className="rounded-lg border border-slate-500 px-3 py-1.5 text-xs font-bold text-slate-200">
            {lang === "ar" ? "EN" : "ع"}
          </button>
          {canWrite ? (
            <button onClick={() => void save()} disabled={saving || !dirty}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-extrabold text-white disabled:opacity-40">
              {saving ? say(T.saving, lang) : say(T.save, lang)}
            </button>
          ) : null}
          <button onClick={onClose}
            className="rounded-lg border border-slate-500 px-4 py-1.5 text-xs font-bold text-slate-200">
            {say(T.close, lang)}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mb-2 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-800">{error}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        {/*
          * الصورة تُحجَّم لتدخل الشاشة كاملةً — بلا `object-contain`.
          *
          * أشعة السيفالو أطول من عرضها، فلو مُدّت بعرض العمود لخرج أسفلها من
          * الشاشة، فيتتبّع الطبيب نصفها ويمرّر لبقيّتها — وهو عملٌ لا يُحتمل في
          * عشرين نقطة. و`object-contain` كان سيحلّها بحلٍّ أسوأ: يبقى إطار العنصر
          * أوسع من الصورة المرسومة داخله، فتنزاح كل نقطةٍ عن موضعها بمقدار الهامش
          * الفارغ — خطأٌ صامت يُفسد كل زاوية. فيُقيَّد الطول والعرض معًا ويُترك
          * البُعد الآخر تلقائيًّا، فيبقى إطار العنصر هو الصورة نفسها تمامًا.
          */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
          <div className="relative"
            onPointerMove={onImageMove}
            onPointerUp={endDrag}
            onPointerLeave={() => { endDrag(); setHover(null); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} src={`/api/documents/${documentId}`} alt={title}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalHeight > 0) setAspect(image.naturalWidth / image.naturalHeight);
            }}
            onClick={place}
            draggable={false}
            className={`block max-h-[78vh] max-w-full select-none ${canWrite ? "cursor-crosshair" : ""}`} />

          {/*
            * المكبّرة الموضعية.
            *
            * الصورة تُعرض بارتفاع الشاشة، وأشعةٌ حقيقية عرضها ألفا بكسل تُصغَّر إلى
            * نصفها أو ثلثها — فالبكسل الواحد على الشاشة ثلاثةٌ في الأصل، ووضعُ
            * Porion أو ذروة جذرٍ عليها تخمين. فتُفتح نافذةٌ تُظهر الموضع بحجمه
            * الأصلي مضاعفًا، وفيها شعرتان متقاطعتان على الموضع بالضبط.
            *
            * وتقف في الزاوية المقابلة للمؤشّر: لو لازمَته لَغطّت ما ينظر إليه.
            */}
          {magnify && hover && imageRef.current ? (
            <div
              className="pointer-events-none absolute z-20 h-32 w-32 overflow-hidden rounded-full border-2 border-sky-300 shadow-lg"
              style={{
                top: hover.y < 0.5 ? "auto" : 8, bottom: hover.y < 0.5 ? 8 : "auto",
                left: hover.x < 0.5 ? "auto" : 8, right: hover.x < 0.5 ? 8 : "auto",
                backgroundImage: `url(/api/documents/${documentId})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${imageRef.current.width * 4}px ${imageRef.current.height * 4}px`,
                backgroundPosition: `${-(hover.x * imageRef.current.width * 4) + 64}px ${-(hover.y * imageRef.current.height * 4) + 64}px`,
              }}>
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-sky-300/70" />
              <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-sky-300/70" />
            </div>
          ) : null}

          {/* النقاط فوق الصورة بنِسَبها — فتبقى على مكانها مهما تغيّر حجم العرض. */}
          {LANDMARKS.map((item) => {
            const point = points[item.code];
            if (!point) return null;
            return (
              <span key={item.code}
                onPointerDown={startDrag(item.code)}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                  canWrite && mode === "landmark" ? "cursor-grab touch-none" : "pointer-events-none"
                } ${item.code === active ? "text-amber-300" : "text-emerald-300"}`}>
                <span className="block h-2.5 w-2.5 rounded-full border-2 border-current bg-black/40" />
                <span className="pointer-events-none absolute right-3 top-0 whitespace-nowrap text-[10px] font-bold">
                  {item.code}
                </span>
              </span>
            );
          })}
          {/* خط المعايرة: يُرى وهو يُرسم، ويبقى مرئيًّا بعد اعتماده. */}
          {(() => {
            const ends = draft ?? (calibration ? { from: calibration.from, to: calibration.to } : null);
            if (!ends) return null;
            return (
              <>
                {[ends.from, ends.to].map((end, index) => end ? (
                  <span key={index} style={{ left: `${end.x * 100}%`, top: `${end.y * 100}%` }}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-sky-300">
                    <span className="block h-2.5 w-2.5 rotate-45 border-2 border-current bg-black/40" />
                  </span>
                ) : null)}
                {ends.to ? (
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100"
                    preserveAspectRatio="none">
                    <line x1={ends.from.x * 100} y1={ends.from.y * 100}
                      x2={ends.to.x * 100} y2={ends.to.y * 100}
                      stroke="rgb(125 211 252)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : null}
              </>
            );
          })()}
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 overflow-auto lg:w-80">
          <div className="rounded-xl bg-white p-3">
            <p className="mb-1.5 text-[11px] font-bold text-slate-500">{say(T.next, lang)}</p>
            <p className="mb-2 text-sm font-extrabold text-navy-900">
              {/* الرمز لا يُترجم: مصطلحٌ عالمي، وترجمتُه تقطع صلة الطبيب بمراجعه. */}
              <span dir="ltr">{active}</span> · {say(current.name, lang)}
            </p>
            <p className="mb-2 text-[11px] leading-5 text-slate-500">{say(current.hint, lang)}</p>
            <p className="mb-2 text-[10px] font-bold text-slate-400">
              {say(GROUP_LABEL[current.group], lang)}
            </p>
            <div className="flex flex-wrap gap-1">
              {LANDMARKS.map((item) => (
                <button key={item.code} onClick={() => setActive(item.code)}
                  title={say(item.name, lang)}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                    item.code === active ? "border-navy-800 bg-navy-800 text-white"
                      : points[item.code] ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : item.required ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}>
                  {item.code}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-white p-3">
            <p className="mb-2 text-[11px] font-bold text-slate-500">{say(T.analysis, lang)}</p>
            {analysis.missing.length > 0 ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900">
                {say(T.missing, lang)}: <span dir="ltr">{analysis.missing.join(" · ")}</span>
              </p>
            ) : null}

            {analysis.measurements.length === 0 ? (
              <p className="text-xs text-slate-400">{say(T.markToStart, lang)}</p>
            ) : (
              <ul className="space-y-1.5">
                {analysis.measurements.map((item) => (
                  <li key={item.key} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold" dir="ltr">{item.name}</span>
                      <span className={`text-sm font-extrabold ${item.verdict ? VERDICT_STYLE[item.verdict] : "text-navy-900"}`} dir="ltr">
                        {formatMeasurement(item.value, item.unit, lang)}
                      </span>
                    </div>
                    {/* قياسٌ بلا معيار يُعرض بلا حكم — ولا يُخترع له معيار ليمتلئ السطر. */}
                    <p className="text-[10px] text-slate-500">
                      {say(item.meaning, lang)}
                      {item.norm && item.verdict ? (
                        <>
                          {" · "}{say(T.norm, lang)} {item.norm.mean}±{item.norm.tolerance}{" "}
                          ({item.norm.source}) ·{" "}
                          <span className={VERDICT_STYLE[item.verdict]}>
                            {say(T.verdict[item.verdict], lang)}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {analysis.skeletal ? (
              <p className="mt-2 rounded-lg bg-navy-50 px-2.5 py-2 text-xs font-extrabold text-navy-900">
                {say(SKELETAL_LABEL[analysis.skeletal.klass], lang)}
              </p>
            ) : null}

            {!analysis.calibrated ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-500">
                {say(T.needsCalibration, lang)}
              </p>
            ) : null}
          </div>

          {/*
            * المعايرة — أداةٌ في الشاشة لا حقلٌ في قاعدة البيانات.
            *
            * كانت تُحفظ وتُقرأ ولا سبيل إلى ضبطها إلا بمناداة المسار مباشرةً، ولا
            * تُنتج شيئًا بعد ضبطها: لا قياس طوليًّا واحدًا. فصارت تُرسم على الصورة
            * وتُدخل بالمليمتر، وتُشغّل المسافات التي كانت معطّلة.
            */}
          {canWrite ? (
            <div className="rounded-xl bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold text-slate-500">{say(T.calibration, lang)}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  analysis.calibrated ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                }`}>
                  {say(analysis.calibrated ? T.calibrated : T.notCalibrated, lang)}
                </span>
              </div>

              {mode === "calibrate" ? (
                <>
                  <p className="mb-2 text-[10px] leading-4 text-slate-500">{say(T.calibrateHint, lang)}</p>
                  <p className="mb-2 text-[11px] font-bold text-sky-700">
                    {say(!draft || draft.to ? T.calibrateFirst : T.calibrateSecond, lang)}
                  </p>
                  <label className="block text-[10px] font-bold text-slate-500" htmlFor="ceph-mm">
                    {say(T.calibrateMm, lang)}
                  </label>
                  <input id="ceph-mm" inputMode="decimal" value={millimetres} dir="ltr"
                    onChange={(event) => setMillimetres(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-blue" />
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => {
                        const value = Number(millimetres);
                        if (!draft?.to || !(value > 0)) return;
                        setCalibration({ from: draft.from, to: draft.to, millimetres: value });
                        setDirty(true);
                        setDraft(null);
                        setMode("landmark");
                      }}
                      disabled={!draft?.to || !(Number(millimetres) > 0)}
                      className="flex-1 rounded-lg bg-sky-700 px-3 py-1.5 text-[11px] font-extrabold text-white disabled:opacity-40">
                      {say(T.calibrateApply, lang)}
                    </button>
                    <button onClick={() => { setMode("landmark"); setDraft(null); }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">
                      {say(T.calibrateStop, lang)}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-1.5">
                  <button onClick={() => { setMode("calibrate"); setDraft(null); setMillimetres(calibration ? String(calibration.millimetres) : ""); }}
                    className="flex-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-[11px] font-extrabold text-sky-800">
                    {say(T.calibrateStart, lang)}
                  </button>
                  {calibration ? (
                    <button onClick={() => { setCalibration(null); setDirty(true); }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">
                      {say(T.calibrateClear, lang)}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {/*
            * ما لم يُنفَّذ بعد — يُقال ولا يُترك للطبيب أن يكتشفه بنفسه.
            *
            * زوايا المستويات (SN-MP وFMA وIMPA والزاوية بين القاطعين) تعريفها
            * يحتاج اصطلاحًا يختلف بين مدرسةٍ وأخرى، وخطأٌ فيه يقلب ٣٥° إلى ١٤٥°
            * فيُقلب التشخيص. فلم تُكتب حتى تُقابَل بمخرجات WebCeph على حالةٍ
            * حقيقية. وبرنامجٌ يصمت عن حدوده أخطر من برنامجٍ ناقص.
            */}
          <p className="rounded-xl bg-slate-800 px-3 py-2 text-[10px] leading-5 text-slate-300">
            {say(T.note, lang)} <span dir="ltr">{LANDMARK_MANUAL}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
