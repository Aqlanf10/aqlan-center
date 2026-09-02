"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { installHint, isIosBrowser, type InstallPlatform } from "@/lib/pwa";

/** ما يعطيه Chrome للصفحة حين تصير قابلة للتثبيت — ليس في تعريفات المتصفّح بعد. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * زرّ التثبيت — يظهر متى كان التثبيت ممكنًا فعلًا، ويختفي بعده.
 *
 * وزرٌّ دائمٌ يقول «ثبّت» بعد التثبيت يجعل من يضغطه يظنّ أن شيئًا تعطّل؛ وزرٌّ يظهر
 * على متصفّحٍ لا يدعم التثبيت وعدٌ لا يُنفَّذ. فالحالة تُقرأ من المتصفّح نفسه:
 * إمّا عرضٌ محفوظٌ يُطلق، أو شرحُ سفاري، أو لا شيء.
 */
export function InstallApp({ variant = "sidebar" }: { variant?: "sidebar" | "sheet" }) {
  const [offer, setOffer] = useState<InstallEvent | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);

  useEffect(() => {
    // مثبَّتٌ أصلًا: الشاشة تعمل بلا شريط عنوان.
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) { setPlatform("installed"); return; }

    if (isIosBrowser(navigator.userAgent)) { setPlatform("ios"); return; }

    const onOffer = (event: Event) => {
      // بلا هذا يعرض Chrome شريطه الخاص في أسفل الشاشة فوق شريط التنقّل.
      event.preventDefault();
      setOffer(event as InstallEvent);
      setPlatform("prompt");
    };
    const onInstalled = () => { setOffer(null); setPlatform("installed"); };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // لا حالة بعد، أو متصفّحٌ لا يعرض شيئًا: لا يُشغل مكانًا في القائمة.
  if (platform === null || platform === "installed" || platform === "unsupported") return null;

  const label = installHint(platform);
  const base = variant === "sheet"
    ? "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-sm font-semibold"
    : "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-right text-xs font-semibold";

  if (platform === "ios") {
    return (
      <p className={`${base} text-slate-500`}>
        <Icon name="download" className="h-4 w-4 shrink-0" />
        <span className="flex-1 leading-relaxed">{label}</span>
      </p>
    );
  }

  return (
    <button
      onClick={async () => {
        if (!offer) return;
        await offer.prompt();
        // رُفض العرض: لا يُعاد إطلاقه — المتصفّح وحده يقرّر متى يعرضه ثانية.
        const choice = await offer.userChoice.catch(() => null);
        setOffer(null);
        // الزرّ يختفي في الحالتين: العرض يُطلق مرّةً واحدة ولا يُعاد، فزرٌّ باقٍ
        // بعد الرفض زرٌّ لا يفعل شيئًا. ويعود متى أطلق المتصفّح عرضًا جديدًا.
        setPlatform(choice?.outcome === "accepted" ? "installed" : null);
      }}
      className={`${base} text-navy-800 hover:bg-navy-50`}
    >
      <Icon name="download" className="h-4 w-4 shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  );
}
