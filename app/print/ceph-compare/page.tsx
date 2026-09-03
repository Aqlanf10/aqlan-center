import { notFound } from "next/navigation";
import { cephStudyAnalysis, getPatient, getSettingsSafe, printCount } from "@/lib/db";
import { STUDY_PHASE_TEXT, STUDY_STATUS_TEXT } from "@/lib/cephStudy";
import {
  CHANGE_LABEL, chronologicalOrder, compareAnalyses, comparisonSummary,
} from "@/lib/cephCompare";
import { superimposeOnSN } from "@/lib/cephSuperimpose";
import { formatMeasurement, referenceLines, say, type Lang } from "@/lib/ceph";
import { friendlyDateLong } from "@/lib/reminders";
import { PrintHeader, PrintFooter } from "@/components/PrintHeader";
import { PrintButton, ReprintMark } from "@/components/PrintButton";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * ورقة «قبل وبعد» — المقارنة والتراكب على ورقةٍ واحدة.
 *
 * والمقارنة والتراكب كانا على الشاشة وحدها. وهما بالضبط ما يُخرَج من الشاشة:
 * يُريهما الطبيب للمريض وأهله عند نهاية المرحلة، ويُرسلان مع الإحالة، ويُحفظان
 * في الملف. فوحدةٌ تُنتج المقارنة ولا تُخرجها نصفُ وحدة — كما كان التحليل قبل
 * أن تُبنى ورقته.
 *
 * **والترتيب هنا لا يتبع الرابط.** «قبل» هي الأقدم زمنيًّا و«بعد» الأحدث،
 * يُفرضان بـ`chronologicalOrder` نفسِه الذي تفرضه واجهة المقارنة — وقلبُهما
 * يقلب كل إشارةٍ وكل اتجاه، فتُقرأ نكسةٌ تحسّنًا على ورقةٍ تُعطى لمريض.
 */
export default async function CephComparePage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string; second?: string; lang?: string }>;
}) {
  // تشخيصٌ سريري — للطبيب والمدير، لا للاستقبال؛ كما في ورقة التحليل.
  const session = await requireSession();
  if (!session || (!isAdmin(session.role) && session.role !== "doctor")) notFound();

  const { first: rawFirst, second: rawSecond, lang: rawLang } = await searchParams;
  const first = Number(rawFirst);
  const second = Number(rawSecond);
  if (!Number.isInteger(first) || first <= 0) notFound();
  if (!Number.isInteger(second) || second <= 0) notFound();
  if (first === second) notFound();

  const lang: Lang = rawLang === "en" ? "en" : "ar";
  const rtl = lang === "ar";

  const [one, two] = await Promise.all([cephStudyAnalysis(first), cephStudyAnalysis(second)]);
  if (!one || !two) notFound();
  // مريضان مختلفان: ورقةٌ بلا معنى، وخطأٌ لا يُكتشف إلّا بعد أن يُبنى عليه.
  if (one.study.patientId !== two.study.patientId) notFound();

  const [before, after] = chronologicalOrder(
    { ...one.study, reading: one },
    { ...two.study, reading: two },
  );

  const [patient, settings] = await Promise.all([
    getPatient(before.patientId), getSettingsSafe(),
  ]);
  if (!patient) notFound();

  const comparison = compareAnalyses(before.reading.analysis, after.reading.analysis);
  const summary = comparisonSummary(comparison);

  const placed = superimposeOnSN(
    { points: before.reading.points, calibration: before.reading.calibration, aspect: before.reading.aspect },
    { points: after.reading.points, calibration: after.reading.calibration, aspect: after.reading.aspect },
  );

  /*
   * هويّة الطبعة من الدراستين معًا وبترتيبهما الزمني.
   *
   * ومقارنةُ (أ،ب) هي مقارنةُ (ب،أ) — الترتيب مفروضٌ لا مأخوذٌ من الرابط —
   * فمفتاحٌ يتبع الرابط يجعل الطبعة الثانية بالترتيب المقلوب «أولى»، ويقول عن
   * ورقةٍ معادة إنها جديدة.
   */
  const printKey = `${before.id}:${after.id}`;
  const printed = await printCount("ceph-compare", printKey);

  const T = {
    title: { ar: "مقارنة دراستين سيفالومتريتين", en: "Cephalometric Study Comparison" },
    file: { ar: "رقم الملف", en: "File no." },
    before: { ar: "قبل", en: "Before" },
    after: { ar: "بعد", en: "After" },
    revision: { ar: "إصدار", en: "Revision" },
    approvedBy: { ar: "اعتمدها", en: "Approved by" },
    measurement: { ar: "القياس", en: "Measurement" },
    delta: { ar: "الفرق", en: "Change" },
    direction: { ar: "الاتجاه", en: "Direction" },
    summary: { ar: "الحصيلة", en: "Tally" },
    onlyOne: { ar: "قيست في واحدةٍ فقط فلم تُقارَن", en: "Measured in one study only — not compared" },
    superimposition: { ar: "التراكب على قاعدة الجمجمة", en: "Superimposition on the cranial base" },
    cranialBase: { ar: "طول S–N", en: "S–N length" },
    growth: { ar: "نموّ قاعدة الجمجمة", en: "Cranial base growth" },
    rotation: { ar: "دوران التسوية", en: "Alignment rotation" },
    degrees: { ar: "درجة", en: "°" },
    noSuperimposition: { ar: "لا تراكب على هذه الورقة", en: "No superimposition on this sheet" },
    legend: {
      ar: "المتّصل: الدراسة الأقدم في مكانها. المتقطّع: الأحدث منقولةً إليها على S وخطّ SN، بمقياس المعايرة لا بطول SN.",
      en: "Solid: the earlier study in place. Dashed: the later one moved onto it at S along SN, scaled by calibration — never by SN length.",
    },
    draftWarning: {
      ar: "إحدى الدراستين مسوّدة غير معتمدة — أرقامها تتغيّر بتغيّر التتبّع، وهذه الورقة ليست وثيقةً موقَّعة.",
      en: "One of the studies is an unapproved draft; its figures change with the tracing, and this sheet is not a signed document.",
    },
    driftNote: {
      ar: "إحدى الدراستين اعتُمدت ثم تغيّر تتبّع صورتها بعدها — والأرقام هنا أرقامُ يوم الاعتماد.",
      en: "One study was approved and its image tracing changed afterwards; the figures here are those of the approval date.",
    },
    noiseNote: {
      ar: `«بلا تغيّر يُذكر» تعني أنّ الفرق لا يتجاوز حدّ الضجيج — ووضعُ معلمٍ باليد يختلف من مرّةٍ إلى أخرى، ففرقٌ أصغر منه لا يُنسب إلى العلاج.`,
      en: "“No meaningful change” means the difference is within the noise floor: hand-placed landmarks vary between sittings, so a smaller difference is not attributed to treatment.",
    },
    disclaimer: {
      ar: "هذه الورقة تعدّ قياساتٍ اقتربت من معاييرها وأخرى ابتعدت، ولا تحكم على العلاج. والحكم للطبيب مع الفحص السريري وبقيّة السجلات.",
      en: "This sheet counts measurements that moved toward or away from their norms; it does not judge the treatment. That judgement is the clinician's, with the clinical examination and the rest of the record.",
    },
  };

  const identity = (study: typeof before) => (
    <>
      {say(STUDY_PHASE_TEXT[study.phase], lang)}
      {" · "}{say(STUDY_STATUS_TEXT[study.status], lang)}
      {" · "}{say(T.revision, lang)} {study.revision}
      {study.takenOn ? ` · ${friendlyDateLong(study.takenOn)}` : ""}
      {study.approvedBy ? ` · ${say(T.approvedBy, lang)} ${study.approvedBy}` : ""}
    </>
  );

  const isDraft = before.status === "draft" || after.status === "draft";
  const drifted = Boolean(before.drifted || after.drifted);

  // الرسم بلا صورة، فالنسبة تدخل الإحداثيّ الأفقي بيدنا: كسورٌ من عرضٍ وارتفاع
  // مختلفين لا تُرسم في مربّع، وإلّا انحرفت كل زاوية عن التي في الجدول.
  const aspect = before.reading.aspect > 0 ? before.reading.aspect : 1;
  const beforeLines = referenceLines(before.reading.points);
  const afterLines = placed.ok ? referenceLines(placed.value.points) : [];
  const groups = [...new Set(comparison.measurements.map((item) => item.analysis ?? ""))];

  return (
    <main className="print-root" dir={rtl ? "rtl" : "ltr"}>
      <div className="sheet sheet-a4">
        <PrintHeader settings={settings} title={say(T.title, lang)} />
        <ReprintMark printed={printed > 0} />

        <div className="line">
          <span>{patient.fullName}</span>
          <span>{say(T.file, lang)}: <span dir="ltr">{patient.patientNumber}</span></span>
        </div>
        <div className="line"><span>{say(T.before, lang)}: {identity(before)}</span></div>
        <div className="line"><span>{say(T.after, lang)}: {identity(after)}</span></div>

        {isDraft ? <p className="doc-meta"><strong>{say(T.draftWarning, lang)}</strong></p> : null}
        {drifted ? <p className="doc-meta"><strong>{say(T.driftNote, lang)}</strong></p> : null}

        <div className="rule" />

        <p className="line line-strong"><span>{say(T.superimposition, lang)}</span></p>
        {placed.ok ? (
          <>
            <svg
              className="ceph-superimpose"
              viewBox={`0 0 ${(100 * aspect).toFixed(3)} 100`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={say(T.superimposition, lang)}
            >
              {beforeLines.map((line) => (
                <line key={`b-${line.key}`}
                  x1={line.from.x * aspect * 100} y1={line.from.y * 100}
                  x2={line.to.x * aspect * 100} y2={line.to.y * 100}
                  stroke="#000" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
              ))}
              {afterLines.map((line) => (
                <line key={`a-${line.key}`}
                  x1={line.from.x * aspect * 100} y1={line.from.y * 100}
                  x2={line.to.x * aspect * 100} y2={line.to.y * 100}
                  stroke="#000" strokeWidth="0.4" strokeDasharray="2 1.5"
                  vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <p className="doc-meta">{say(T.legend, lang)}</p>
            <div className="line">
              <span>
                {say(T.cranialBase, lang)}: <span dir="ltr">
                  {placed.value.cranialBaseBefore.toFixed(1)} → {placed.value.cranialBaseAfter.toFixed(1)} mm
                </span>
              </span>
              <span>
                {say(T.growth, lang)}: <span dir="ltr">
                  {(placed.value.cranialBaseAfter - placed.value.cranialBaseBefore).toFixed(1)} mm
                </span>
              </span>
              <span>
                {say(T.rotation, lang)}: <span dir="ltr">
                  {placed.value.rotationDegrees.toFixed(1)}
                </span> {say(T.degrees, lang)}
              </span>
            </div>
          </>
        ) : (
          /*
           * وسببُ التعذّر يُكتب على الورقة.
           *
           * وورقةٌ تسكت عمّا لم تفعله تُقرأ على أنّ التراكب فُحص فلم يُظهر شيئًا،
           * وهو لم يُحسب أصلًا. والرسالة تقول ما ينقص وما يُفعل.
           */
          <p className="doc-meta">
            <strong>{say(T.noSuperimposition, lang)}</strong> — {placed.message}
          </p>
        )}

        <div className="rule-light" />

        <table className="items">
          <thead>
            <tr>
              <th>{say(T.measurement, lang)}</th>
              <th className="num">{say(T.before, lang)}</th>
              <th className="num">{say(T.after, lang)}</th>
              <th className="num">{say(T.delta, lang)}</th>
              <th>{say(T.direction, lang)}</th>
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
                {comparison.measurements
                  .filter((item) => (item.analysis ?? "") === group)
                  .map((item) => (
                    <tr key={item.key}>
                      <td><span dir="ltr">{item.name}</span></td>
                      <td className="num" dir="ltr">{formatMeasurement(item.before, item.unit, lang)}</td>
                      <td className="num" dir="ltr">{formatMeasurement(item.after, item.unit, lang)}</td>
                      {/* الفرق بإشارته كما هو — الموجب يُسبق بعلامته كي لا يُقرأ سالبًا. */}
                      <td className="num" dir="ltr">
                        {item.delta > 0 ? "+" : ""}{formatMeasurement(item.delta, item.unit, lang)}
                      </td>
                      <td>{say(CHANGE_LABEL[item.direction], lang)}</td>
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
        </table>

        <div className="rule-light" />

        <p className="line line-strong">
          <span>{say(T.summary, lang)}</span>
          <span>{say(summary, lang)}</span>
        </p>

        {comparison.onlyBefore.length > 0 || comparison.onlyAfter.length > 0 ? (
          <p className="doc-meta">
            {say(T.onlyOne, lang)}: <span dir="ltr">
              {[...comparison.onlyBefore, ...comparison.onlyAfter].join(" · ")}
            </span>
          </p>
        ) : null}

        <p className="doc-meta">{say(T.noiseNote, lang)}</p>
        <p className="doc-meta"><strong>{say(T.disclaimer, lang)}</strong></p>

        <PrintFooter settings={settings} />
      </div>
      <PrintButton docType="ceph-compare" docId={printKey} />
    </main>
  );
}
