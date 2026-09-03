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
