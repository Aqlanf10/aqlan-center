import { describe, expect, it } from "vitest";
import {
  MINIMUM_LANDMARKS, STUDY_PHASE_ORDER, canTransition, checkApproval, currentStudy,
  hasDrifted, isStudyPhase, isStudyStatus, nextRevision, sortStudies,
  tracingFingerprint, transitionRefusal, type StudyLike,
} from "../lib/cephStudy";
import type { Calibration, Tracing } from "../lib/ceph";

/**
 * القاعدة الحاكمة: **الدراسة المعتمدة لا تتغيّر تحت من اعتمدها.**
 *
 * وقبل هذا الكيان كان التتبّع صفًّا واحدًا لكل صورة يُكتب فوقه: من يصحّح نقطةً
 * اليوم يغيّر — بأثرٍ رجعي وبلا أثرٍ في السجل — الأرقامَ التي بُنيت عليها خطّةُ
 * علاجٍ قبل سنة. فالخطّة تبقى، والأرقام التي بُرِّرت بها تصير أرقامًا أخرى.
 */

const points = (count: number): Tracing => {
  const codes = ["S", "N", "Or", "Po", "A", "B", "Pog", "Gn", "Me", "Go"] as const;
  const out: Record<string, { x: number; y: number }> = {};
  for (let index = 0; index < count; index += 1) {
    out[codes[index]] = { x: 0.1 * (index + 1), y: 0.2 * (index + 1) };
  }
  return out as Tracing;
};

describe("حالة الدراسة", () => {
  it("المعتمدة لا تعود مسودّة — ولا رجوع من الأرشيف", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("draft", "archived")).toBe(true);
    expect(canTransition("approved", "archived")).toBe(true);
    // إرجاعُها مسودّةً يمحو أن اعتمادًا وقع أصلًا — وهو ما يُسأل عنه بعد سنتين.
    expect(canTransition("approved", "draft")).toBe(false);
    expect(canTransition("archived", "draft")).toBe(false);
    expect(canTransition("archived", "approved")).toBe(false);
  });

  it("والرفض يقول السبب بالعربية ويدلّ على المخرج", () => {
    expect(transitionRefusal("approved", "draft")).toContain("إصدارًا جديدًا");
    expect(transitionRefusal("archived", "approved")).toContain("مؤرشفة");
    expect(transitionRefusal("draft", "draft")).toContain("أصلًا");
  });

  it("والمرحلة والحالة تُقرآن من قائمةٍ مغلقة", () => {
    expect(isStudyPhase("pre")).toBe(true);
    expect(isStudyPhase("during")).toBe(false);
    expect(isStudyPhase(3)).toBe(false);
    expect(isStudyStatus("approved")).toBe(true);
    expect(isStudyStatus("rejected")).toBe(false);
  });
});

describe("الاعتماد توقيعٌ لا حفظ", () => {
  it("دراسةٌ بمعالمَ قليلة لا تُعتمد — والرسالة تقول كم ينقص", () => {
    const verdict = checkApproval({ status: "draft", points: points(4) });
    expect(verdict.ok).toBe(false);
    // «بيانات ناقصة» لا تقول لأحدٍ ماذا يفعل.
    expect(verdict.message).toContain(String(MINIMUM_LANDMARKS));
    expect(verdict.message).toContain("4");
  });

  it("وعند الحدّ تُعتمد — الحدود تُختبر عندها لا حولها", () => {
    expect(checkApproval({ status: "draft", points: points(MINIMUM_LANDMARKS) }).ok).toBe(true);
    expect(checkApproval({ status: "draft", points: points(MINIMUM_LANDMARKS - 1) }).ok).toBe(false);
  });

  it("ومعتمدةٌ لا تُعتمد ثانيةً", () => {
    const verdict = checkApproval({ status: "approved", points: points(10) });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("أصلًا");
  });
});

describe("البصمة — أتغيّر التتبّع عمّا اعتُمد؟", () => {
  const calibration: Calibration = {
    from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.1 }, millimetres: 20,
  };

  it("نفس النقاط بترتيبٍ آخر تعطي البصمة نفسها", () => {
    const forward = { S: { x: 0.1, y: 0.2 }, N: { x: 0.3, y: 0.4 } } as Tracing;
    const backward = { N: { x: 0.3, y: 0.4 }, S: { x: 0.1, y: 0.2 } } as Tracing;
    expect(tracingFingerprint(forward, null)).toBe(tracingFingerprint(backward, null));
  });

  it("وتحريكُ نقطةٍ واحدة يُغيّرها", () => {
    const before = { S: { x: 0.1, y: 0.2 } } as Tracing;
    const after = { S: { x: 0.1, y: 0.2001 } } as Tracing;
    expect(tracingFingerprint(before, null)).not.toBe(tracingFingerprint(after, null));
  });

  it("وتغيّرُ المعايرة وحدها يُغيّرها — القياس الخطّي يتبعها", () => {
    const same = points(6);
    expect(tracingFingerprint(same, calibration)).not.toBe(tracingFingerprint(same, null));
    expect(tracingFingerprint(same, calibration))
      .not.toBe(tracingFingerprint(same, { ...calibration, millimetres: 25 }));
  });

  it("وحذفُ نقطةٍ يُكشف — لا يُقرأ نقصٌ على أنه تطابق", () => {
    expect(hasDrifted(
      { points: points(6), calibration: null },
      { points: points(5), calibration: null },
    )).toBe(true);
  });

  it("ولا انحراف حين لا شيء تغيّر", () => {
    expect(hasDrifted(
      { points: points(6), calibration },
      { points: points(6), calibration },
    )).toBe(false);
  });
});

describe("ترتيب الدراسات في الملف", () => {
  const made = (over: Partial<StudyLike> & { id: number }): StudyLike => ({
    phase: "pre", status: "draft", revision: 1, takenOn: null,
    createdAt: "2026-01-01T00:00:00.000Z", ...over,
  });

  const studies: StudyLike[] = [
    made({ id: 1, phase: "post", takenOn: "2026-08-01", status: "approved" }),
    made({ id: 2, phase: "pre", takenOn: "2025-01-10", status: "approved" }),
    made({ id: 3, phase: "pre", takenOn: "2025-06-10", status: "approved", revision: 2 }),
    made({ id: 4, phase: "mid", takenOn: "2026-02-01", status: "draft" }),
    made({ id: 5, phase: "pre", takenOn: "2026-07-01", status: "draft" }),
  ];

  it("بمرحلة العلاج أوّلًا — كما هي في رأس الطبيب", () => {
    const order = sortStudies(studies).map((study) => study.phase);
    expect(order).toEqual(["pre", "pre", "pre", "mid", "post"]);
    expect(STUDY_PHASE_ORDER).toEqual(["pre", "mid", "post", "followup"]);
  });

  it("وداخل المرحلة الأحدث أوّلًا", () => {
    const pre = sortStudies(studies).filter((study) => study.phase === "pre");
    expect(pre.map((study) => study.id)).toEqual([5, 3, 2]);
  });

  it("ولا يُغيَّر المصفوف الأصلي", () => {
    const before = studies.map((study) => study.id);
    sortStudies(studies);
    expect(studies.map((study) => study.id)).toEqual(before);
  });

  it("والمعتمدة هي المرجع — لا المسودّة ولو كانت أحدث", () => {
    // الخطّة تُبنى على ما وُقِّع؛ ونصفُ عملٍ لا يُقارَن به علاجُ سنتين.
    expect(currentStudy(studies, "pre")?.id).toBe(3);
    expect(currentStudy(studies, "mid")).toBeNull();
    expect(currentStudy(studies, "followup")).toBeNull();
  });

  it("والفحص نفسه يمسك تفضيل الأحدث بلا نظرٍ في الحالة", () => {
    const latestAny = sortStudies(studies.filter((study) => study.phase === "pre"))[0];
    expect(latestAny.id).toBe(5);
    expect(latestAny.status).toBe("draft");
    expect(currentStudy(studies, "pre")?.id).not.toBe(latestAny.id);
  });
});

describe("الإصدارات تتراكم ولا تُستبدل", () => {
  it("الإصدار التالي فوق الأعلى لا فوق العدد", () => {
    expect(nextRevision([])).toBe(1);
    expect(nextRevision([{ revision: 1 }])).toBe(2);
    // إصدارٌ حُذف من الوسط لا يُعيد استعمال رقمه.
    expect(nextRevision([{ revision: 1 }, { revision: 4 }])).toBe(5);
  });
});
