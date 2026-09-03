import { notFound } from "next/navigation";
import {
  cephStudyAnalysis, getCephTracing, getPatient, getPatientDocument, getSettingsSafe, printCount,
} from "@/lib/db";
import { STUDY_PHASE_TEXT, STUDY_STATUS_TEXT } from "@/lib/cephStudy";
import {
  LANDMARKS, LANDMARK_MANUAL, SEVERITY_LABEL, SKELETAL_LABEL, VERTICAL_LABEL,
  formatMeasurement, referenceLines, say, severityOf, zScore,
  type Lang,
} from "@/lib/ceph";
import { dateLong } from "@/lib/reminders";
import { PrintHeader, PrintFooter } from "@/components/PrintHeader";
import { PrintButton, ReprintMark } from "@/components/PrintButton";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * تقرير التحليل السيفالومتري.
 *
 * الورقة التي تخرج من الوحدة إلى يد إنسان: يحملها المريض، أو تُرسل إلى زميلٍ
 * يُحال إليه، أو تُحفظ في الملف. وقبلها كان التحليل كلّه محبوسًا في شاشةٍ لا
 * تُطبع — فوحدةٌ لا مخرج لها نصف وحدة.
 *
 * وتُطبع كما تُطبع كل مستندات النظام: صفحة HTML وطباعة المتصفّح، لا مكتبة PDF.
 * فالخط العربي الذي يظهر في الشاشة هو الذي يخرج على الورق، ولا طبقةَ ثانية
 * تُخطئ في تشكيل الحروف أو اتجاهها.
 */
export default async function CephReportPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string; study?: string }>;
}) {
  // التقرير تشخيصٌ سريري — للطبيب والمدير، لا للاستقبال. وصفحة الطباعة بابٌ
  // خلفي إلى التشخيص لو تُركت مفتوحة لكل من يملك جلسة.
  const session = await requireSession();
  if (!session || (!isAdmin(session.role) && session.role !== "doctor")) notFound();

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { lang: rawLang, study: rawStudy } = await searchParams;
  const lang: Lang = rawLang === "en" ? "en" : "ar";
  const rtl = lang === "ar";

  /*
   * التقرير يُطبع من **الدراسة** متى طُلبت، ومن التتبّع الحيّ متى لم تُطلب.
   *
   * وبلا هذا كان زرّ التقرير في ملف المريض يفتح تتبّع الصورة الحالي مهما كانت
   * الدراسة معتمدة — فتخرج على الورقة أرقامٌ غيرُ التي وُقِّعت. والدراسة المعتمدة
   * لا تتغيّر تحت من اعتمدها؛ **وورقتُها كذلك**.
   */
  const studyId = Number(rawStudy);
  const wanted = Number.isInteger(studyId) && studyId > 0 ? studyId : null;
  const reading = wanted ? await cephStudyAnalysis(wanted) : null;
  // دراسةٌ لا وجود لها، أو تخصّ صورةً أخرى: لا تُطبع على هذه الأشعّة.
  if (wanted && (!reading || reading.study.documentId !== id)) notFound();

  const [tracing, document, settings] = await Promise.all([
    getCephTracing(id), getPatientDocument(id), getSettingsSafe(),
  ]);
  if (!tracing || !document) notFound();
  const patient = await getPatient(tracing.patientId);
  if (!patient) notFound();


  const study = reading?.study ?? null;
  /*
   * هويّة الطبعة تشمل الدراسة.
   *
   * وأشعّةٌ واحدة قد تحمل إصدارين: بلا هذا تُحسب أوّلُ طبعةٍ للإصدار الثاني
   * إعادةَ طباعة، ولا يُعرف من السجل أيّ إصدارٍ طُبع. و«نسخة معاد طباعتها»
   * ادّعاءٌ على الورقة — فيجب أن يصدق.
   */
  const printKey = study ? `${id}:${study.id}` : String(id);
  const printed = await printCount("ceph", printKey);
  const points = reading ? reading.points : tracing.points;
  const analysis = reading ? reading.analysis : tracing.analysis;
  const lines = referenceLines(points);

  const T = {
    title: { ar: "تقرير التحليل السيفالومتري", en: "Cephalometric Analysis Report" },
    file: { ar: "رقم الملف", en: "File no." },
    sex: { ar: "الجنس", en: "Sex" },
    age: { ar: "العمر وقت التصوير", en: "Age at imaging" },
    years: { ar: "سنة", en: "years" },
    xrayDate: { ar: "تاريخ الأشعة", en: "Radiograph date" },
    tracedBy: { ar: "نفّذ التتبّع", en: "Traced by" },
    tracedAt: { ar: "تاريخ التحليل", en: "Analysis date" },
    measurement: { ar: "القياس", en: "Measurement" },
    value: { ar: "القيمة", en: "Value" },
    norm: { ar: "المعيار", en: "Norm" },
    diff: { ar: "الفرق", en: "Diff" },
    reading: { ar: "القراءة", en: "Reading" },
    unread: { ar: "بلا معيار — يُقرأ ولا يُصنَّف", en: "No norm — read, not graded" },
    skeletal: { ar: "العلاقة الهيكلية", en: "Skeletal relation" },
    verticalHead: { ar: "النمط العمودي", en: "Vertical pattern" },
    undecided: { ar: "لم يُحسم — القياسان لا يتّفقان", en: "Undecided — the two measures disagree" },
    calibrated: { ar: "الصورة معايَرة — المسافات بالمليمتر صالحة.", en: "Image calibrated — millimetre distances are valid." },
    notCalibrated: {
      ar: "الصورة غير معايَرة — لا تُعرض مسافات بالمليمتر، والزوايا والنسب وحدها معروضة.",
      en: "Image not calibrated — no millimetre distances are shown; angles and ratios only.",
    },
    planes: { ar: "المستويات المرسومة", en: "Drawn reference planes" },
    tracingNote: {
      ar: "الرسم توصيلُ معالمَ ومستوياتٍ مرجعية، لا تتبّعٌ تشريحي كامل: لا تُرسم حدود العظم ولا ظلّ الأنسجة الرخوة.",
      en: "The drawing connects landmarks and reference planes; it is not a full anatomical tracing — bone outlines and soft-tissue shadow are not drawn.",
    },
    manualNote: {
      ar: `تعريفات ${LANDMARKS.filter((item) => !item.source).length} معلمًا من الدليل السريري المعتمد ${LANDMARK_MANUAL}؛ وما عداها من الأدبيات المنشورة، وكلٌّ بمرجعه في الجدول.`,
      en: `${LANDMARKS.filter((item) => !item.source).length} landmark definitions come from the approved clinical manual ${LANDMARK_MANUAL}; the rest come from published literature, each cited in the table.`,
    },
    study: { ar: "الدراسة", en: "Study" },
    revision: { ar: "إصدار", en: "Revision" },
    approvedBy: { ar: "اعتمدها", en: "Approved by" },
    liveNote: {
      ar: "هذه قراءةُ التتبّع الحالي للصورة، لا دراسةً معتمدة.",
      en: "This reads the image's current tracing; it is not an approved study.",
    },
    driftNote: {
      ar: "أرقام هذه الورقة أرقامُ يوم الاعتماد — وتتبّع الصورة تغيّر بعده.",
      en: "The figures on this sheet are those of the approval date; the image tracing has changed since.",
    },
    disclaimer: {
      ar: "هذا التقرير قراءةُ قياساتٍ تُشتقّ من معالمَ وضعها الطبيب بيده. يُقرأ مع الفحص السريري وبقيّة السجلات، ولا يُتّخذ وحده أساسًا لقرار علاجي.",
      en: "This report reads measurements derived from landmarks placed by the clinician. It is to be read with the clinical examination and the rest of the record, and is not on its own a basis for a treatment decision.",
    },
  };

  const age = patient.birthYear && document.takenOn
    ? Number(document.takenOn.slice(0, 4)) - patient.birthYear : null;
  const sexLabel = patient.gender === "male" ? (rtl ? "ذكر" : "Male")
    : patient.gender === "female" ? (rtl ? "أنثى" : "Female")
    : (rtl ? "غير محدد" : "Unspecified");

  const judged = analysis.measurements;
  const groups = [...new Set(judged.map((item) => item.analysis ?? ""))];

  return (
    <main className="print-root" dir={rtl ? "rtl" : "ltr"}>
      <div className="sheet sheet-a4">
        <PrintHeader settings={settings} title={say(T.title, lang)} />
        <ReprintMark printed={printed > 0} />

        <div className="line"><span>{patient.fullName}</span>
          <span>{say(T.file, lang)}: <span dir="ltr">{patient.patientNumber}</span></span></div>
        <div className="line">
          <span>{say(T.sex, lang)}: {sexLabel}</span>
          {age !== null ? <span>{say(T.age, lang)}: {age} {say(T.years, lang)}</span> : null}
          {document.takenOn ? <span>{say(T.xrayDate, lang)}: {dateLong(document.takenOn, lang)}</span> : null}
        </div>
        {/*
          نسبةُ الورقة إلى من وقّعها.

          والدراسة المعتمدة أرقامُها أرقامُ يوم الاعتماد — فنسبتُها إلى آخر من
          عدّل التتبّع بعده تنسب عملًا إلى غير صاحبه، وتؤرّخ ورقةً بتاريخٍ لم
          تُوقَّع فيه. فمن يقرأ الورقة بعد سنتين يجد **من اعتمدها ومتى**.
        */}
        {study?.approvedBy ? null : (
          <div className="line">
            <span>{say(T.tracedBy, lang)}: {tracing.updatedBy ?? tracing.tracedBy}</span>
            <span>{say(T.tracedAt, lang)}: {dateLong((tracing.updatedAt ?? tracing.tracedAt).slice(0, 10), lang)}</span>
          </div>
        )}

        {/*
          هويّة الورقة: أهي دراسةٌ معتمدة أم قراءةُ تتبّعٍ حالي؟ ورقةٌ لا تقول
          ذلك تُقرأ بعد سنتين على أنها ما ليست هي.
        */}
        {study ? (
          <div className="line">
            <span>
              {say(T.study, lang)}: {say(STUDY_PHASE_TEXT[study.phase], lang)}
              {" · "}{say(STUDY_STATUS_TEXT[study.status], lang)}
              {" · "}{say(T.revision, lang)} {study.revision}
            </span>
            {study.approvedBy ? (
              <span>
                {say(T.approvedBy, lang)}: {study.approvedBy}
                {study.approvedAt ? ` · ${dateLong(study.approvedAt.slice(0, 10), lang)}` : ""}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="doc-meta">{say(T.liveNote, lang)}</p>
        )}
        {study?.drifted ? (
          <p className="doc-meta"><strong>{say(T.driftNote, lang)}</strong></p>
        ) : null}

        <div className="rule" />

        {/*
          * الصورة والمعالم عليها.
          *
          * والنقاط بنِسَبها لا بالبكسل — كما تُخزَّن — فتقع على مواضعها مهما كان
          * مقاس الطباعة. و`ceph-frame` يُقيّد العرض والارتفاع معًا حتى يبقى إطار
          * العنصر هو الصورة نفسها، وإلا انزاحت كل نقطة عن معلمها.
          */}
        <div className="ceph-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/documents/${id}`} alt={document.title} className="ceph-image" />
          <svg className="ceph-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
            {lines.map((line) => (
              <line key={line.key}
                x1={line.from.x * 100} y1={line.from.y * 100}
                x2={line.to.x * 100} y2={line.to.y * 100}
                stroke="#000" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {LANDMARKS.map((item) => {
            const point = points[item.code];
            if (!point) return null;
            return (
              <span key={item.code} className="ceph-mark"
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>
                <span className="ceph-dot" />
                <span className="ceph-code" dir="ltr">{item.code}</span>
              </span>
            );
          })}
        </div>

        <p className="doc-meta">
          {say(T.planes, lang)}: {lines.map((line) => say(line.name, lang)).join(" · ") || "—"}
        </p>
        <p className="doc-meta">{say(T.tracingNote, lang)}</p>
        <p className="doc-meta">
          {say(analysis.calibrated ? T.calibrated : T.notCalibrated, lang)}
        </p>

        <div className="rule-light" />

        <table className="items">
          <thead>
            <tr>
              <th>{say(T.measurement, lang)}</th>
              <th className="num">{say(T.value, lang)}</th>
              <th className="num">{say(T.norm, lang)}</th>
              <th className="num">{say(T.diff, lang)}</th>
              <th>{say(T.reading, lang)}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <>
                {group ? (
                  <tr key={`head-${group}`}>
                    <td colSpan={5} className="group-head" dir="ltr">{group}</td>
                  </tr>
                ) : null}
                {judged.filter((item) => (item.analysis ?? "") === group).map((item) => {
                  const z = zScore(item.value, item.norm);
                  const severity = severityOf(z);
                  return (
                    <tr key={item.key}>
                      <td>
                        <span dir="ltr">{item.name}</span>
                        <span className="hint"> — {say(item.meaning, lang)}</span>
                      </td>
                      <td className="num" dir="ltr">{formatMeasurement(item.value, item.unit, lang)}</td>
                      <td className="num" dir="ltr">
                        {item.norm ? `${item.norm.mean}±${item.norm.tolerance}` : "—"}
                      </td>
                      <td className="num" dir="ltr">
                        {item.norm ? (item.value - item.norm.mean).toFixed(1) : "—"}
                      </td>
                      <td>
                        {severity
                          ? <>{say(SEVERITY_LABEL[severity], lang)} <span dir="ltr">(Z {z!.toFixed(1)})</span></>
                          : say(T.unread, lang)}
                      </td>
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>

        <div className="rule-light" />

        {analysis.skeletal ? (
          <p className="line line-strong">
            <span>{say(T.skeletal, lang)}</span>
            <span>{say(SKELETAL_LABEL[analysis.skeletal.klass], lang)}</span>
          </p>
        ) : null}
        <p className="line line-strong">
          <span>{say(T.verticalHead, lang)}</span>
          <span>{analysis.vertical ? say(VERTICAL_LABEL[analysis.vertical], lang) : say(T.undecided, lang)}</span>
        </p>

        {/*
          الملاحظة تتبع مصدر الأرقام: ملاحظةُ الدراسة على ورقة الدراسة، وملاحظةُ
          التتبّع على ورقة التتبّع. وإلحاقُ ملاحظةٍ كُتبت بعد الاعتماد بورقةٍ
          موقَّعة يُضيف إلى الوثيقة ما لم يكن فيها يوم وُقِّعت.
        */}
        {study ? (
          study.note ? <p className="doc-meta">{study.note}</p> : null
        ) : (
          tracing.note ? <p className="doc-meta">{tracing.note}</p> : null
        )}

        <div className="rule-light" />
        <p className="doc-meta">{say(T.manualNote, lang)}</p>
        <p className="doc-meta"><strong>{say(T.disclaimer, lang)}</strong></p>

        <PrintFooter settings={settings} />
      </div>
      <PrintButton docType="ceph" docId={printKey} />
    </main>
  );
}
