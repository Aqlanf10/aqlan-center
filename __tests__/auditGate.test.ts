import { describe, expect, it } from "vitest";
import { BLOCKING, readAudit, verdict } from "../lib/auditGate";

// تقريرٌ حقيقيّ من `npm audit --json` حين يجيب السجلّ.
const clean = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});

// وشكل الخطأ حين لا يجيب — لا `metadata` فيه إطلاقًا.
const registryDown = JSON.stringify({
  message: "400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick",
  statusCode: 400,
  error: { summary: "", detail: "" },
});

describe("قراءة تقرير الثغرات", () => {
  it("تميّز التقرير من عجز السجلّ — وهما ما كانا يختلطان", () => {
    expect(readAudit(clean).kind).toBe("report");
    expect(readAudit(registryDown).kind).toBe("registry");
  });

  it("تعدّ الحاجب من الدرجتين معًا لا من واحدة", () => {
    const both = JSON.stringify({
      metadata: { vulnerabilities: { info: 3, low: 9, moderate: 4, high: 2, critical: 1, total: 19 } },
    });
    const read = readAudit(both);
    if (read.kind !== "report") throw new Error("قُرئ التقرير على غير أنه تقرير");
    expect(read.blocking).toBe(3);
  });

  it("لا تعدّ المنخفض والمتوسط حاجبًا — البوّابة على الخطير فأعلى", () => {
    const noisy = JSON.stringify({
      metadata: { vulnerabilities: { info: 5, low: 12, moderate: 7, high: 0, critical: 0, total: 24 } },
    });
    const read = readAudit(noisy);
    if (read.kind !== "report") throw new Error("قُرئ التقرير على غير أنه تقرير");
    expect(read.blocking).toBe(0);
    expect(BLOCKING).toEqual(["critical", "high"]);
  });

  it("مخرجٌ ليس JSON لا يُقرأ تقريرًا سليمًا", () => {
    expect(readAudit("npm error code E401").kind).toBe("unreadable");
    expect(readAudit("").kind).toBe("unreadable");
  });
});

describe("قرار البوّابة", () => {
  it("تمرّ حين يجيب السجلّ بلا ثغرةٍ حاجبة", () => {
    const decision = verdict([readAudit(clean)]);
    expect(decision.pass).toBe(true);
    expect(decision.code).toBe(0);
  });

  it("تسقط بالرمز ١ على ثغرةٍ حقيقية", () => {
    const vulnerable = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    });
    const decision = verdict([readAudit(vulnerable)]);
    expect(decision.pass).toBe(false);
    expect(decision.code).toBe(1);
  });

  it("تسقط بالرمز ٢ حين يعجز السجلّ — ولا تقول إنها سليمة", () => {
    const decision = verdict([readAudit(registryDown), readAudit(registryDown), readAudit(registryDown)]);
    expect(decision.pass).toBe(false);
    expect(decision.code).toBe(2);
    expect(decision.reason).toContain("لم تُفحص");
  });

  it("عجزٌ ثم إجابة: القرار على الإجابة لا على العجز قبلها", () => {
    const decision = verdict([readAudit(registryDown), readAudit(registryDown), readAudit(clean)]);
    expect(decision.pass).toBe(true);
    expect(decision.code).toBe(0);
  });

  it("الرمزان مختلفان — وإلّا عادا إلى الاختلاط الذي أُنشئت البوّابة لرفعه", () => {
    const vulnerable = JSON.stringify({
      metadata: { vulnerabilities: { high: 2, critical: 0, moderate: 0, low: 0, info: 0, total: 2 } },
    });
    expect(verdict([readAudit(vulnerable)]).code).not.toBe(verdict([readAudit(registryDown)]).code);
  });
});
