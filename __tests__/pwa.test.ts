import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest, installHint, isIosBrowser, PRECACHE, shortName, shouldCache } from "../lib/pwa";

/**
 * حدود ما يُخزَّن على جهازٍ يُترك على طاولة الاستقبال.
 *
 * التثبيت يفتح بابًا لم يكن مفتوحًا: عاملُ خدمةٍ يرى **كل** طلبٍ يخرج من الصفحة
 * ويستطيع حفظ جوابه على القرص. وسطرٌ واحدٌ يُضاف بحسن نيّة — «نخزّن الصفحات ليفتح
 * أسرع» — يعني سجلّ مريضٍ يبقى في المتصفّح بعد الخروج، ويُقرأ بلا جلسة.
 *
 * فالسياسة قائمة سماحٍ لا منع، والفحص هنا على **الحكم نفسه** لا على وجود السياسة.
 */

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

/**
 * نسخة عامل الخدمة من الدالة — تُستخرج من الملف وتُشغَّل.
 *
 * وهي مكرّرة هناك بالضرورة: الملف يُخدَم كما هو ولا يمرّ ببناء، فلا يستورد من
 * `lib/`. والتكرار بلا فحصٍ ينحرف — فالنسختان تُشغَّلان هنا على جدولٍ واحد.
 */
function swShouldCache(): (pathname: string) => boolean {
  const start = source.indexOf("function shouldCache(pathname)");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end + 2);
  return new Function(`${body}; return shouldCache;`)() as (pathname: string) => boolean;
}

/** جدول المسارات — ما يُخزَّن وما لا يُخزَّن، ولماذا. */
const TABLE: Array<{ path: string; cache: boolean; why: string }> = [
  { path: "/_next/static/chunks/main-a1b2.js", cache: true, why: "ملف بناء باسمٍ فيه بصمته" },
  { path: "/_next/static/media/plex-arabic-400.woff2", cache: true, why: "خطّ الواجهة" },
  { path: "/icons/icon-192.png", cache: true, why: "أيقونة التثبيت" },
  { path: "/icon.svg", cache: true, why: "شعارٌ لا بيان فيه" },
  { path: "/offline.html", cache: true, why: "صفحة الانقطاع نفسها" },

  { path: "/api/patients", cache: false, why: "أسماء المرضى وأرقامهم" },
  { path: "/api/patients/9/ledger", cache: false, why: "كشف حساب" },
  { path: "/api/finance/summary", cache: false, why: "أرقام الصندوق" },
  { path: "/api/portal/appointments", cache: false, why: "مواعيد مريضٍ بعينه" },
  { path: "/api/display", cache: false, why: "قائمة الانتظار تتغيّر كل ثوانٍ" },
  { path: "/", cache: false, why: "شاشة اليوم — فيها أسماء" },
  { path: "/patients/12", cache: false, why: "ملف مريض" },
  { path: "/visits/8", cache: false, why: "زيارة" },
  { path: "/executive", cache: false, why: "غرفة القيادة" },
  { path: "/manifest.webmanifest", cache: false, why: "يُقرأ من الشبكة ليتغيّر الاسم فورًا" },
  { path: "/login", cache: false, why: "صفحة دخولٍ مخزَّنة تُعرض بدل الشاشة المطلوبة" },
];

describe("سياسة التخزين على الجهاز", () => {
  it("لا يُخزَّن إلا ما لا بيان فيه", () => {
    for (const row of TABLE) {
      expect(shouldCache(row.path), `${row.path} — ${row.why}`).toBe(row.cache);
    }
  });

  it("ولا مسار `/api/` واحد يُخزَّن — مهما امتدّ", () => {
    const paths = ["/api", "/api/", "/api/x", "/api/patients?q=%2F_next%2Fstatic%2F"];
    expect(paths.filter((path) => shouldCache(path))).toEqual([]);
  });

  it("مسارٌ يحوي المسموح ولا يبدأ به لا يُخزَّن", () => {
    // لو كان الفحص «يحوي» بدل «يبدأ بـ» لمرّ هذا ومعه جواب المسار كلّه.
    expect(shouldCache("/api/proxy//_next/static/x.js")).toBe(false);
    expect(shouldCache("/patients/icons/icon-192.png")).toBe(false);
  });

  it("والنسخة التي تعمل على الهاتف تحكم كما تحكم هذه — لا انحراف بينهما", () => {
    const onDevice = swShouldCache();
    for (const row of TABLE) {
      expect(onDevice(row.path), `${row.path} في عامل الخدمة`).toBe(row.cache);
    }
  });

  it("الفحص نفسه يمسك الانحراف — فحصٌ لا يسقط ليس فحصًا", () => {
    // نسخةٌ «محسَّنة» تخزّن الصفحات ليفتح البرنامج أسرع: تسقط على أول صفٍّ ممنوع.
    const drifted = (pathname: string) => shouldCache(pathname) || !pathname.startsWith("/api/");
    const disagreements = TABLE.filter((row) => drifted(row.path) !== row.cache);
    expect(disagreements.map((row) => row.path)).toContain("/patients/12");
  });

  it("ما يُخزَّن مسبقًا هو ما يلزم وقت الانقطاع وحده", () => {
    expect(PRECACHE).toEqual(["/offline.html", "/icon.svg"]);
    // والملف على الجهاز يحمل القائمة نفسها.
    for (const path of PRECACHE) expect(source).toContain(`"${path}"`);
    for (const path of PRECACHE) expect(shouldCache(path)).toBe(true);
  });

  it("عامل الخدمة يعترض الطلبات — وبلا هذا لا يعرض المتصفّح التثبيت أصلًا", () => {
    expect(source).toContain('addEventListener("fetch"');
    expect(source).toContain('addEventListener("install"');
    expect(source).toContain('addEventListener("activate"');
  });

  it("ولا يخزّن إلا ما جاء من أصلنا", () => {
    expect(source).toContain("url.origin !== self.location.origin");
  });

  it("وصفحةُ الانقطاع لا تحمل بيان مريض", () => {
    const offline = readFileSync(new URL("../public/offline.html", import.meta.url), "utf8");
    expect(offline).toContain("لا اتصال بالخادم");
    // لا جلب ولا استيراد: ما يُعرض حين لا شبكة يجب أن يكون كاملًا في الملف.
    expect(offline).not.toContain("fetch(");
    expect(offline.length).toBeLessThan(4000);
  });
});

describe("ملف التثبيت", () => {
  const clinic = "مركز الدكتور عقلان الكامل لتقويم وزراعة وتجميل الأسنان";

  it("الاسم يأتي من الإعدادات لا من الكود", () => {
    const manifest = buildManifest("عيادة أخرى");
    expect(manifest.name).toBe("عيادة أخرى");
    // ولا اسم مركزٍ مكتوبٌ في الوحدة نفسها.
    const lib = readFileSync(new URL("../lib/pwa.ts", import.meta.url), "utf8");
    expect(lib).not.toContain("عقلان");
  });

  it("الاسم القصير يسع تحت أيقونةٍ على شاشة هاتف", () => {
    expect(shortName(clinic).length).toBeLessThanOrEqual(12);
    // ولا يُقطع في وسط كلمة.
    expect(clinic.startsWith(shortName(clinic))).toBe(true);
    expect(shortName(clinic)).toBe("مركز الدكتور");
    expect(shortName("  عيادة   عقلان  ")).toBe("عيادة عقلان");
    expect(shortName("")).toBe("العيادة");
    // كلمةٌ واحدة أطول من الحدّ: تُقصّ ولا تُترك فارغة.
    expect(shortName("مستشفياتالجمهوريةالتعليمي")).toHaveLength(12);
  });

  it("فيه المقاسان اللذان يطلبهما أندرويد وأيقونةٌ قابلة للقصّ", () => {
    const manifest = buildManifest(clinic);
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(manifest.icons.every((icon) => icon.type === "image/png")).toBe(true);
  });

  it("والأيقونات التي يذكرها موجودة فعلًا", () => {
    for (const icon of buildManifest(clinic).icons) {
      const file = new URL(`../public${icon.src}`, import.meta.url);
      const bytes = readFileSync(file);
      // PNG حقيقي لا ملفًا فارغًا باسمٍ صحيح.
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it("يُفتح على شاشة اليوم بشاشةٍ كاملة وباتجاه عربي", () => {
    const manifest = buildManifest(clinic);
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("ar");
  });
});

describe("ما يُقال لصاحب الجهاز", () => {
  it("سفاري يُشرح له لا يُعطى زرًّا لا يعمل", () => {
    expect(installHint("ios")).toContain("الشاشة الرئيسية");
    expect(installHint("prompt")).toContain("ثبّت");
    expect(installHint("installed")).toContain("مثبَّت");
    // كل رسالة عربية — لا واحدة تسرّب إنجليزية إلى شاشة الاستقبال.
    for (const platform of ["prompt", "ios", "installed", "unsupported"] as const) {
      expect(installHint(platform)).toMatch(/[؀-ۿ]/);
    }
  });

  it("أجهزة iPhone تُعرف — ومنها iPad الذي يقول إنه Macintosh", () => {
    expect(isIosBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605")).toBe(true);
    expect(isIosBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Mobile/15E Safari")).toBe(true);
    expect(isIosBrowser("Mozilla/5.0 (Linux; Android 13; SM-A536B) Chrome/120")).toBe(false);
    expect(isIosBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120")).toBe(false);
  });
});

/**
 * تشغيل عامل الخدمة نفسه — لا قراءةَ سياسته وحسب.
 *
 * ما يقرّر ما يبقى على الجهاز ليس دالّة `shouldCache` وحدها بل **معالجُ الطلبات
 * حولها**: سطرٌ يخزّن قبل أن يسأل، أو فرعٌ يخزّن جواب صفحةٍ حين تفشل الشبكة، يكفي
 * لتسريب سجلٍّ كامل والدالّةُ سليمة. فيُحمَّل الملف في بيئةٍ مصغّرة وتُطلق أحداثه.
 *
 * وهذا يفحص أيضًا ما لا يستطيع المتصفّح في الرحلة فحصه: قطعُ الشبكة عن مضيفٍ محلّي
 * لا يقطعها في Chromium — فتُحاكى هنا برفض `fetch` صراحةً.
 */
function bootWorker(code: string = source) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const store = new Map<string, { body: string; type: string; ok: boolean }>();
  const fetched: string[] = [];
  let offline = false;

  const make = (body: string) => ({
    body, ok: true, type: "basic",
    clone() { return make(body); },
    async text() { return body; },
  });

  const cache = {
    async addAll(paths: string[]) {
      for (const path of paths) store.set(path, { body: `محتوى ${path}`, type: "basic", ok: true });
    },
    async put(request: { url: string }, response: { body: string }) {
      store.set(new URL(request.url).pathname, { body: response.body, type: "basic", ok: true });
    },
    async match(request: { url: string } | string) {
      const path = typeof request === "string" ? request : new URL(request.url).pathname;
      const hit = store.get(path);
      return hit ? make(hit.body) : undefined;
    },
    async keys() { return [...store.keys()].map((path) => ({ url: `https://clinic.example${path}` })); },
  };

  const caches = {
    async open() { return cache; },
    async keys() { return ["aqlan-static-v1"]; },
    async delete() { return true; },
    async match(request: { url: string } | string) { return cache.match(request); },
  };

  const self = {
    addEventListener(type: string, handler: (event: Record<string, unknown>) => void) {
      listeners.set(type, handler);
    },
    location: { origin: "https://clinic.example" },
    async skipWaiting() {},
    clients: { async claim() {} },
  };

  const fetchStub = async (request: { url: string }) => {
    fetched.push(new URL(request.url).pathname);
    if (offline) throw new Error("لا شبكة");
    return make(`من الخادم ${new URL(request.url).pathname}`);
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", "caches", "fetch", "Response", "URL", code)(
    self, caches, fetchStub, Response, URL,
  );

  const emit = async (type: string, event: Record<string, unknown>) => {
    const waited: unknown[] = [];
    const answered: unknown[] = [];
    listeners.get(type)?.({
      ...event,
      waitUntil: (promise: unknown) => waited.push(promise),
      respondWith: (promise: unknown) => answered.push(promise),
    });
    await Promise.all(waited);
    return answered.length > 0 ? await (answered[0] as Promise<{ text(): Promise<string> }>) : null;
  };

  const request = (path: string, mode = "cors", method = "GET") =>
    ({ url: `https://clinic.example${path}`, mode, method });

  return { emit, request, store, fetched, goOffline: () => { offline = true; }, listeners };
}

describe("عامل الخدمة وهو يعمل", () => {
  it("يخزّن صفحة الانقطاع وقت التثبيت — قبل أن تنقطع", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    expect([...worker.store.keys()].sort()).toEqual(["/icon.svg", "/offline.html"]);
  });

  it("ولا يخزّن جواب `/api/` ولو مرّ عليه", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    const answer = await worker.emit("fetch", { request: worker.request("/api/patients") });
    // لم يردّ أصلًا: الطلب يمرّ إلى الشبكة كما هو بلا وسيط.
    expect(answer).toBeNull();
    expect(worker.store.has("/api/patients")).toBe(false);
  });

  it("ولا يخزّن صفحة مريض حتى وهي تُفتح", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    await worker.emit("fetch", { request: worker.request("/patients/12", "navigate") });
    expect([...worker.store.keys()]).not.toContain("/patients/12");
  });

  it("ويخزّن ملف البناء مرّةً ثم يخدمه من القرص", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    const path = "/_next/static/chunks/main-a1b2.js";
    const first = await worker.emit("fetch", { request: worker.request(path) });
    expect(await (first as { text(): Promise<string> }).text()).toContain("من الخادم");
    const before = worker.fetched.length;
    const second = await worker.emit("fetch", { request: worker.request(path) });
    expect(await (second as { text(): Promise<string> }).text()).toContain("من الخادم");
    // لم يُطلب من الشبكة ثانيةً — وهذا كل ما يشتريه التثبيت: فتحٌ أسرع.
    expect(worker.fetched.length).toBe(before);
  });

  it("وحين تنقطع الشبكة يعرض صفحة الانقطاع لا شاشة خطأ المتصفّح", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    worker.goOffline();
    const answer = await worker.emit("fetch", { request: worker.request("/appointments", "navigate") });
    expect(await (answer as { text(): Promise<string> }).text()).toContain("/offline.html");
  });

  it("ولا يمسّ طلبًا إلى مضيفٍ آخر", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    const answer = await worker.emit("fetch", {
      request: { url: "https://fonts.example/x.woff2", mode: "cors", method: "GET" },
    });
    expect(answer).toBeNull();
  });

  it("ولا يعترض كتابةً — طلبُ حفظٍ لا يُخزَّن ولا يُعاد من قرص", async () => {
    const worker = bootWorker();
    await worker.emit("install", {});
    const answer = await worker.emit("fetch", { request: worker.request("/api/visits", "cors", "POST") });
    expect(answer).toBeNull();
  });

  it("والفحص نفسه يمسك تسريبًا — نسخةٌ معطوبة تُشغَّل فتسقط", async () => {
    /*
     * «نخزّن الصفحات ليفتح البرنامج أسرع» — سطرٌ واحد بحسن نيّة. يُبنى هنا من
     * المصدر نفسه ويُشغَّل، ليُرى ما كان سيبقى على جهازٍ يُترك على الطاولة.
     */
    const broken = source.replace(
      'if (request.mode === "navigate") {',
      'if (request.mode === "navigate") { caches.open(CACHE).then((c) => c.put(request, { body: "x" }));',
    );
    expect(broken).not.toBe(source);

    const leaky = bootWorker(broken);
    await leaky.emit("install", {});
    await leaky.emit("fetch", { request: leaky.request("/patients/12", "navigate") });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...leaky.store.keys()]).toContain("/patients/12");

    // وبالمصدر السليم لا أثر لها.
    const sound = bootWorker();
    await sound.emit("install", {});
    await sound.emit("fetch", { request: sound.request("/patients/12", "navigate") });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...sound.store.keys()]).not.toContain("/patients/12");
  });
});
