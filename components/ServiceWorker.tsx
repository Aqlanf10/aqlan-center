"use client";

import { useEffect } from "react";

/**
 * تسجيل عامل الخدمة — مرّةً واحدة لكل صفحة يفتحها البرنامج.
 *
 * ومكانه التخطيط الجذري لا شريط التنقّل: من يفتح البرنامج أول مرة يقف على شاشة
 * الدخول — وهي بلا قشرة — فلو سُجّل من القشرة وحدها لما ظهر عرض التثبيت لمن لم
 * يدخل بعد، وهو أول من يحتاجه.
 *
 * وما يفعله العامل محدود ومكتوب في `public/sw.js`: ملفات البناء تُخزَّن، وكلُّ ما
 * فيه بيان مريض يمرّ إلى الشبكة.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // بعد التحميل لا أثناءه: التسجيل يزاحم أول رسمٍ للشاشة على هاتفٍ بطيء.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // تعذّر التسجيل لا يعطّل شيئًا — البرنامج يعمل من الشبكة كما كان.
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
