"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useClinicName } from "./SettingsProvider";

/**
 * قشرة البرنامج — تنقّل واحد لكل الشاشات.
 *
 * كانت كل صفحة تحمل صفّ روابطها الخاص، فاختلفت الروابط بين الشاشات وضاع «أين أنا»،
 * وكل وحدة جديدة كانت تعني تعديل ست صفحات. الآن: قائمة واحدة، والصفحة تعرف مكانها
 * منها.
 *
 * الشكل يتبع الجهاز لا العكس: الاستقبال على هاتف طول اليوم فالتنقّل شريط سفلي يُطال
 * بالإبهام؛ والطبيب على شاشة مكتب فالتنقّل عمود جانبي دائم. وهما نفس القائمة.
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: "requests" | "lab";
}

const NAV: NavItem[] = [
  { href: "/", label: "اليوم", icon: "🦷" },
  { href: "/appointments", label: "المواعيد", icon: "🗓" },
  { href: "/patients", label: "المرضى", icon: "👤" },
  { href: "/finance", label: "الصندوق", icon: "💵" },
  { href: "/lab", label: "المختبر", icon: "🔧", badge: "lab" },
  { href: "/recall", label: "المتابعة", icon: "📞" },
  { href: "/requests", label: "الطلبات", icon: "📥", badge: "requests" },
  { href: "/report", label: "التقرير", icon: "📊" },
  { href: "/settings", label: "الإعدادات", icon: "⚙️" },
];

/**
 * الشاشات التي لا قشرة لها: عامة، أو تُعرض على تلفاز، أو قبل الدخول، أو تُطبع.
 *
 * صفحات الطباعة أهمّها هنا: قائمة جانبية وشريط سفلي على ورقة سندٍ يُعطى لمريض.
 */
const BARE_PATHS = ["/login", "/setup", "/display", "/book", "/print"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const clinicName = useClinicName();
  const [badges, setBadges] = useState<{ requests: number; lab: number }>({ requests: 0, lab: 0 });
  const [moreOpen, setMoreOpen] = useState(false);

  const bare = BARE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  const loadBadges = useCallback(async () => {
    try {
      const [requests, lab] = await Promise.all([
        fetch("/api/booking-requests?status=new", { cache: "no-store" }),
        fetch("/api/lab?summary=1", { cache: "no-store" }),
      ]);
      const next = { requests: 0, lab: 0 };
      if (requests.ok) next.requests = ((await requests.json()) as unknown[]).length;
      if (lab.ok) next.lab = Number(((await lab.json()) as { late?: number }).late ?? 0);
      setBadges(next);
    } catch {
      // العدّادان يبقيان على آخر قيمة: رقمٌ قديم أنفع من اختفاء التنبيه.
    }
  }, []);

  // القائمة تُغلق مع كل انتقال: بقاؤها مفتوحة فوق الشاشة الجديدة يخفي أعلاها.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  useEffect(() => {
    if (bare) return;
    void loadBadges();
    // دقيقة كافية: هذه تنبيهات لا أرقام تشغيل لحظية، وطلبها كل عشرين ثانية من كل
    // شاشة كان يضاعف الطلبات بلا فائدة.
    const timer = setInterval(() => { void loadBadges(); }, 60_000);
    return () => clearInterval(timer);
  }, [bare, loadBadges]);

  if (bare) return <>{children}</>;

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  // شاشة من الشاشات المخفية خلف «المزيد» مفتوحة الآن — فيُضاء الزر.
  const restActive = NAV.slice(4).some((item) => isActive(item.href));

  return (
    <div className="min-h-full lg:flex">
      <aside className="hidden w-56 shrink-0 border-l border-slate-200 bg-white p-4 lg:block">
        <p className="mb-1 text-sm font-extrabold text-navy-900">عيادة عقلان</p>
        <p className="mb-5 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{clinicName}</p>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${
                isActive(item.href) ? "bg-navy-800 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <Badge item={item} badges={badges} />
            </a>
          ))}
        </nav>
        <div className="mt-5 space-y-1 border-t border-slate-100 pt-4">
          <a href="/display" target="_blank" rel="noopener"
            className="block rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">
            شاشة الصالة ↗
          </a>
          <a href="/book" target="_blank" rel="noopener"
            className="block rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">
            صفحة حجز المرضى ↗
          </a>
          <button onClick={signOut}
            className="block w-full rounded-xl px-3 py-2 text-right text-xs font-bold text-slate-500 hover:bg-slate-50">
            خروج
          </button>
        </div>
      </aside>

      <div className="flex-1 pb-20 lg:pb-0">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <span className="truncate text-xs font-bold text-slate-500">{clinicName}</span>
          <button onClick={signOut} className="shrink-0 text-xs font-bold text-slate-400">خروج</button>
        </div>
        {children}
      </div>

      {/*
        شريط سفلي على الهاتف: الاستقبال تمسك الجهاز بيد واحدة طول اليوم.
        أربع شاشات في الشريط والبقية خلف «المزيد» — وهو زر يفتح قائمة فعلًا، لا رابط
        إلى شاشة واحدة سُمّي «المزيد».
      */}
      {moreOpen ? (
        <button
          aria-label="إغلاق القائمة"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-20 bg-navy-900/20 lg:hidden"
        />
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        {moreOpen ? (
          <div className="border-b border-slate-100 p-2">
            {NAV.slice(4).map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700"
              >
                <span aria-hidden>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <Badge item={item} badges={badges} />
              </a>
            ))}
            <a href="/display" target="_blank" rel="noopener"
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-500">
              <span aria-hidden>📺</span> شاشة الصالة ↗
            </a>
            <a href="/book" target="_blank" rel="noopener"
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-500">
              <span aria-hidden>🔗</span> صفحة حجز المرضى ↗
            </a>
          </div>
        ) : null}

        <div className="flex justify-around">
          {NAV.slice(0, 4).map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${
                isActive(item.href) ? "text-navy-900" : "text-slate-400"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">{item.icon}</span>
              {item.label}
              <Badge item={item} badges={badges} floating />
            </a>
          ))}
          <button
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${
              moreOpen || restActive ? "text-navy-900" : "text-slate-400"
            }`}
          >
            <span aria-hidden className="text-lg leading-none">{moreOpen ? "✕" : "☰"}</span>
            المزيد
            {!moreOpen && badges.requests > 0 ? (
              <span className="absolute -top-0.5 left-1/4 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                {badges.requests}
              </span>
            ) : null}
          </button>
        </div>
      </nav>
    </div>
  );
}

function Badge({ item, badges, floating = false }: {
  item: NavItem;
  badges: { requests: number; lab: number };
  floating?: boolean;
}) {
  if (!item.badge) return null;
  const count = badges[item.badge];
  if (!count) return null;
  return (
    <span className={`rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white ${
      floating ? "absolute -top-0.5 left-1/4" : ""
    }`}>
      {count}
    </span>
  );
}
