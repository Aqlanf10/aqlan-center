"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "./SessionProvider";
import { Icon } from "./Icon";
import { isAdmin } from "@/lib/roles";
import { clinicDateString } from "@/lib/schedule";
import { friendlyDateLong } from "@/lib/reminders";
import {
  STUDY_PHASE_LABEL, STUDY_PHASE_ORDER, STUDY_STATUS_LABEL,
  currentStudy, sortStudies, type StudyPhase, type StudyStatus,
} from "@/lib/cephStudy";
import { CHANGE_LABEL, type ChangeDirection, type Comparison } from "@/lib/cephCompare";
import { formatMeasurement, say, type Bilingual } from "@/lib/ceph";

/**
 * الدراسات السيفالومترية في ملف المريض — **موضع الترابط بين الوحدتين**.
 *
 * كانت الوحدة تتبّعًا ملصقًا بصورة: تُفتح الأشعّة فتُرى النقاط. وسؤالُ الطبيب
 * بعد سنتين ليس «أين النقاط» بل: **ما الذي كان صحيحًا يوم قرّرت؟** فالدراسة
 * وثيقةٌ لها موضعٌ من زمن العلاج، وحالةٌ، وحالةُ تقويمٍ تخدمها.
 *
 * وما تُظهره هذه الشاشة قبل كل شيء **حدود ما تراه**: هل هذه أرقامُ ما اعتُمد،
 * أم أرقامُ تتبّعٍ صُحّح بعده؟ وبلا هذا التمييز يُقرأ رقمٌ على أنه المعتمد وهو
 * ليس هو — وهذا أسوأ من ألّا يُعرض شيء.
 */

interface Study {
  id: number;
  documentId: number;
  documentTitle: string;
  orthoCaseId: number | null;
  phase: StudyPhase;
  status: StudyStatus;
  revision: number;
  title: string | null;
  takenOn: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  landmarks: number;
  drifted: boolean;
}

interface ImageDocument { id: number; title: string; isImage: boolean; takenOn: string | null; removedAt: string | null }
interface OrthoCase { id: number; startDate: string; status: string }

const STATUS_STYLE: Record<StudyStatus, string> = {
  draft: "border-slate-200 bg-white text-slate-600",
  approved: "border-brand-blue bg-navy-50 text-navy-900",
  archived: "border-slate-200 bg-slate-50 text-slate-400",
};

export function CephStudies({ patientId }: { patientId: number }) {
  const session = useSession();
  const clinical = isAdmin(session?.role) || session?.role === "doctor";
  const today = useMemo(() => clinicDateString(new Date(), "Asia/Aden"), []);

  const [studies, setStudies] = useState<Study[]>([]);
  const [images, setImages] = useState<ImageDocument[]>([]);
  const [cases, setCases] = useState<OrthoCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const [pickedForCompare, setPickedForCompare] = useState<number[]>([]);
  const [comparison, setComparison] = useState<
    { before: Study; after: Study; comparison: Comparison; summary: { ar: string } } | null
  >(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [overlayNote, setOverlayNote] = useState<string | null>(null);

  const [documentId, setDocumentId] = useState<number | null>(null);
  const [phase, setPhase] = useState<StudyPhase>("pre");
  const [orthoCaseId, setOrthoCaseId] = useState<number | null>(null);
  const [takenOn, setTakenOn] = useState(today);

  const load = useCallback(async () => {
    try {
      const [studyResponse, documentResponse, caseResponse] = await Promise.all([
        fetch(`/api/patients/${patientId}/ceph-studies`, { cache: "no-store" }),
        fetch(`/api/patients/${patientId}/documents`, { cache: "no-store" }),
        fetch(`/api/ortho?patientId=${patientId}`, { cache: "no-store" }),
      ]);
      const payload = await studyResponse.json();
      if (!studyResponse.ok) { setError(payload.message ?? "تعذّر التحميل."); return; }
      setStudies(payload.studies ?? []);
      if (documentResponse.ok) {
        const documents = (await documentResponse.json()).documents as ImageDocument[];
        setImages(documents.filter((image) => image.isImage && !image.removedAt));
      }
      if (caseResponse.ok) {
        const body = await caseResponse.json();
        setCases((body.cases ?? body ?? []) as OrthoCase[]);
      }
      setError(null);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { if (clinical) void load(); else setLoading(false); }, [clinical, load]);

  const ordered = useMemo(() => sortStudies(studies), [studies]);

  const act = async (id: number, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/ceph/studies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.message ?? "تعذّر تنفيذ الطلب."); return; }
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * المقارنة تُطلب باثنتين — لا بواحدة ولا بثلاث.
   *
   * والترتيب يفرضه الخادم بالتاريخ: الأقدم «قبل» والأحدث «بعد». وقلبُهما يقلب
   * كل إشارة، فيُقرأ تراجعٌ على أنه تحسّن.
   */
  const toggleCompare = (id: number) => {
    setComparison(null);
    setOverlay(null);
    setOverlayNote(null);
    setPickedForCompare((current) => current.includes(id)
      ? current.filter((one) => one !== id)
      // اثنتان فقط: الثالثة تزيح الأولى بدل أن تُرفض بصمت.
      : [...current, id].slice(-2));
  };

  const compare = async () => {
    if (pickedForCompare.length !== 2) return;
    setBusy(true);
    setError(null);
    try {
      const [first, second] = pickedForCompare;
      const response = await fetch(`/api/ceph/compare?first=${first}&second=${second}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setError(result.message ?? "تعذّرت المقارنة."); return; }
      setComparison(result);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * التراكب — الجدول يقول كم تغيّر، والرسم يقول **أين**.
   *
   * وهو منفصلٌ عن زرّ «قارن» عمدًا: قد يتعذّر لنقص معايرةٍ بينما الجدول يعمل،
   * فزرٌّ واحد يُسقط الاثنين معًا يُخفي ما كان يعمل.
   */
  const superimpose = async () => {
    if (pickedForCompare.length !== 2) return;
    setBusy(true);
    setOverlayNote(null);
    try {
      const [first, second] = pickedForCompare;
      const response = await fetch(`/api/ceph/superimpose?first=${first}&second=${second}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setOverlay(null); setOverlayNote(result.message ?? "تعذّر التراكب."); return; }
      setOverlay(result);
    } catch {
      setOverlayNote("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!documentId) { setError("اختر صورة الأشعة."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/patients/${patientId}/ceph-studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, phase, orthoCaseId, takenOn }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.message ?? "تعذّر إنشاء الدراسة."); return; }
      setAdding(false);
      setDocumentId(null);
      await load();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  // الاستقبال لا ترى قياسًا: مواضع المعالم تشخيصٌ سريري لا حالةُ موعد.
  if (!clinical) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-400">
        الدراسة السيفالومترية للطبيب والمدير.
      </p>
    );
  }

  return (
    <section className="space-y-3" aria-label="الدراسات السيفالومترية">
      {error ? (
        <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-800">
          {error}
        </p>
      ) : null}

      {/* المرجع لكل مرحلة: آخر معتمدة فيها — لا آخر ما فُتح. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STUDY_PHASE_ORDER.map((key) => {
          const reference = currentStudy(ordered, key);
          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-bold text-slate-400">{STUDY_PHASE_LABEL[key]}</p>
              <p className="mt-0.5 text-[13px] font-bold text-navy-900">
                {reference
                  ? `معتمدة · إصدار ${reference.revision}`
                  : <span className="text-slate-400">لا دراسة معتمدة</span>}
              </p>
              {reference?.takenOn ? (
                <p className="text-[10px] font-semibold text-slate-500">{friendlyDateLong(reference.takenOn)}</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/*
        شريط المقارنة — يظهر متى اختير شيء، ويختفي حين لا شيء.
        وشريطٌ دائمٌ يقول «اختر دراستين» يشغل مكانًا في شاشةٍ تُقرأ بين مريضين.
      */}
      {pickedForCompare.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-blue bg-navy-50 p-3">
          <span className="text-xs font-bold text-navy-900">
            للمقارنة: {pickedForCompare.length} من 2
          </span>
          <button
            onClick={() => void compare()}
            disabled={pickedForCompare.length !== 2 || busy}
            className="rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            قارن
          </button>
          <button
            onClick={() => void superimpose()}
            disabled={pickedForCompare.length !== 2 || busy}
            className="rounded-xl border border-navy-800 bg-white px-3 py-1.5 text-xs font-bold text-navy-900 disabled:opacity-40"
          >
            تراكب
          </button>
          {/*
            * ورقة «قبل وبعد».
            *
            * ورابطٌ لا زرّ: الصفحة تفتح في لسانٍ جديد وتُطبع من المتصفّح كبقيّة
            * مستندات النظام. والترتيب لا يُرسل — الصفحة تفرضه زمنيًّا بنفسها،
            * فلا يقلب ترتيبُ النقر «قبل» و«بعد» على الورقة.
            */}
          <a
            href={pickedForCompare.length === 2
              ? `/print/ceph-compare?first=${pickedForCompare[0]}&second=${pickedForCompare[1]}`
              : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={pickedForCompare.length !== 2}
            className={`rounded-xl border border-navy-800 bg-white px-3 py-1.5 text-xs font-bold text-navy-900 ${
              pickedForCompare.length === 2 ? "" : "pointer-events-none opacity-40"
            }`}
          >
            اطبع المقارنة
          </a>
          <button
            onClick={() => {
              setPickedForCompare([]); setComparison(null);
              setOverlay(null); setOverlayNote(null);
            }}
            className="text-xs font-bold text-slate-500 underline"
          >
            إلغاء
          </button>
        </div>
      ) : null}

      {overlayNote ? (
        <p className="rounded-xl border border-warning-300 bg-warning-50 px-3 py-2 text-xs font-bold text-warning-900">
          {overlayNote}
        </p>
      ) : null}
      {overlay ? <SuperimposeView overlay={overlay} /> : null}
      {comparison ? <ComparisonTable result={comparison} /> : null}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-500">{ordered.length} دراسة</p>
        <button
          onClick={() => setAdding((open) => !open)}
          className="rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-bold text-white"
        >
          {adding ? "إلغاء" : "+ دراسة جديدة"}
        </button>
      </div>

      {adding ? (
        <form
          aria-label="دراسة جديدة"
          onSubmit={(event) => { event.preventDefault(); void create(); }}
          className="space-y-2 rounded-2xl border border-brand-blue bg-white p-4"
        >
          <label className="block text-xs font-bold text-slate-600">
            صورة الأشعة
            <select
              value={documentId ?? ""}
              onChange={(event) => setDocumentId(Number(event.target.value) || null)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">— اختر —</option>
              {images.map((image) => (
                <option key={image.id} value={image.id}>{image.title}</option>
              ))}
            </select>
          </label>
          {images.length === 0 ? (
            <p className="text-[11px] font-semibold text-slate-500">
              لا صور أشعّة في الملف — ارفعها من تبويب «الأشعة» أوّلًا.
            </p>
          ) : null}
          <label className="block text-xs font-bold text-slate-600">
            مرحلة العلاج
            <select
              value={phase}
              onChange={(event) => setPhase(event.target.value as StudyPhase)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {STUDY_PHASE_ORDER.map((key) => (
                <option key={key} value={key}>{STUDY_PHASE_LABEL[key]}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            حالة التقويم
            <select
              value={orthoCaseId ?? ""}
              onChange={(event) => setOrthoCaseId(Number(event.target.value) || null)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">— بلا ربط —</option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  حالة {item.id} · بدأت {item.startDate}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            تاريخ التصوير
            <input
              type="date"
              value={takenOn}
              onChange={(event) => setTakenOn(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-navy-900 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            حفظ الدراسة
          </button>
        </form>
      ) : null}

      {loading ? <p className="text-xs font-semibold text-slate-400">…جارٍ التحميل</p> : null}

      {!loading && ordered.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          لا دراسات بعد.
        </p>
      ) : null}

      <ul className="space-y-2">
        {ordered.map((study) => (
          <li key={study.id} className={`rounded-2xl border p-3 ${STATUS_STYLE[study.status]}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-bold">
                  {STUDY_PHASE_LABEL[study.phase]} · إصدار {study.revision}
                  <span className="mr-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-600">
                    {STUDY_STATUS_LABEL[study.status]}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                  {study.title ?? study.documentTitle}
                  {study.takenOn ? ` · ${friendlyDateLong(study.takenOn)}` : ""}
                  {` · ${study.landmarks} معلمًا`}
                </p>
                {study.approvedBy ? (
                  <p className="text-[10px] font-semibold text-slate-500">
                    اعتمدها {study.approvedBy}
                    {study.approvedAt ? ` · ${friendlyDateLong(study.approvedAt.slice(0, 10))}` : ""}
                  </p>
                ) : null}
                {study.orthoCaseId ? (
                  <a href={`/patients/${patientId}?tab=ortho`}
                    className="text-[10px] font-bold text-navy-800 underline">
                    مرتبطة بحالة التقويم {study.orthoCaseId}
                  </a>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-400">غير مرتبطة بحالة تقويم</span>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap gap-1.5">
                {/* الورقة تُطبع من الدراسة نفسها — لا من تتبّع الصورة الحالي. */}
                <a
                  href={`/print/ceph/${study.documentId}?study=${study.id}`}
                  target="_blank"
                  rel="noopener"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600"
                >
                  <Icon name="print" className="inline h-3.5 w-3.5" /> التقرير
                </a>
                <button
                  onClick={() => toggleCompare(study.id)}
                  aria-pressed={pickedForCompare.includes(study.id)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                    pickedForCompare.includes(study.id)
                      ? "border-navy-800 bg-navy-800 text-white"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  للمقارنة
                </button>
                {study.status === "draft" ? (
                  <button
                    onClick={() => void act(study.id, { action: "approve" })}
                    disabled={busy}
                    className="rounded-lg bg-navy-900 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
                  >
                    اعتماد
                  </button>
                ) : null}
                {study.status !== "archived" ? (
                  <button
                    onClick={() => void act(study.id, { action: "archive" })}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 disabled:opacity-40"
                  >
                    أرشفة
                  </button>
                ) : null}
              </div>
            </div>

            {/*
              الفرق بين ما اعتُمد وما على الشاشة الآن — يُقال صراحةً.
              فمن يقرأ أرقام دراسةٍ معتمدة ثم يرى تتبّعًا مختلفًا على الصورة يظنّ
              أحدهما عطلًا. وهو ليس عطلًا: هو **التصميم** — المعتمدة لا تتغيّر.
            */}
            {study.drifted ? (
              <p className="mt-2 rounded-xl border border-warning-300 bg-warning-50 px-2.5 py-1.5 text-[11px] font-bold text-warning-900">
                تتبّع الصورة تغيّر بعد الاعتماد — وأرقام هذه الدراسة هي أرقام يوم اعتُمدت.
                أنشئ إصدارًا جديدًا إن أردت اعتماد التتبّع الحالي.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const DIRECTION_STYLE: Record<ChangeDirection, string> = {
  improved: "text-success-700",
  worsened: "text-danger-700",
  steady: "text-slate-500",
  ungraded: "text-slate-400",
};

/**
 * جدول المقارنة — ماذا فعل العلاج.
 *
 * والحكم محمولٌ في **النصّ** لا في اللون وحده: من يطبع بالأبيض والأسود، ومن لا
 * يميّز الأحمر من الأخضر، يقرأ ما يقرأه غيرُه.
 */
function ComparisonTable({ result }: {
  result: { before: Study; after: Study; comparison: Comparison; summary: { ar: string } };
}) {
  const { before, after, comparison, summary } = result;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="مقارنة دراستين">
      <p className="text-[13px] font-bold text-navy-900">
        {STUDY_PHASE_LABEL[before.phase]}
        {before.takenOn ? ` (${friendlyDateLong(before.takenOn)})` : ""}
        {" ← "}
        {STUDY_PHASE_LABEL[after.phase]}
        {after.takenOn ? ` (${friendlyDateLong(after.takenOn)})` : ""}
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{summary.ar}</p>

      {comparison.onlyBefore.length > 0 || comparison.onlyAfter.length > 0 ? (
        <p className="mt-2 rounded-xl border border-warning-300 bg-warning-50 px-2.5 py-1.5 text-[11px] font-bold text-warning-900">
          قياساتٌ لم تُقس في الدراستين معًا فلم تُقارَن:{" "}
          {[...comparison.onlyBefore, ...comparison.onlyAfter].join("، ")}
        </p>
      ) : null}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-500">
              <th className="py-1.5 text-right">القياس</th>
              <th className="py-1.5 text-left">قبل</th>
              <th className="py-1.5 text-left">بعد</th>
              <th className="py-1.5 text-left">الفرق</th>
              <th className="py-1.5 text-right">القراءة</th>
            </tr>
          </thead>
          <tbody>
            {comparison.measurements.map((item) => (
              <tr key={item.key} className="border-b border-slate-100">
                <td className="py-1.5 font-bold text-navy-900" dir="ltr">{item.name}</td>
                <td className="py-1.5 text-left" dir="ltr">{formatMeasurement(item.before, item.unit, "ar")}</td>
                <td className="py-1.5 text-left" dir="ltr">{formatMeasurement(item.after, item.unit, "ar")}</td>
                <td className={`py-1.5 text-left font-bold ${DIRECTION_STYLE[item.direction]}`} dir="ltr">
                  {item.delta > 0 ? "+" : ""}{item.delta.toFixed(1)}
                </td>
                <td className={`py-1.5 text-[11px] font-semibold ${DIRECTION_STYLE[item.direction]}`}>
                  {CHANGE_LABEL[item.direction].ar}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface OverlayLine { key: string; name: Bilingual; from: { x: number; y: number }; to: { x: number; y: number } }
interface OverlaySide {
  id: number; phase: StudyPhase; revision: number;
  takenOn: string | null; documentId: number; lines: OverlayLine[];
}
interface Overlay {
  before: OverlaySide;
  after: OverlaySide;
  scale: number;
  rotationDegrees: number;
  cranialBaseBefore: number;
  cranialBaseAfter: number;
}

/**
 * الرسم المتراكب — الجدول يقول كم تغيّر، وهذا يقول **أين**.
 *
 * ويُرسم على أشعّة الدراسة الأقدم، ومعالمُ الأحدث منقولةٌ إليها بعد التسجيل على
 * قاعدة الجمجمة. واللونان يُشرحان بالنصّ لا بالمفتاح اللوني وحده: من لا يميّز
 * الأزرق من البرتقالي يقرأ أيّهما قبل من السطر لا من الخط.
 */
function SuperimposeView({ overlay }: { overlay: Overlay }) {
  const growth = overlay.cranialBaseAfter - overlay.cranialBaseBefore;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="تراكب دراستين">
      <p className="text-[13px] font-bold text-navy-900">
        تراكب على قاعدة الجمجمة SN عند S
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
        <span className="text-navy-800">▬ الأقدم</span>{" "}
        {STUDY_PHASE_LABEL[overlay.before.phase]}
        {overlay.before.takenOn ? ` (${friendlyDateLong(overlay.before.takenOn)})` : ""}
        {" · "}
        <span className="text-accent-600">▬ الأحدث</span>{" "}
        {STUDY_PHASE_LABEL[overlay.after.phase]}
        {overlay.after.takenOn ? ` (${friendlyDateLong(overlay.after.takenOn)})` : ""}
      </p>

      <div className="relative mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/documents/${overlay.before.documentId}`}
          alt="أشعّة الدراسة الأقدم"
          className="block w-full opacity-70"
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {overlay.before.lines.map((line) => (
            <line key={`b-${line.key}`}
              x1={line.from.x * 100} y1={line.from.y * 100}
              x2={line.to.x * 100} y2={line.to.y * 100}
              stroke="#38bdf8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          ))}
          {overlay.after.lines.map((line) => (
            <line key={`a-${line.key}`}
              x1={line.from.x * 100} y1={line.from.y * 100}
              x2={line.to.x * 100} y2={line.to.y * 100}
              stroke="#f5922e" strokeWidth="1.6" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-2">
          <dt className="text-[10px] font-bold text-slate-400">قاعدة الجمجمة — الأقدم</dt>
          <dd className="text-[13px] font-bold text-navy-900" dir="ltr">
            {overlay.cranialBaseBefore.toFixed(1)} mm
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 p-2">
          <dt className="text-[10px] font-bold text-slate-400">قاعدة الجمجمة — الأحدث</dt>
          <dd className="text-[13px] font-bold text-navy-900" dir="ltr">
            {overlay.cranialBaseAfter.toFixed(1)} mm
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 p-2">
          <dt className="text-[10px] font-bold text-slate-400">فرقها</dt>
          <dd className="text-[13px] font-bold text-navy-900" dir="ltr">
            {growth > 0 ? "+" : ""}{growth.toFixed(1)} mm
          </dd>
        </div>
      </dl>

      {/*
        ولا يُحجَّم على SN — وهذا يُقال على الشاشة لا في تعليقٍ في الكود.
        فمن يرى القاعدتين مختلفتي الطول قد يظنّه عطلًا، وهو النموّ نفسه.
      */}
      <p className="mt-2 text-[11px] font-semibold text-slate-500">
        التحجيم من معايرة الصورتين لا من طول قاعدة الجمجمة — فاختلافُ طولها بينهما
        هو النموّ، ولو حُجِّم عليه لاختفى.
      </p>
      <p className="mt-1 text-[10px] font-semibold text-slate-400">
        الرسم توصيلُ معالمَ ومستوياتٍ مرجعية، لا تتبّعًا تشريحيًّا كاملًا:
        {" "}{overlay.before.lines.map((line) => say(line.name, "ar")).join(" · ") || "—"}
      </p>
    </section>
  );
}
