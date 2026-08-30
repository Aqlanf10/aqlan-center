/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'self'; base-uri 'self'" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }];
  },
  /**
   * بناء مستقل: يُخرج `server.js` ومعه أدنى ما يلزم من الاعتماديات فقط.
   *
   * بلا هذا تحتاج صورة النشر `node_modules` كاملة — مئات الميغابايتات وآلاف الملفات
   * التي لا يقرأها التشغيل أصلًا، فيبطؤ كل نشر وتتّسع مساحة الهجوم بلا مقابل.
   */
  output: "standalone",

  /**
   * خادم التطوير وحده: يمنع Next افتراضيًا طلبات `/_next/*` التي تحمل ترويسة
   * `Origin` من مضيفٍ غير `localhost`. والرحلات تفتح المتصفح على `127.0.0.1`،
   * فكانت حِزَم الواجهة تُرَدّ بـ403 فلا يتمّ الترطيب: تُكتب كلمة المرور في الحقل
   * ويبقى الزرّ معطّلًا، فتسقط الرحلة بخطأٍ يشير إلى الزرّ لا إلى السبب.
   *
   * و`127.0.0.1` هو `localhost` نفسه — عنوان الجهاز عن نفسه — فالمسموح هنا لا
   * يتجاوز ما يسمح به Next أصلًا. ولا أثر لهذا في الإنتاج: `next start` لا يفحص.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
export default nextConfig;
