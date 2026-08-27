import type { Metadata } from "next";
import { CLINIC_NAME } from "@/lib/clinic";

export const metadata: Metadata = {
  title: `طلب موعد — ${CLINIC_NAME}`,
  description: "اطلب موعدًا في المركز، وسنتصل بك لتأكيد الوقت.",
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
