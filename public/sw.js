/*
 * عامل الخدمة — ما يُخزَّن على الجهاز وما لا يُخزَّن.
 *
 * وجودُه شرطٌ لأن يعرض المتصفّح «ثبّت التطبيق» أصلًا، لكن دوره هنا مقصورٌ عمدًا:
 * ملفات البناء وحدها تُخزَّن — نصوصٌ وخطوطٌ وأيقونات باسمٍ فيه بصمة محتواها — وكلُّ
 * ما عداها يمرّ إلى الشبكة في كل طلب.
 *
 * ولا يُخزَّن مسار `/api/` ولا صفحةٌ فيها بيانات مريض. والسبب ليس حذرًا زائدًا:
 * الهاتف يُترك على طاولة الاستقبال، وسجلٌّ مخزَّنٌ فيه يبقى بعد الخروج ويُقرأ بلا
 * جلسة؛ ورصيدٌ مخزَّنٌ يُعرض على أنه رصيد اليوم وهو رصيد أمس. **رقمٌ قديم يُعرض على
 * أنه اليوم أسوأ من لا رقم.**
 *
 * وهذا الملف يُخدَم من الجذر ليكون نطاقُه البرنامج كله — ومسارُه مفتوحٌ في الحارس
 * لهذا السبب وحده.
 */

// اسمٌ فيه رقم إصدار: تغييره يهجر الخزانة القديمة كلّها في التنشيط.
const CACHE = "aqlan-static-v1";
const PRECACHE = ["/offline.html", "/icon.svg"];

/**
 * نسخة `shouldCache` من `lib/pwa.ts`.
 *
 * مكرّرة لأن عامل الخدمة ملفٌّ مستقلٌّ لا يمرّ بالبناء — واختبارٌ يقرأ هذه الدالة
 * من هنا ويشغّلها مع الأصل على جدول مسارات واحد، فانحرافُ إحداهما يسقط الاختبار.
 */
function shouldCache(pathname) {
  const prefixes = ["/_next/static/", "/icons/"];
  const exact = ["/icon.svg", "/offline.html"];
  if (!pathname.startsWith("/")) return false;
  if (exact.includes(pathname)) return true;
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // تعذّر جلب صفحة الانقطاع لا يمنع التثبيت: البرنامج يعمل بلا خزانة.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  // لا يُخزَّن ولا يُقرأ إلا من أصلنا: طلبٌ إلى مضيفٍ آخر يمرّ كما هو.
  if (url.origin !== self.location.origin) return;

  if (shouldCache(url.pathname)) {
    // الخزانة أولًا: هذه ملفاتٌ اسمُها يتغيّر متى تغيّر محتواها، فلا قديم يُخدَم.
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })),
    );
    return;
  }

  // انتقالُ صفحةٍ بلا شبكة: صفحةُ انقطاعٍ تقول ما جرى، لا شاشةُ خطأ المتصفّح.
  // ولا تُخزَّن الصفحة المطلوبة نفسها — فيها بيانات مريض.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html").then(
        (hit) => hit ?? new Response("لا اتصال بالخادم.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      )),
    );
    return;
  }

  // كلُّ ما بقي — ومنه `/api/` كلّه — شبكةٌ خالصة بلا أثرٍ على الجهاز.
});
