import { describe, expect, it } from "vitest";
import {
  analyse,
  angleAt,
  distanceBetween,
  formatMeasurement,
  isLandmarkCode,
  lineAngle,
  say,
  LANDMARKS,
  SKELETAL_LABEL,
  millimetresPerUnit,
  offsetFromLine,
  DEFAULT_NORMS,
  NORM_LABEL,
  zScore,
  severityOf,
  verticalPattern,
  skeletalClass,
  verdictFor,
  NORMS,
  ADULT_AGE,
  ageFromBirthYear,
  applicableNorm,
  analysisFromSource,
  groupByAnalysis,
  type Tracing,
} from "../lib/ceph";

/*
 * وجهٌ سويّ بُني بالحساب لا بالتخمين.
 *
 * وُضعت S وN، ثم اشتُقّت A وB على شعاعين يبعدان ٨٢° و٨٠° عن شعاع N→S — فإن كانت
 * الصيغة صحيحة أعادت ٨٢ و٨٠ بالضبط. وإحداثيات الصورة هنا كما هي في الواقع: x
 * يزداد أمامًا والمريض ينظر يمينًا، وy يزداد **نزولًا**.
 */
const NORMAL: Tracing = {
  S: { x: 0.34, y: 0.235 },
  N: { x: 0.62, y: 0.26 },
  A: { x: 0.5588, y: 0.5230 },
  B: { x: 0.5158, y: 0.6462 },
};

describe("الزاوية عند رأس", () => {
  it("قائمةٌ حين تكون قائمة", () => {
    // y الصورة تزداد نزولًا، فالنقطة ذات y الأكبر أسفل.
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 6);
  });

  it("مستقيمةٌ حين تكون على استقامة", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180, 6);
  });

  it("لا تتأثّر بترتيب الضلعين", () => {
    const a = angleAt(NORMAL.N!, NORMAL.S!, NORMAL.A!);
    const b = angleAt(NORMAL.N!, NORMAL.A!, NORMAL.S!);
    expect(a).toBeCloseTo(b, 10);
  });

  it("تراعي أن الصورة ليست مربّعة", () => {
    // إزاحةٌ نسبية متساوية على صورةٍ عرضها ضعف ارتفاعها ليست زاوية ٤٥°.
    const square = angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, 1);
    const wide = angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, 2);
    expect(square).toBeCloseTo(45, 6);
    expect(wide).toBeLessThan(square);
  });
});

describe("التحليل على وجهٍ سويّ", () => {
  const result = analyse({ tracing: NORMAL });
  const value = (key: string) => result.measurements.find((m) => m.key === key)!.value;

  it("SNA ٨٢ وSNB ٨٠", () => {
    expect(value("SNA")).toBeCloseTo(82, 1);
    expect(value("SNB")).toBeCloseTo(80, 1);
  });

  it("وANB فرقُهما لا زاويةٌ تُقاس", () => {
    expect(value("ANB")).toBeCloseTo(2, 1);
    expect(value("ANB")).toBeCloseTo(value("SNA") - value("SNB"), 10);
  });

  it("وكلّها ضمن المعيار", () => {
    expect(result.measurements.every((m) => m.verdict === "normal")).toBe(true);
  });

  it("والتصنيف الأول", () => {
    expect(result.skeletal?.klass).toBe("I");
    expect(result.missing).toEqual([]);
  });

  it("والنصوص بلغتين", () => {
    const sna = result.measurements.find((m) => m.key === "SNA")!;
    expect(say(sna.meaning, "ar")).toContain("الفك العلوي");
    expect(say(sna.meaning, "en")).toContain("Maxillary");
    expect(say(SKELETAL_LABEL.I, "en")).toContain("Class I");
  });

  it("والقياس يذكر نقاطه — فيُعرف ما يُراجَع", () => {
    expect(result.measurements.find((m) => m.key === "ANB")!.from).toEqual(["S", "N", "A", "B"]);
  });
});

describe("التصنيف الهيكلي", () => {
  it("ثانٍ حين يتخلّف الفك السفلي", () => {
    // يُزاح B خلفًا فتكبر ANB.
    const back = analyse({ tracing: { ...NORMAL, B: { x: 0.44, y: 0.66 } } });
    expect(back.skeletal!.anb).toBeGreaterThan(4);
    expect(back.skeletal!.klass).toBe("II");
  });

  it("وثالثٌ حين يتقدّم — وANB سالبة لا تُلغى", () => {
    const forward = analyse({ tracing: { ...NORMAL, B: { x: 0.60, y: 0.63 } } });
    expect(forward.skeletal!.anb).toBeLessThan(0);
    expect(forward.skeletal!.klass).toBe("III");
  });

  it("والحدود كما هي معرّفة", () => {
    expect(skeletalClass(0)).toBe("I");
    expect(skeletalClass(4)).toBe("I");
    expect(skeletalClass(4.1)).toBe("II");
    expect(skeletalClass(-0.1)).toBe("III");
  });
});

describe("النقص يُقال لا يُسكت عنه", () => {
  it("تحليلٌ ناقص النقاط يذكر الناقص باسمه", () => {
    const partial = analyse({ tracing: { S: NORMAL.S, N: NORMAL.N } });
    expect(partial.missing).toEqual(["A", "B"]);
    expect(partial.skeletal).toBeNull();
    expect(partial.measurements).toEqual([]);
  });

  it("ونقطةٌ واحدة ناقصة تُسقط ما يعتمد عليها وحده", () => {
    const noB = analyse({ tracing: { S: NORMAL.S, N: NORMAL.N, A: NORMAL.A } });
    expect(noB.missing).toEqual(["B"]);
    expect(noB.measurements.map((m) => m.key)).toEqual(["SNA"]);
    expect(noB.skeletal).toBeNull();
  });
});

describe("المعايرة", () => {
  it("بلا معايرة لا قياس طولي", () => {
    expect(analyse({ tracing: NORMAL }).calibrated).toBe(false);
  });

  it("ومعها يُعرف المليمتر من وحدة الصورة", () => {
    const calibration = { from: { x: 0.1, y: 0.9 }, to: { x: 0.3, y: 0.9 }, millimetres: 20 };
    expect(millimetresPerUnit(calibration)).toBeCloseTo(100, 6);
    expect(analyse({ tracing: NORMAL, calibration }).calibrated).toBe(true);
  });

  it("ومعايرةٌ فاسدة لا تُقبل", () => {
    expect(millimetresPerUnit({ from: { x: 0.1, y: 0.5 }, to: { x: 0.1, y: 0.5 }, millimetres: 20 })).toBeNull();
    expect(millimetresPerUnit({ from: { x: 0.1, y: 0.5 }, to: { x: 0.3, y: 0.5 }, millimetres: 0 })).toBeNull();
  });

  it("والمسافة تراعي نسبة الصورة", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, 2)).toBeCloseTo(2, 6);
  });
});

describe("الحكم والعرض", () => {
  it("خارج المعيار مرتفعٌ أو منخفض", () => {
    expect(verdictFor(82, NORMS.SNA)).toBe("normal");
    expect(verdictFor(84, NORMS.SNA)).toBe("normal");
    expect(verdictFor(84.1, NORMS.SNA)).toBe("high");
    expect(verdictFor(79.9, NORMS.SNA)).toBe("low");
  });

  it("والرقم يُعرض بوحدته", () => {
    expect(formatMeasurement(82.04, "deg")).toBe("82.0°");
    expect(formatMeasurement(4.25, "mm")).toBe("4.3 مم");
    expect(formatMeasurement(Number.NaN, "deg")).toBe("—");
  });

  it("ورمز النقطة قائمة مغلقة", () => {
    expect(isLandmarkCode("S")).toBe(true);
    expect(isLandmarkCode("XX")).toBe(false);
  });
});


/*
 * زوايا المستويات — الاصطلاح مثبَّتٌ بالبناء لا بالذاكرة.
 *
 * يُبنى وجهٌ سويّ في إطار فرانكفورت من قيمٍ معيارية، ثم يُختبر أمران:
 * أوّلهما أن يعيد كل قياس معياره، وثانيهما — وهو الأهم — أن **تتحقق علاقتان
 * متقاطعتان** لا تصحّان إلا إن صحّ الاصطلاح كلّه معًا. ثم يُختبر اتجاه التغيّر،
 * وهو الحارس الذي لا يمرّ منه اصطلاحٌ مقلوب أبدًا.
 */
const rad = (deg: number) => (deg * Math.PI) / 180;

// إطار فرانكفورت أفقي، ثم يُقلب المحور الرأسي إلى اصطلاح الصورة (y نزولًا).
const frame = (x: number, y: number) => ({ x: x / 200, y: (100 - y) / 200 });
const along = (from: { x: number; y: number }, deg: number, len: number) =>
  ({ x: from.x + Math.cos(rad(deg)) * len, y: from.y + Math.sin(rad(deg)) * len });

const fPo = { x: 0, y: 0 }, fOr = { x: 75, y: 0 };
const fS = { x: 20, y: 20 };
const fN = along(fS, 7, 71);                        // SN بميل ٧° عن فرانكفورت
const dirNS = (Math.atan2(fS.y - fN.y, fS.x - fN.x) * 180) / Math.PI;
const fA = along(fN, dirNS + 82, 50);               // SNA ٨٢
const fB = along(fN, dirNS + 80, 75);               // SNB ٨٠
const fGo = { x: 15, y: -45 }, fMe = { x: 85, y: -78 };
// Gn على الذقن بين Pogonion وMenton — أمامه بمليمتر وعلى ارتفاعه تقريبًا، كما
// يقول الدليل. ووضعُه أعلى من Menton بستّة مليمترات (كما جرّبتُ أولًا) يجعل
// مستوى Go-Gn أضحل من مستوى Go-Me فتخرج SN-GoGn أقل من معيارها — وهو خطأٌ في
// الوجه المصنوع لا في الصيغة، ولولا اشتراط المعيار لمرّ.
const fGn = { x: 86, y: -78.1 };
const fU1A = { x: 88, y: -10 }, fU1T = along(fU1A, -70, 25);
const fL1A = { x: 80, y: -48 }, fL1T = along(fL1A, 64.8, 25);

const FACE: Tracing = {
  S: frame(fS.x, fS.y), N: frame(fN.x, fN.y), A: frame(fA.x, fA.y), B: frame(fB.x, fB.y),
  Po: frame(fPo.x, fPo.y), Or: frame(fOr.x, fOr.y),
  Go: frame(fGo.x, fGo.y), Me: frame(fMe.x, fMe.y), Gn: frame(fGn.x, fGn.y),
  U1A: frame(fU1A.x, fU1A.y), U1T: frame(fU1T.x, fU1T.y),
  L1A: frame(fL1A.x, fL1A.y), L1T: frame(fL1T.x, fL1T.y),
};

const measured = (tracing: Tracing, key: string) =>
  analyse({ tracing }).measurements.find((m) => m.key === key)?.value ?? Number.NaN;

describe("زوايا المستويات على وجهٍ سويّ", () => {
  it("كلٌّ يعيد معياره", () => {
    expect(measured(FACE, "FMA")).toBeCloseTo(25, 0);
    expect(measured(FACE, "SN-GoGn")).toBeCloseTo(32, 0);
    expect(measured(FACE, "IMPA")).toBeCloseTo(90, 0);
    expect(measured(FACE, "U1-SN")).toBeCloseTo(103, 0);
    expect(measured(FACE, "U1-NA")).toBeCloseTo(21, 0);
    expect(measured(FACE, "L1-NB")).toBeCloseTo(22, 0);
    expect(measured(FACE, "U1-L1")).toBeCloseTo(135, 0);
  });

  it("ومحور Y ضمن نطاق معياره", () => {
    const y = measured(FACE, "Y-Axis");
    expect(y).toBeGreaterThan(NORMS.Y_AXIS.mean - NORMS.Y_AXIS.tolerance);
    expect(y).toBeLessThan(NORMS.Y_AXIS.mean + NORMS.Y_AXIS.tolerance);
  });

  it("والعلاقة الأولى: SN-MP − FMA = ميل SN عن فرانكفورت", () => {
    // على مستوى الفك نفسه (Go→Me) كي تُقارن الزاويتان على خطٍّ واحد.
    const snmp = lineAngle(FACE.S!, FACE.N!, FACE.Go!, FACE.Me!);
    const fma = lineAngle(FACE.Po!, FACE.Or!, FACE.Go!, FACE.Me!);
    expect(snmp - fma).toBeCloseTo(7, 1);
  });

  it("والعلاقة الثانية: SNA + U1-NA = U1-SN", () => {
    expect(measured(FACE, "SNA") + measured(FACE, "U1-NA"))
      .toBeCloseTo(measured(FACE, "U1-SN"), 1);
  });
});

describe("اتجاه التغيّر — الحارس الذي لا يمرّ منه اصطلاحٌ مقلوب", () => {
  it("قاطعٌ سفلي يُمال أمامًا تزيد IMPA، ومنتصبًا تنقص", () => {
    const proclined = { ...FACE, L1T: frame(along(fL1A, 45, 25).x, along(fL1A, 45, 25).y) };
    const upright = { ...FACE, L1T: frame(along(fL1A, 85, 25).x, along(fL1A, 85, 25).y) };
    expect(measured(proclined, "IMPA")).toBeGreaterThan(90);
    expect(measured(upright, "IMPA")).toBeLessThan(90);
  });

  it("وفكٌّ أشدّ انحدارًا تزيد FMA وSN-GoGn معًا", () => {
    const steep = { ...FACE, Me: frame(85, -95), Gn: frame(88, -92) };
    expect(measured(steep, "FMA")).toBeGreaterThan(measured(FACE, "FMA"));
    expect(measured(steep, "SN-GoGn")).toBeGreaterThan(measured(FACE, "SN-GoGn"));
  });

  it("وقاطعان يُمالان أمامًا تنقص الزاوية بينهما", () => {
    const flared = {
      ...FACE,
      U1T: frame(along(fU1A, -50, 25).x, along(fU1A, -50, 25).y),
      L1T: frame(along(fL1A, 45, 25).x, along(fL1A, 45, 25).y),
    };
    expect(measured(flared, "U1-L1")).toBeLessThan(measured(FACE, "U1-L1"));
    expect(measured(flared, "U1-SN")).toBeGreaterThan(measured(FACE, "U1-SN"));
  });
});

describe("النقاط الأربع والعشرون المعتمدة", () => {
  /*
   * والفحص مقصورٌ على نقاط الدليل وحدها.
   *
   * أُضيفت بعده نقاطٌ من الأدبيات بإذن المالك، ولو عدّها هذا الفحص لَصار كل إضافةٍ
   * تكسره فيُرفع العدد — فيضيع ما بُني له: أن يبقى **محتوى الدليل الموقَّع** كما
   * وُقّع، لا أن يُعدّ ما في الشاشة.
   */
  const manual = LANDMARKS.filter((item) => !item.source);

  it("عددها ٢٤ كما في الدليل الموقَّع", () => {
    expect(manual.length).toBe(24);
  });

  it("وتوزيعها كما في خريطة الدليل", () => {
    const count = (group: string) => manual.filter((l) => l.group === group).length;
    expect(count("cranial")).toBe(6);
    expect(count("maxilla")).toBe(3);
    expect(count("mandible")).toBe(7);
    expect(count("teeth")).toBe(4);
    expect(count("soft")).toBe(4);
  });

  it("ولكلٍّ اسمٌ وتعريفٌ بلغتين", () => {
    for (const item of LANDMARKS) {
      expect(item.name.ar.length).toBeGreaterThan(1);
      expect(item.name.en.length).toBeGreaterThan(1);
      expect(item.hint.ar.length).toBeGreaterThan(10);
      expect(item.hint.en.length).toBeGreaterThan(10);
    }
  });

  it("وقرارات الدليل مكتوبةٌ في التلميحات", () => {
    const po = LANDMARKS.find((l) => l.code === "Po")!;
    expect(po.hint.ar).toContain("قضيب الأذن");   // البوريون التشريحي لا الميكانيكي
    const co = LANDMARKS.find((l) => l.code === "Co")!;
    expect(co.hint.ar).toContain("الأبعد عن الفيلم");
    const u1a = LANDMARKS.find((l) => l.code === "U1A")!;
    expect(u1a.hint.ar).toContain("نفسه");        // الطرف والذروة من السن نفسه
  });
});


/*
 * القياسات الطولية — والمعايرة التي كانت تُحفظ ولا تُنتج شيئًا.
 *
 * إطار الوجه المصنوع طوله ٢٠٠ وحدة على ٢٠٠، فالإحداثي النسبيّ ‎x/200‎. فإن عوّلنا
 * طولًا معلومًا مقداره ١٠٠ على مسافةٍ نسبية ٠٫٥ صار المقياس ٢٠٠ مليمترًا للوحدة —
 * وعندها تخرج كل مسافةٍ بالمليمتر مساويةً لمسافتها في الإطار بالضبط. فالمتوقَّع
 * محسوبٌ لا مقروءٌ من المخرجات.
 */
const CAL = { from: frame(0, 0), to: frame(100, 0), millimetres: 100 };
/*
 * الوجه الكامل — بنقاط الأدبيات معه.
 *
 * وPogonion **أمام** النقطة B لا خلفها: وضعتُه أولًا عند ٨٤ فخرجت زاوية مستوى
 * A-B موجبةً، ومعيار داونز لها سالبٌ (‎−4.6‎) — فالخلل في الذقن المصنوع لا في
 * الصيغة: ذقنٌ خلف النقطة B ليس ذقنًا. ولولا اشتراطُ المعيار بإشارته لَمرّ.
 */
const FACE_MM: Tracing = {
  ...FACE,
  Pog: frame(88, -70), ANS: frame(80, -8),
  // مستوى الإطباق الوظيفي — Jacobson
  U6: frame(55, -23), L6: frame(55, -25),
  // الأنسجة الرخوة — Ricketts، والشفتان خلف الخط الجمالي كما في السويّ
  Pn: frame(108, -18), PogS: frame(92, -72),
  LS: frame(98.1, -38), LI: frame(96.5, -50),
};

const mmValue = (tracing: Tracing, key: string, calibration = CAL) =>
  analyse({ tracing, calibration }).measurements.find((m) => m.key === key)?.value ?? Number.NaN;

const measuredIn = (tracing: Tracing, key: string, calibration?: typeof CAL) =>
  analyse({ tracing, calibration }).measurements.find((m) => m.key === key)?.value ?? Number.NaN;

describe("المعايرة تُشغّل ما كان معطّلًا", () => {
  it("بلا معايرة: لا مسافةَ واحدة بالمليمتر", () => {
    const plain = analyse({ tracing: FACE_MM });
    expect(plain.calibrated).toBe(false);
    expect(plain.measurements.filter((m) => m.unit === "mm")).toHaveLength(0);
  });

  it("وبالمعايرة تظهر — والزوايا كما هي لم تتغيّر", () => {
    const plain = analyse({ tracing: FACE_MM });
    const scaled = analyse({ tracing: FACE_MM, calibration: CAL });
    expect(scaled.calibrated).toBe(true);
    expect(scaled.measurements.filter((m) => m.unit === "mm").length).toBeGreaterThan(0);
    for (const angle of plain.measurements.filter((m) => m.unit === "deg")) {
      const same = scaled.measurements.find((m) => m.key === angle.key)!;
      expect(same.value).toBeCloseTo(angle.value, 10);
    }
  });

  it("والمقياس يُطبَّق كما هو: طولٌ معلومٌ ضعفُه يُضاعف كل مليمتر", () => {
    const once = mmValue(FACE_MM, "N-Me");
    const twice = mmValue(FACE_MM, "N-Me", { ...CAL, millimetres: 200 });
    expect(twice).toBeCloseTo(once * 2, 8);
  });

  it("ومعايرةٌ بطول صفر لا تُشغّل شيئًا", () => {
    const zero = analyse({ tracing: FACE_MM, calibration: { ...CAL, to: CAL.from } });
    expect(zero.calibrated).toBe(false);
    expect(millimetresPerUnit({ ...CAL, to: CAL.from })).toBeNull();
  });

  it("والأطوال تخرج بمقاديرها المحسوبة", () => {
    expect(mmValue(FACE_MM, "N-Me")).toBeCloseTo(106.7929, 3);
    expect(mmValue(FACE_MM, "S-Go")).toBeCloseTo(65.1920, 3);
  });
});

describe("المسافة الموقّعة عن خط — والإشارة هي التشخيص", () => {
  it("القاطع أمام خط NA فالإشارة موجبة", () => {
    expect(mmValue(FACE_MM, "U1-NA-mm")).toBeCloseTo(7.1634, 3);
    expect(mmValue(FACE_MM, "L1-NB-mm")).toBeCloseTo(3.0013, 3);
  });

  it("وقاطعٌ يُسحب خلف الخط تنقلب إشارته", () => {
    // القاطع إلى الخلف من A بمسافة — فيصير خلف خط NA.
    const retruded = { ...FACE_MM, U1T: frame(70, -33.5) };
    expect(mmValue(retruded, "U1-NA-mm")).toBeLessThan(0);
  });

  it("والإشارة من التشريح لا من الصورة: قلبُ الصورة أفقيًّا لا يقلبها", () => {
    /*
     * وهذا هو الحارس الذي بُني له كل شيء. الأشعة الجانبية تُصوَّر ووجهها يمينًا
     * أحيانًا ويسارًا أحيانًا، فربطُ «الأمام» بمحور الصورة يقلب كل إشارةٍ على نصف
     * الصور — ويقلب معها التشخيص، بلا أن يبدو على الرقم شيء.
     */
    const mirrored: Tracing = Object.fromEntries(
      Object.entries(FACE_MM).map(([code, point]) => [code, { x: 1 - point.x, y: point.y }]),
    );
    const mirroredCal = { ...CAL, from: { x: 1 - CAL.from.x, y: CAL.from.y }, to: { x: 1 - CAL.to.x, y: CAL.to.y } };
    expect(mmValue(mirrored, "U1-NA-mm", mirroredCal)).toBeCloseTo(mmValue(FACE_MM, "U1-NA-mm"), 8);
    expect(mmValue(mirrored, "L1-NB-mm", mirroredCal)).toBeCloseTo(mmValue(FACE_MM, "L1-NB-mm"), 8);
  });

  it("ونقطةٌ على الخط نفسه بُعدها صفر", () => {
    const N = FACE_MM.N!, A = FACE_MM.A!, S = FACE_MM.S!;
    const middle = { x: (N.x + A.x) / 2, y: (N.y + A.y) / 2 };
    expect(offsetFromLine(middle, N, A, S)).toBeCloseTo(0, 10);
  });
});

describe("نسبة ياراباك — نسبةٌ لا طول", () => {
  const ratio = (tracing: Tracing, calibration?: typeof CAL) =>
    analyse({ tracing, calibration }).measurements.find((m) => m.key === "Jarabak")?.value ?? Number.NaN;

  it("تُحسب بلا معايرة أصلًا — لأن المقياس يسقط بالقسمة", () => {
    expect(ratio(FACE_MM)).toBeCloseTo(61.0453, 3);
    expect(ratio(FACE_MM, CAL)).toBeCloseTo(ratio(FACE_MM), 10);
  });

  it("ولا تتغيّر بتغيّر المعايرة", () => {
    expect(ratio(FACE_MM, { ...CAL, millimetres: 37 })).toBeCloseTo(ratio(FACE_MM, CAL), 10);
  });

  it("وارتفاعٌ خلفيٌّ أطول يرفعها — وهو نمو أفقي", () => {
    const horizontal = { ...FACE_MM, Go: frame(15, -70) };
    expect(ratio(horizontal)).toBeGreaterThan(ratio(FACE_MM));
  });
});

describe("قياسٌ بلا معيار يُعرض بلا حكم", () => {
  it("ارتفاع الوجه يخرج بلا معيار ولا تصنيف", () => {
    const height = analyse({ tracing: FACE_MM, calibration: CAL })
      .measurements.find((m) => m.key === "N-Me")!;
    expect(height.norm).toBeNull();
    expect(height.verdict).toBeNull();
  });

  it("بينما بروز القاطع يخرج بمعياره وحكمه", () => {
    const incisor = analyse({ tracing: FACE_MM, calibration: CAL })
      .measurements.find((m) => m.key === "U1-NA-mm")!;
    expect(incisor.norm).toEqual(NORMS.U1_NA_MM);
    expect(incisor.verdict).toBe("high");
  });
});

describe("صياغة الرقم", () => {
  it("وحدة المليمتر تتبع لغة الشاشة", () => {
    expect(formatMeasurement(4.25, "mm", "ar")).toBe("4.3 مم");
    expect(formatMeasurement(4.25, "mm", "en")).toBe("4.3 mm");
  });

  it("والنسبة بالمئة، والدرجة بعلامتها", () => {
    expect(formatMeasurement(63.5, "ratio")).toBe("63.5%");
    expect(formatMeasurement(82, "deg")).toBe("82.0°");
  });
});


describe("المعايير تُمرَّر ولا تُثبَّت", () => {
  const verdictOf = (key: string, norms?: Record<string, { mean: number; tolerance: number; source: string }>) =>
    analyse({ tracing: FACE, norms }).measurements.find((m) => m.key === key)?.verdict;

  it("بلا تمرير: الافتراضي هو المعمول به", () => {
    expect(verdictOf("SNA")).toBe("normal");
  });

  it("ومجموعةٌ أخرى تقلب الحكم — وهذا هو المقصود", () => {
    // معيارٌ يجعل ٨٢ مرتفعة: لو بقيت المعايير في الكود لما أمكن هذا أصلًا.
    expect(verdictOf("SNA", { SNA: { mean: 74, tolerance: 2, source: "محلّي" } })).toBe("high");
    expect(verdictOf("SNA", { SNA: { mean: 90, tolerance: 2, source: "محلّي" } })).toBe("low");
  });

  it("والمرجع يظهر مع الرقم — فيُراجَع لا يُصدَّق", () => {
    const measured = analyse({
      tracing: FACE, norms: { SNA: { mean: 82, tolerance: 2, source: "مرضى تعز ٢٠٢٦" } },
    }).measurements.find((m) => m.key === "SNA")!;
    expect(measured.norm!.source).toBe("مرضى تعز ٢٠٢٦");
  });

  it("ومجموعةٌ ناقصة لا تُعطّل ما لم تُذكر فيه", () => {
    // تُمرَّر SNA وحدها، فتبقى SNB على الافتراضي بدل أن تختفي.
    const partial = analyse({ tracing: FACE, norms: { SNA: { mean: 74, tolerance: 2, source: "محلّي" } } });
    expect(partial.measurements.find((m) => m.key === "SNB")!.norm).toEqual(DEFAULT_NORMS.SNB);
  });
});


describe("أسماء المعايير تطابق المعايير", () => {
  it("لكل معيارٍ اسمٌ للعرض — ولا اسمَ بلا معيار", () => {
    expect(Object.keys(NORM_LABEL).sort()).toEqual(Object.keys(DEFAULT_NORMS).sort());
  });

  it("وكل اسمٍ معروضٍ في التحليل له مفتاحٌ يُعدَّل منه", () => {
    // القياسات التي لها معيار يجب أن يوجد لها صفٌّ في شاشة الإدارة — وإلّا صار
    // معيارٌ يحكم على المريض ولا سبيل إلى تغييره.
    const named = new Set(Object.values(NORM_LABEL).map((entry) => entry.name));
    const judged = analyse({ tracing: FACE_MM, calibration: CAL }).measurements
      .filter((m) => m.norm !== null).map((m) => m.name);
    for (const name of judged) expect(named.has(name)).toBe(true);
  });
});


/*
 * تحاليل من الأدبيات المنشورة — بإذن المالك، وكلٌّ بمرجعه.
 *
 * والفحص لا يقنع بمطابقة المقدار: يشترط أن يقع كل قياسٍ **داخل معياره المنشور**
 * على وجهٍ واحد مصنوع، وأن تصحّ إشارتُه. فوقوعُ عشرين قياسًا من ثلاثة تحاليل
 * مختلفة داخل معاييرها معًا لا يحتمله اصطلاحٌ مقلوب في واحد منها.
 */
const full = analyse({ tracing: FACE_MM, calibration: CAL });
const got = (key: string) => full.measurements.find((m) => m.key === key)!;

describe("مثلث تويد — يُغلق أو لا يكون", () => {
  it("مجموع زواياه ١٨٠ بالضبط", () => {
    // ولا تُحسب الثالثة طرحًا من ١٨٠: كلٌّ من نقاطها مستقلّةً، فيكون المجموع
    // برهانًا لا تحصيلَ حاصل. واصطلاحٌ مقلوب في أيّها يكسره.
    const sum = got("FMA").value + got("IMPA").value + got("FMIA").value;
    expect(sum).toBeCloseTo(180, 6);
  });

  it("وFMIA على معيارها", () => {
    expect(got("FMIA").value).toBeCloseTo(64.8, 1);
    expect(got("FMIA").verdict).toBe("normal");
  });
});

describe("تحليل داونز", () => {
  it("الزوايا الثلاث داخل معاييرها المنشورة", () => {
    for (const key of ["Facial", "Convexity", "AB-plane"]) {
      expect(got(key).verdict, key).toBe("normal");
    }
  });

  it("وزاوية مستوى A-B سالبة — كما يقول المعيار", () => {
    // إشارتُها هي الفحص: معيار داونز ‎−4.6‎، وموجبةٌ تعني ذقنًا خلف النقطة B.
    expect(got("AB-plane").value).toBeLessThan(0);
  });

  it("وذقنٌ متقدّم يرفع الزاوية الوجهية", () => {
    const jutting = { ...FACE_MM, Pog: frame(96, -70) };
    expect(measuredIn(jutting, "Facial")).toBeGreaterThan(got("Facial").value);
  });

  it("وذقنٌ متراجع يزيد التحدّب", () => {
    const receding = { ...FACE_MM, Pog: frame(80, -70) };
    expect(measuredIn(receding, "Convexity")).toBeGreaterThan(got("Convexity").value);
  });
});

describe("تقييم Wits — يُقرأ حيث تُضلّل ANB", () => {
  it("على وجهٍ سويّ يقع داخل معياره", () => {
    expect(got("Wits").verdict).toBe("normal");
  });

  it("وفكٌّ سفليٌّ متقدّم يجعله سالبًا — وهو الصنف الثالث", () => {
    const classIII = { ...FACE_MM, B: frame(95, -46.24) };
    expect(measuredIn(classIII, "Wits", CAL)).toBeLessThan(-2);
  });

  it("وفكٌّ علويٌّ متقدّم يرفعه — وهو الصنف الثاني", () => {
    const classII = { ...FACE_MM, A: frame(96, -21.34) };
    expect(measuredIn(classII, "Wits", CAL)).toBeGreaterThan(got("Wits").value + 3);
  });

  it("ولا يُحسب بلا معايرة — لأنه مسافة", () => {
    expect(analyse({ tracing: FACE_MM }).measurements.find((m) => m.key === "Wits")).toBeUndefined();
  });

  it("ولا تقلبه الصورة المقلوبة", () => {
    const mirrored: Tracing = Object.fromEntries(
      Object.entries(FACE_MM).map(([code, point]) => [code, { x: 1 - point.x, y: point.y }]),
    );
    const mirroredCal = { ...CAL, from: { x: 1 - CAL.from.x, y: CAL.from.y }, to: { x: 1 - CAL.to.x, y: CAL.to.y } };
    expect(measuredIn(mirrored, "Wits", mirroredCal)).toBeCloseTo(got("Wits").value, 8);
  });
});

describe("الخط الجمالي", () => {
  it("الشفتان خلفه في الوجه السويّ — فالقيمتان سالبتان وضمن المعيار", () => {
    expect(got("E-LS").value).toBeLessThan(0);
    expect(got("E-LI").value).toBeLessThan(0);
    expect(got("E-LS").verdict).toBe("normal");
    expect(got("E-LI").verdict).toBe("normal");
  });

  it("وشفةٌ بارزة تُقرَّب من الصفر ثم تتجاوزه", () => {
    const protrusive = { ...FACE_MM, LS: frame(106, -38) };
    expect(measuredIn(protrusive, "E-LS", CAL)).toBeGreaterThan(got("E-LS").value);
  });
});

describe("مصدر تعريف كل نقطة مكتوب", () => {
  it("أربعٌ وعشرون من الدليل الموقَّع", () => {
    expect(LANDMARKS.filter((item) => !item.source)).toHaveLength(24);
  });

  it("وأربعٌ من الأدبيات، كلٌّ بمرجعه", () => {
    const cited = LANDMARKS.filter((item) => item.source);
    expect(cited).toHaveLength(4);
    expect(cited.map((item) => item.code).sort()).toEqual(["Ba", "L6", "PogS", "U6"]);
    for (const item of cited) expect(item.source!.trim().length).toBeGreaterThan(8);
  });

  it("ولا نقطةَ بلا تعريفٍ بلغتين", () => {
    for (const item of LANDMARKS) {
      expect(item.hint.ar.length, item.code).toBeGreaterThan(10);
      expect(item.hint.en.length, item.code).toBeGreaterThan(10);
    }
  });
});


describe("الدرجة المعيارية — كم انحرافًا يبعد القياس", () => {
  const norm = { mean: 82, tolerance: 2, source: "فحص" };

  it("المطابق صفر، والبعيد بانحرافٍ واحد ±١", () => {
    expect(zScore(82, norm)).toBe(0);
    expect(zScore(84, norm)).toBe(1);
    expect(zScore(78, norm)).toBe(-2);
  });

  it("وبلا معيارٍ لا رقم — ولا صفرٌ يُوهم التطابق", () => {
    expect(zScore(82, null)).toBeNull();
    expect(zScore(82, { ...norm, tolerance: 0 })).toBeNull();
  });

  it("والتصنيف ثلاثُ درجات لا اثنتان", () => {
    // «خارج المعيار» وحدها تسوّي بين تجاوزٍ بعُشر درجة وتجاوزٍ بثلاثة انحرافات.
    expect(severityOf(0.9)).toBe("within");
    expect(severityOf(-1.5)).toBe("mild");
    expect(severityOf(2.6)).toBe("marked");
    expect(severityOf(null)).toBeNull();
  });

  it("ويوافق الحكم الثنائي عند حدّه", () => {
    // ‏|Z| ≤ 1 هو نفسه «ضمن المعيار» — فلا يقول السطران شيئين مختلفين.
    for (const value of [80, 81, 82, 83, 84, 85, 79]) {
      const within = severityOf(zScore(value, norm)) === "within";
      expect(within).toBe(verdictFor(value, norm) === "normal");
    }
  });
});

describe("النمط العمودي — من قياسين لا من واحد", () => {
  const norms = DEFAULT_NORMS;

  it("انحدارٌ مرتفع في القياسين نمطٌ رأسيّ", () => {
    expect(verticalPattern(34, 40, norms)).toBe("vertical");
  });

  it("ومنخفضٌ فيهما نمطٌ أفقيّ", () => {
    expect(verticalPattern(17, 24, norms)).toBe("horizontal");
  });

  it("وداخل المدى فيهما متوازن", () => {
    expect(verticalPattern(25, 32, norms)).toBe("balanced");
  });

  it("وإن اختلفا لم يُحسم — ولا يُرجَّح أحدهما بلا سبب", () => {
    expect(verticalPattern(34, 32, norms)).toBeNull();
    expect(verticalPattern(17, 40, norms)).toBeNull();
  });

  it("وبلا قياسٍ منهما لا نمط", () => {
    expect(verticalPattern(null, null, norms)).toBeNull();
  });

  it("والوجه المصنوع متوازنٌ عموديًّا", () => {
    expect(analyse({ tracing: FACE_MM }).vertical).toBe("balanced");
  });
});

/*
 * McNamara وSND — منقولةٌ من أرشيف المالك بتصحيح.
 *
 * والمنقولُ منه يقيس بُعد A وPog عن عمود N بدالّةٍ **تثبّت الإشارة على محور
 * الصورة** — فتخرج قياساتُه معكوسةً على كل أشعّةٍ يواجه فيها الوجه اليسار. وهنا
 * الجهة من **التشريح**: الأمام هو الجانب المقابل لـPo، وPo خلفيّةٌ بالتعريف.
 */

/** وجهٌ فيه Co — لازمة لأطوال McNamara — على الإطار المصنوع نفسه. */
const FACE_MCN: Tracing = {
  ...FACE_MM,
  // اللقمة: خلف Po وأعلى قليلًا، كما هي تشريحيًّا.
  Co: frame(-8, 8),
};

describe("McNamara — أطوالٌ فعلية لا زوايا", () => {
  it("الطولان يُقاسان بالمليمتر ولا يظهران بلا معايرة", () => {
    const plain = analyse({ tracing: FACE_MCN });
    expect(plain.measurements.find((m) => m.key === "Co-A")).toBeUndefined();
    expect(plain.measurements.find((m) => m.key === "Co-Gn")).toBeUndefined();

    const scaled = analyse({ tracing: FACE_MCN, calibration: CAL });
    expect(scaled.measurements.find((m) => m.key === "Co-A")?.unit).toBe("mm");
    expect(scaled.measurements.find((m) => m.key === "Co-Gn")?.unit).toBe("mm");
  });

  it("والفرق بينهما هو الطرح لا رقمٌ ثالث يُحسب على حدة", () => {
    // رقمان لحقيقةٍ واحدة يفترقان: لو حُسب الفرق من نقاطٍ أخرى لاختلف عن الطرح.
    const long = mmValue(FACE_MCN, "Co-Gn");
    const short = mmValue(FACE_MCN, "Co-A");
    expect(mmValue(FACE_MCN, "MM-diff")).toBeCloseTo(long - short, 9);
  });

  it("وطولُ الفكّ السفلي أكبر من العلوي على وجهٍ سويّ", () => {
    expect(mmValue(FACE_MCN, "Co-Gn")).toBeGreaterThan(mmValue(FACE_MCN, "Co-A"));
  });

  it("وبُعدُ A عن عمود N يقيس الإزاحة الأفقية عنه بمقدارها", () => {
    /*
     * عمود N على فرانكفورت في هذا الإطار **رأسيٌّ** (فرانكفورت أفقي بالبناء)،
     * فالبُعد عنه هو فرق x بين A وN. وA في الوجه المصنوع خلفه بقليل — وهو ما
     * يقوله الرقم، وأوّل اشتراطٍ كتبتُه («موجبٌ دائمًا») كان خطأً في الاشتراط
     * لا في الحساب.
     */
    const behind = mmValue(FACE_MCN, "A-NPerp");
    expect(behind).toBeLessThan(0);

    // ويُدفع A خمسة أمامًا فينقلب الموجب — والفرق خمسة بالضبط.
    const forward: Tracing = { ...FACE_MCN, A: frame(89.6 + 5, -21.35) };
    const ahead = mmValue(forward, "A-NPerp");
    expect(ahead).toBeGreaterThan(0);
    expect(ahead - behind).toBeCloseTo(5, 1);
  });

  it("**والإشارة من التشريح لا من محور الصورة** — الصورة المعكوسة تعطي الرقم نفسه", () => {
    /*
     * وهذا هو العطب الذي وجدتُه في المستودع المنقول عنه: دالّتُه تثبّت الإشارة
     * على محور الصورة («الوجه يمين الصورة فالأمام شرقًا»)، فتخرج القياسات
     * الموقَّعة معكوسةً على كل أشعّةٍ يواجه فيها الوجه اليسار.
     */
    const mirrored: Tracing = Object.fromEntries(
      Object.entries(FACE_MCN).map(([code, point]) => [code, { x: 1 - point!.x, y: point!.y }]),
    ) as Tracing;
    const mirroredCal = {
      ...CAL,
      from: { x: 1 - CAL.from.x, y: CAL.from.y },
      to: { x: 1 - CAL.to.x, y: CAL.to.y },
    };
    for (const key of ["A-NPerp", "Pog-NPerp", "Co-A", "Co-Gn", "MM-diff"]) {
      expect(mmValue(mirrored, key, mirroredCal), key)
        .toBeCloseTo(mmValue(FACE_MCN, key), 8);
    }
  });

  it("ونسبة LAFH تُحسب بلا معايرة — المقياس يسقط بالقسمة", () => {
    /*
     * والمنقولُ منه يحوّل الطولين إلى مليمترات ثم يقسمهما، فتمتنع نسبتُه بلا
     * معايرة بلا سبب — والنسبة لا تحتاج مليمترًا لتصحّ.
     */
    const plain = analyse({ tracing: FACE_MCN });
    const lafh = plain.measurements.find((m) => m.key === "LAFH");
    expect(lafh?.unit).toBe("ratio");
    expect(lafh!.value).toBeGreaterThan(0);
    // والمعايرة لا تغيّرها.
    expect(mmValue(FACE_MCN, "LAFH")).toBeCloseTo(lafh!.value, 9);
  });

  it("وهي ANS-Me من N-Me بالضبط", () => {
    const total = mmValue(FACE_MCN, "N-Me");
    const lower = mmValue(FACE_MCN, "ANS-Me");
    expect(mmValue(FACE_MCN, "LAFH")).toBeCloseTo((lower / total) * 100, 6);
  });

  it("وكلّها تحمل اسم تحليلها — فتُقرأ مجموعةً كما في المراجع", () => {
    const named = analyse({ tracing: FACE_MCN, calibration: CAL }).measurements
      .filter((m) => m.analysis === "McNamara").map((m) => m.key).sort();
    expect(named).toEqual(["A-NPerp", "Co-A", "Co-Gn", "LAFH", "MM-diff", "Pog-NPerp"]);
  });
});

describe("SND — موضع وسط الارتفاق", () => {
  const FACE_D: Tracing = { ...FACE_MCN, D: frame(78, -60) };

  it("يُحسب حين تُوضع D، ولا يُحسب بدونها", () => {
    expect(analyse({ tracing: FACE_MCN }).measurements.find((m) => m.key === "SND")).toBeUndefined();
    expect(measured(FACE_D, "SND")).toBeGreaterThan(0);
  });

  it("وهو أقلّ من SNB — فـD خلف B وأسفل منه على الارتفاق", () => {
    // وهذا هو معنى القياس: يُقرأ عند وسط الارتفاق لا عند قمّته.
    expect(measured(FACE_D, "SND")).toBeLessThan(measured(FACE_D, "SNB"));
  });

  it("وباسم تحليله Steiner", () => {
    const snd = analyse({ tracing: FACE_D }).measurements.find((m) => m.key === "SND");
    expect(snd?.analysis).toBe("Steiner");
    expect(snd?.unit).toBe("deg");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * معايير البالغين على وجهٍ ينمو
 *
 * وهذا أخطرُ ما في أطوال McNamara: الرقم صحيح والحكم كاذب. طفلٌ في التاسعة
 * فكُّه العلوي ٨٥ مم — وهو سويٌّ تمامًا لعمره — ومعيار البالغين ٩٤±٥، فيخرج
 * على ورقةٍ موقَّعة «منخفض»، ويُقرأ نقصًا فكّيًّا يستدعي جهاز نموّ أو جراحة.
 *
 * فالفحص هنا ليس على القيمة — القيمة لا تتغيّر — بل على **ما يُقال عنها**.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("معايير البالغين لا تُطبَّق على وجهٍ ينمو", () => {
  const of = (key: string, ageYears: number | null) =>
    analyse({ tracing: FACE_MCN, calibration: CAL, ageYears })
      .measurements.find((m) => m.key === key);

  const ADULT_ONLY = ["Co-A", "Co-Gn", "MM-diff", "A-NPerp", "Pog-NPerp"];

  it("البالغ يُحكم عليه — المعيار حاضر والحكم معه", () => {
    for (const key of ADULT_ONLY) {
      const m = of(key, 30);
      expect(m?.norm, key).toBeTruthy();
      expect(m?.verdict, key).toBeTruthy();
      expect(m?.normNote, key).toBeUndefined();
    }
  });

  it("والطفل يُقاس ولا يُحكم عليه — والقيمة هي هي", () => {
    for (const key of ADULT_ONLY) {
      const child = of(key, 9);
      const adult = of(key, 30);
      // القيمة لا تتغيّر بالعمر — المقياس واحد، وإنما يُحجب الحكم وحده.
      expect(child?.value, key).toBeCloseTo(adult!.value, 12);
      expect(child?.norm, key).toBeNull();
      expect(child?.verdict, key).toBeNull();
      expect(child?.normNote?.ar, key).toContain("للبالغين");
      expect(child?.normNote?.ar, key).toContain("9");
    }
  });

  it("وعمرٌ غير مسجَّل يُعامَل معاملة «قد يكون طفلًا»", () => {
    for (const key of ADULT_ONLY) {
      const m = of(key, null);
      expect(m?.norm, key).toBeNull();
      expect(m?.verdict, key).toBeNull();
      expect(m?.normNote?.ar, key).toContain("غير مسجَّل");
    }
  });

  it("وعند الحدّ: ثمانية عشر يُحكم عليها وسبعة عشر لا", () => {
    expect(of("Co-A", ADULT_AGE)?.verdict).toBeTruthy();
    expect(of("Co-A", ADULT_AGE - 1)?.verdict).toBeNull();
  });

  it("والقياسات التي لا تخصّ البالغين وحدهم لا تُمسّ", () => {
    // LAFH نسبةٌ لا طول، وبروز القاطع معياره ليس موسومًا للبالغين.
    // ولا `continue` هنا: فحصٌ يمرّ لأنّ القياس غائب فحصٌ يمرّ بالصدفة.
    for (const key of ["LAFH", "U1-NA-mm"]) {
      const child = of(key, 9);
      expect(child, key).toBeDefined();
      expect(child!.norm, key).toBeTruthy();
      expect(child!.verdict, key).toBeTruthy();
    }
  });

  it("والوسم على المعيار نفسه — فأيّ معيارٍ للبالغين يُحجب بالقاعدة نفسها", () => {
    for (const key of ["MAX_LEN", "MAND_LEN", "MM_DIFF", "A_NPERP", "POG_NPERP"]) {
      expect(DEFAULT_NORMS[key as keyof typeof DEFAULT_NORMS].adultOnly, key).toBe(true);
    }
    expect(DEFAULT_NORMS.LAFH.adultOnly).toBeUndefined();
    expect(DEFAULT_NORMS.SNA.adultOnly).toBeUndefined();
  });

  it("والحجب دالّةٌ مستقلّة تُختبر وحدها", () => {
    const adult = { mean: 94, tolerance: 5, source: "س", adultOnly: true } as const;
    const any = { mean: 82, tolerance: 2, source: "س" };
    expect(applicableNorm(adult, 30).norm).toBe(adult);
    expect(applicableNorm(adult, 9).norm).toBeNull();
    expect(applicableNorm(adult, null).norm).toBeNull();
    expect(applicableNorm(any, 9).norm).toBe(any);
    expect(applicableNorm(null, 30).norm).toBeNull();
  });
});

describe("العمر من سنة الميلاد", () => {
  it("يُحسب بفارق السنتين", () => {
    expect(ageFromBirthYear(2008, "2026-09-03")).toBe(18);
    expect(ageFromBirthYear(2017, "2026-01-01")).toBe(9);
  });

  it("ويُردّ لا شيء حين لا يُعرف أو يستحيل", () => {
    expect(ageFromBirthYear(null, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(2008, null)).toBeNull();
    expect(ageFromBirthYear(2008, "")).toBeNull();
    // سنةٌ بعد التصوير — بيانٌ فاسد، ورقمٌ فاسد أسوأ من لا رقم.
    expect(ageFromBirthYear(2030, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(1800, "2026-09-03")).toBeNull();
    expect(ageFromBirthYear(2008.5, "2026-09-03")).toBeNull();
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * اسم التحليل من معياره
 *
 * وكانت ثمانيةٌ من ثلاثةٍ وثلاثين مسمّاة، والباقي — ومنه SNA وSNB وANB وFMA
 * وIMPA — يخرج في مجموعةٍ بلا عنوان. فيقرأ الطبيب Steiner متفرّقًا بين
 * مجموعتين، لا مجموعةً كما في مراجعه.
 *
 * والقاعدة أنّ **التحليل صاحبُ المعيار الذي يُحكم به**، فلا يُكتب الاسم مرّةً
 * ثانية بيدٍ قد تخالف المعيار الذي تحته.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("اسم التحليل يُشتقّ من مرجع معياره", () => {
  const all = analyse({ tracing: FACE_MCN, calibration: CAL, ageYears: 30 }).measurements;
  const find = (key: string) => all.find((item) => item.key === key);

  it("فكلّ قياسٍ له معيارٌ له اسمُ تحليل — بلا استثناء", () => {
    const orphans = all.filter((item) => item.norm && !item.analysis).map((item) => item.key);
    expect(orphans, orphans.join(" · ")).toEqual([]);
  });

  it("وما لا معيار له يبقى بلا اسم — ولا يُلحق بتحليلٍ لا يحكمه", () => {
    // الارتفاعات الوجهية الخام: تُقرأ ولا تُصنَّف، فنسبتُها إلى تحليلٍ ادّعاء.
    for (const key of ["N-Me", "ANS-Me", "S-Go"]) {
      const item = find(key);
      expect(item, key).toBeDefined();
      expect(item!.norm, key).toBeNull();
      expect(item!.analysis, key).toBeUndefined();
    }
  });

  it("وينتقل الاسم إلى صاحبه: Steiner وTweed وDowns", () => {
    for (const key of ["SNA", "SNB", "ANB", "SN-GoGn", "U1-SN", "U1-NA", "L1-NB"]) {
      expect(find(key)?.analysis, key).toBe("Steiner");
    }
    for (const key of ["FMA", "IMPA", "FMIA"]) {
      expect(find(key)?.analysis, key).toBe("Tweed");
    }
    for (const key of ["U1-L1", "Y-Axis", "Facial"]) {
      expect(find(key)?.analysis, key).toBe("Downs");
    }
  });

  it("**والاسم يوافق المعيار الذي تحته** — لا يخالفه", () => {
    // وهذا جوهر القاعدة: مجموعةٌ باسم تحليلٍ وحدودُها من جداول غيره تُقرأ خطأً.
    for (const item of all) {
      if (!item.norm || !item.analysis) continue;
      const fromNorm = analysisFromSource(item.norm.source);
      // الاسم الصريح يغلب المشتقّ (Wits من Jacobson) — وما عداه يجب أن يتطابق.
      if (item.key === "Wits") continue;
      expect(item.analysis, `${item.key} · ${item.norm.source}`).toBe(fromNorm);
    }
  });

  it("والاسم الصريح يغلب المشتقّ", () => {
    expect(find("Wits")?.analysis).toBe("Wits");
    expect(find("Wits")?.norm?.source).toContain("Jacobson");
  });

  it("وقياسُ بالغين يحتفظ باسمه وإن حُجب حكمُه عن طفل", () => {
    // بلا هذا يفقد Co-A عنوانه على ورقة طفلٍ فيسقط من مجموعة McNamara.
    const child = analyse({ tracing: FACE_MCN, calibration: CAL, ageYears: 9 })
      .measurements.find((item) => item.key === "Co-A");
    expect(child?.norm).toBeNull();
    expect(child?.analysis).toBe("McNamara");
  });

  it("والسنة وما بعد الفاصلة يُقطعان من المرجع", () => {
    expect(analysisFromSource("Steiner")).toBe("Steiner");
    expect(analysisFromSource("Downs 1948")).toBe("Downs");
    expect(analysisFromSource("Tweed 1954")).toBe("Tweed");
    expect(analysisFromSource("Jacobson 1975 · ♂ 1±2 · ♀ 0±2")).toBe("Jacobson");
    expect(analysisFromSource("McNamara 1984 · بالغون")).toBe("McNamara");
    expect(analysisFromSource("  ")).toBeNull();
    expect(analysisFromSource("· شيء")).toBeNull();
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * التجميع بالتحاليل
 *
 * والقياسات تُبنى بترتيبٍ حسابيّ لا بترتيب التحاليل: Steiner ثم Tweed ثم
 * Steiner ثانيةً عند `U1-SN`. فعارضٌ يكتب عنوانًا كلّما تغيّر الاسم عن سابقه
 * يكتب «Steiner» مرّتين أو ثلاثًا — وهو نقيض الغرض من التسمية.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("التجميع بالتحاليل — كلُّ تحليلٍ مرّةً واحدة", () => {
  it("يجمع المتفرّق ولا يكرّر عنوانًا", () => {
    const scattered = [
      { key: "a", analysis: "Steiner" },
      { key: "b", analysis: "Tweed" },
      { key: "c", analysis: "Steiner" },
      { key: "d", analysis: "Downs" },
      { key: "e", analysis: "Tweed" },
    ];
    const groups = groupByAnalysis(scattered);
    expect(groups.map((g) => g.analysis)).toEqual(["Steiner", "Tweed", "Downs"]);
    expect(groups[0].items.map((i) => i.key)).toEqual(["a", "c"]);
    expect(groups[1].items.map((i) => i.key)).toEqual(["b", "e"]);
  });

  it("وما لا اسم له مجموعةٌ واحدة بلا عنوان", () => {
    const groups = groupByAnalysis([
      { key: "a", analysis: "Steiner" }, { key: "b" }, { key: "c", analysis: null }, { key: "d" },
    ]);
    const bare = groups.find((g) => g.analysis === null);
    expect(bare?.items.map((i) => i.key)).toEqual(["b", "c", "d"]);
  });

  it("ولا يُفقد قياسٌ ولا يُكرَّر", () => {
    const all = analyse({ tracing: FACE_MCN, calibration: CAL, ageYears: 30 }).measurements;
    const grouped = groupByAnalysis(all).flatMap((g) => g.items);
    expect(grouped).toHaveLength(all.length);
    expect(new Set(grouped.map((i) => i.key)).size).toBe(all.length);
  });

  it("**والتحليل الواحد لا يظهر في مجموعتين** — على قياساتٍ حقيقية", () => {
    // وهذا هو العطب بعينه: الترتيب الحسابيّ يعود إلى Steiner بعد Tweed.
    const all = analyse({ tracing: FACE_MCN, calibration: CAL, ageYears: 30 }).measurements;
    const names = groupByAnalysis(all).map((g) => g.analysis);
    expect(names.length).toBe(new Set(names).size);
    expect(names).toContain("Steiner");
    // ويُثبَت أنّ المصدر متفرّقٌ فعلًا، وإلّا كان الفحص يمرّ بالصدفة.
    const raw = all.map((item) => item.analysis ?? null);
    const collapsed = raw.filter((name, index) => name !== raw[index - 1]);
    expect(collapsed.length, collapsed.join(" · ")).toBeGreaterThan(new Set(raw).size);
  });

  it("وترتيب المجموعات بأوّل ظهور، وترتيب القياسات كما بُنيت", () => {
    const all = analyse({ tracing: FACE_MCN, calibration: CAL, ageYears: 30 }).measurements;
    const groups = groupByAnalysis(all);
    expect(groups[0].analysis).toBe(all[0].analysis ?? null);
    const steiner = groups.find((g) => g.analysis === "Steiner")!;
    const inOrder = all.filter((item) => item.analysis === "Steiner").map((item) => item.key);
    expect(steiner.items.map((item) => item.key)).toEqual(inOrder);
  });
});
