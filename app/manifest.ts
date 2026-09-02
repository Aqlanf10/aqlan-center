import type { MetadataRoute } from "next";
import { getSettingsSafe } from "@/lib/db";
import { buildManifest } from "@/lib/pwa";

/**
 * `/manifest.webmanifest` — ما يقرؤه النظام ليعرض «ثبّت التطبيق».
 *
 * وهو ديناميّ لأن الاسم يأتي من الإعدادات: من يغيّر اسم مركزه من الشاشة يجب أن
 * يجده تحت الأيقونة، لا اسمًا خُبز يوم البناء ولا يتغيّر حتى النشرة التالية.
 *
 * ومسارُه مفتوح في الحارس: المتصفّح يطلبه قبل الدخول وبلا كوكي، ولو رُدّ بتحويلٍ
 * إلى صفحة الدخول لما ظهر عرض التثبيت أصلًا. وما فيه اسم المركز وحده — وهو معلن
 * على واجهة المركز وعلى شاشة الحجز.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettingsSafe();
  return buildManifest(settings["clinic.name"]) as MetadataRoute.Manifest;
}
