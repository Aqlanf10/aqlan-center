"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LANDMARKS, SKELETAL_LABEL, analyse, formatMeasurement,
  type Calibration, type LandmarkCode, type Tracing,
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

const VERDICT_LABEL: Record<string, string> = {
  normal: "ضمن المعيار",
  low: "أقل من المعيار",
  high: "أعلى من المعيار",
};

export function CephTracer({ documentId, title, onClose, canWrite }: Props) {
  const [points, setPoints] = useState<Tracing>({});
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [active, setActive] = useState<LandmarkCode>("S");
  const [aspect, setAspect] = useState(1);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/tracing`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.tracing) {
          setPoints(payload.tracing.points ?? {});
          setCalibration(payload.tracing.calibration ?? null);
          setSavedAt(payload.tracing.updatedAt ?? payload.tracing.tracedAt);
        }
      } catch {
        // غياب التتبّع ليس خطأً — الصورة قد تكون جديدة.
      }
    })();
  }, [documentId]);

  const place = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    if (!canWrite) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPoints((current) => ({ ...current, [active]: { x, y } }));
    setDirty(true);

    // ينتقل تلقائيًّا إلى النقطة التالية غير الموضوعة: التتبّع عشرون نقرة، وأن
    // يختار الطبيب النقطة بيده بين كل نقرتين يضاعف العمل بلا فائدة.
    const order = LANDMARKS.map((item) => item.code);
    const next = order.slice(order.indexOf(active) + 1)
      .find((code) => !points[code] && code !== active);
    if (next) setActive(next);
  }, [active, canWrite, points]);

  const analysis = analyse({ tracing: points, calibration, aspect });

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
      if (!response.ok) { setError(payload?.message ?? "تعذّر الحفظ."); return; }
      setSavedAt(new Date().toISOString());
      setDirty(false);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setSaving(false);
    }
  };

  const placed = LANDMARKS.filter((item) => points[item.code]).length;

  // الخلفية معتمةٌ تمامًا لا شبه شفافة: ما خلفها يظهر من تحتها فيبدو كأنه خللٌ في
  // الرسم، والتتبّع عملُ دقّةٍ لا يحتمل تشويشًا بصريًّا خلف الصورة.
  return (
    <div role="dialog" aria-label={`تتبّع سيفالومتري — ${title}`}
      className="fixed inset-0 z-50 flex flex-col bg-slate-900 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-white">تتبّع سيفالومتري — {title}</p>
          <p className="text-[11px] text-slate-300">
            {placed} من {LANDMARKS.length} نقطة
            {savedAt ? ` · محفوظ` : dirty ? " · غير محفوظ" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite ? (
            <button onClick={() => void save()} disabled={saving || !dirty}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-extrabold text-white disabled:opacity-40">
              {saving ? "جارٍ الحفظ…" : "احفظ التتبّع"}
            </button>
          ) : null}
          <button onClick={onClose}
            className="rounded-lg border border-slate-500 px-4 py-1.5 text-xs font-bold text-slate-200">
            إغلاق
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
          <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} src={`/api/documents/${documentId}`} alt={title}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalHeight > 0) setAspect(image.naturalWidth / image.naturalHeight);
            }}
            onClick={place}
            className={`block max-h-[78vh] max-w-full ${canWrite ? "cursor-crosshair" : ""}`} />

          {/* النقاط فوق الصورة بنِسَبها — فتبقى على مكانها مهما تغيّر حجم العرض. */}
          {LANDMARKS.map((item) => {
            const point = points[item.code];
            if (!point) return null;
            return (
              <span key={item.code}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${
                  item.code === active ? "text-amber-300" : "text-emerald-300"
                }`}>
                <span className="block h-2.5 w-2.5 rounded-full border-2 border-current bg-black/40" />
                <span className="absolute right-3 top-0 whitespace-nowrap text-[10px] font-bold">
                  {item.code}
                </span>
              </span>
            );
          })}
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 overflow-auto lg:w-80">
          <div className="rounded-xl bg-white p-3">
            <p className="mb-1.5 text-[11px] font-bold text-slate-500">النقطة التالية — انقر موضعها</p>
            <p className="mb-2 text-sm font-extrabold text-navy-900">
              {active} · {LANDMARKS.find((i) => i.code === active)?.name}
            </p>
            <p className="mb-2 text-[11px] leading-5 text-slate-500">
              {LANDMARKS.find((i) => i.code === active)?.hint}
            </p>
            <div className="flex flex-wrap gap-1">
              {LANDMARKS.map((item) => (
                <button key={item.code} onClick={() => setActive(item.code)}
                  title={item.name}
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
            <p className="mb-2 text-[11px] font-bold text-slate-500">التحليل — يُحسب من النقاط لحظةً بلحظة</p>
            {analysis.missing.length > 0 ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900">
                ينقص: {analysis.missing.join("، ")}
              </p>
            ) : null}

            {analysis.measurements.length === 0 ? (
              <p className="text-xs text-slate-400">علّم النقاط المطلوبة ليظهر التحليل.</p>
            ) : (
              <ul className="space-y-1.5">
                {analysis.measurements.map((item) => (
                  <li key={item.key} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold" dir="ltr">{item.name}</span>
                      <span className={`text-sm font-extrabold ${VERDICT_STYLE[item.verdict]}`} dir="ltr">
                        {formatMeasurement(item.value, item.unit)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {item.meaning} · المعيار {item.norm.mean}±{item.norm.tolerance} ·{" "}
                      <span className={VERDICT_STYLE[item.verdict]}>{VERDICT_LABEL[item.verdict]}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {analysis.skeletal ? (
              <p className="mt-2 rounded-lg bg-navy-50 px-2.5 py-2 text-xs font-extrabold text-navy-900">
                {SKELETAL_LABEL[analysis.skeletal.klass]}
              </p>
            ) : null}
          </div>

          {/*
            * ما لم يُنفَّذ بعد — يُقال ولا يُترك للطبيب أن يكتشفه بنفسه.
            *
            * زوايا المستويات (SN-MP وFMA وIMPA والزاوية بين القاطعين) تعريفها
            * يحتاج اصطلاحًا يختلف بين مدرسةٍ وأخرى، وخطأٌ فيه يقلب ٣٥° إلى ١٤٥°
            * فيُقلب التشخيص. فلم تُكتب حتى تُقابَل بمخرجات WebCeph على حالةٍ
            * حقيقية. وبرنامجٌ يصمت عن حدوده أخطر من برنامجٍ ناقص.
            */}
          <p className="rounded-xl bg-slate-800 px-3 py-2 text-[10px] leading-5 text-slate-300">
            هذه المرحلة الأولى: زوايا النقاط الثلاث التي لا التباس في تعريفها. وزوايا
            المستويات (SN-MP، FMA، IMPA، الزاوية بين القاطعين) لم تُضف بعد — اصطلاح
            قياسها يختلف بين المدارس، وسيُثبَّت بعد مقابلته بمخرجات WebCeph على حالة
            حقيقية. علّم بقية النقاط الآن فهي تُحفظ وتُستعمل حين تُضاف.
          </p>
        </div>
      </div>
    </div>
  );
}
