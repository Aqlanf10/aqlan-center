import { notFound } from "next/navigation";
import { CLINIC_TIME_ZONE, getPrescription, getSettingsSafe, printCount } from "@/lib/db";
import { ageFromBirthYear, ageText, GENDER_LABEL, type Gender } from "@/lib/patient";
import { clinicDateString } from "@/lib/schedule";
import { showsInstructions } from "@/lib/prescription";
import { dateLong } from "@/lib/reminders";
import { PrintHeader, PrintFooter } from "@/components/PrintHeader";
import { PrintButton, ReprintMark } from "@/components/PrintButton";
import { canTreat } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * الوصفة الطبية — الورقة التي يحملها المريض إلى الصيدلية.
 *
 * **وتُطبع من الوصفة المحفوظة وحدها.** ولا يدخل شيءٌ من محتواها عبر الرابط:
 * صفحةٌ تبني الروشتة من عنوانها تعني أنّ كل من يملك جلسةً يستطيع أن يطبع أيّ
 * دواءٍ بأيّ جرعة على ترويسة المركز وتحت اسم طبيب — وهي في يد حاملها وصفةٌ
 * حقيقية يصرف بها الصيدليّ.
 *
 * ولا تُخترع وصفةٌ عند الفراغ: رقمٌ لا وصفة له يُردّ ٤٠٤، ولا يُطبع «مثال».
 *
 * وأسماء الأدوية بالإنجليزية — لغة العلب والصيدليات — وتعليمات المريض باللغة
 * التي اختارها الطبيب عند الإصدار، فالمريض هو من يقرؤها.
 */
export default async function PrescriptionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // وصفةٌ تشخيصٌ وعلاج — للطبيب والمدير، لا للاستقبال.
  const session = await requireSession();
  if (!session || !canTreat(session.role)) notFound();

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const rx = await getPrescription(id);
  if (!rx) notFound();

  const [settings, printed] = await Promise.all([
    getSettingsSafe(), printCount("prescription", id),
  ]);

  /*
   * يوم الإصدار **بتوقيت العيادة** لا بـ`slice(0,10)` على طابع UTC.
   *
   * واليمن على ‎+٣‎: وصفةٌ تُكتب الواحدة صباحًا يقول طابعُها العالمي إنّها من
   * اليوم السابق، فتُطبع بتاريخٍ غير يومها — وعلى رأس السنة يخطئ العمر سنةً.
   */
  const issuedOn = clinicDateString(new Date(rx.issuedAt), CLINIC_TIME_ZONE);
  // والعمر يوم الإصدار لا اليوم: وصفةُ طفلٍ تبقى وصفة طفل، والجرعة بُنيت عليه.
  const age = ageFromBirthYear(rx.birthYear, issuedOn);
  const voided = Boolean(rx.voidedAt);

  return (
    <main className="print-root" dir="rtl">
      <div className="sheet sheet-a5">
        <PrintHeader settings={settings} title="وصفة طبية" compact />
        <ReprintMark printed={printed > 0} />

        {/*
          * المُبطَلة تُطبع مختومةً بالإبطال ولا تُمنع من الطباعة.
          *
          * فقد تُطلب نسخةٌ منها للملف أو للمراجعة، ومنعُها يدفع إلى تصويرها من
          * مكانٍ آخر بلا ختم. والختم فوق الدواء لا تحته — كي لا تُقرأ سطرًا
          * سطرًا ثم يُكتشف في آخرها أنّها لاغية.
          */}
        {voided ? (
          <p className="rx-void">
            وصفةٌ مُبطَلة — لا تُصرف.
            {rx.voidReason ? <> السبب: {rx.voidReason}</> : null}
            {rx.voidedBy ? <> · أبطلها {rx.voidedBy}</> : null}
          </p>
        ) : null}

        <div className="line">
          <span>{rx.patientName}</span>
          <span>رقم الملف: <span dir="ltr">{rx.patientNumber}</span></span>
        </div>
        <div className="line">
          <span>{ageText(age)} · {GENDER_LABEL[rx.gender as Gender] ?? "غير محدد"}</span>
          <span>{dateLong(issuedOn, "ar")}</span>
        </div>

        {/*
          * تنبيه الحساسية من **لقطة** ملف المريض يوم الإصدار.
          *
          * وهو أهمّ سطرٍ في الورقة: مريضٌ يحسّس من البنسلين تُصرف له أموكسيسيلين
          * حادثةٌ تُقتل. فيُقرأ من الملف حيث سُجّل مرّةً، ولا يُترك لذاكرة من
          * يكتب الوصفة في يومٍ مزدحم.
          */}
        {rx.medicalAlert ? (
          <p className="rx-alert">تنبيه طبي: {rx.medicalAlert}</p>
        ) : null}

        {rx.diagnosis ? (
          <div className="line"><span>التشخيص</span><span>{rx.diagnosis}</span></div>
        ) : null}

        <div className="rule" />

        <p className="rx-mark">
          <span className="rx-sign" dir="ltr">℞</span>
          <span>الوصفة والجرعات · <span dir="ltr">Prescription &amp; Dosage</span></span>
        </p>

        <ol className="rx-list" dir="ltr">
          {rx.items.map((item, index) => (
            <li key={`${item.name}-${index}`}>
              <div className="rx-head">
                <span className="rx-name">{index + 1}. {item.name}</span>
                {item.dose ? <span className="rx-dose">({item.dose})</span> : null}
                {item.form ? <span className="rx-form">— {item.form}</span> : null}
                {item.duration ? <span className="rx-duration">{item.duration}</span> : null}
              </div>
              {item.frequency ? <div className="rx-freq">{item.frequency}</div> : null}
              {showsInstructions(rx.instructionsLang, "ar") && item.instructions ? (
                <div className="rx-note" dir="rtl"><strong>التعليمات: </strong>{item.instructions}</div>
              ) : null}
              {showsInstructions(rx.instructionsLang, "en") && item.instructionsEn ? (
                <div className="rx-note"><strong>Instructions: </strong>{item.instructionsEn}</div>
              ) : null}
            </li>
          ))}
        </ol>

        {rx.notes ? <p className="doc-meta"><strong>إرشادات إضافية: </strong>{rx.notes}</p> : null}

        <div className="sign-row">
          <div>
            <div className="doc-meta">الطبيب المعالج</div>
            <div className="line-strong">{rx.issuedBy}</div>
          </div>
          <div>
            <div className="doc-meta">التوقيع والختم</div>
            <div className="rx-stamp" />
          </div>
        </div>

        <PrintFooter settings={settings} />
      </div>
      <PrintButton docType="prescription" docId={id} />
    </main>
  );
}
