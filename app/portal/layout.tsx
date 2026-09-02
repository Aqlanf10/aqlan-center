import type { Metadata } from "next";
import { getSettingsSafe } from "@/lib/db";

/** عنوان التبويب من الإعدادات: هذه شاشة المريض، واسم المركز عليها هويّته. */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettingsSafe();
  return {
    title: `بوابتي — ${settings["clinic.name"]}`,
    description: "حسابك ومواعيدك في المركز، وتأكيد حضورك.",
  };
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
