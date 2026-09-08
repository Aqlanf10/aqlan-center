"use client";

import { createContext, useContext } from "react";
import { SETTING_DEFAULTS, chairCount, type SettingsMap } from "@/lib/settings";
import { CLINIC_ZONE_FALLBACK } from "@/lib/clinicZone";

/**
 * الإعدادات في متناول كل صفحة بلا طلب شبكة.
 *
 * التخطيط الجذري يقرأها على الخادم مرة ويمرّرها هنا، فتصل الصفحات جاهزة مع أول
 * رسم. البديل — أن تطلبها كل صفحة بنفسها — كان يعني وميض «مركز…» ثم الاسم الحقيقي
 * على كل شاشة، وعدد كراسٍ خاطئًا في أول ثانية من عمر اللوحة.
 */
const SettingsContext = createContext<Partial<SettingsMap>>({});

/**
 * منطقةُ توقيت العيادة كما ضُبطت في النشر.
 *
 * وهي ليست «إعدادًا» يُحرّره المالك بل ضبطُ نشر، فلها سياقُها لا مفتاحٌ في
 * جدول الإعدادات. والتخطيط الجذري يمرّرها من `CLINIC_TIME_ZONE` نفسها التي
 * يحسب بها الخادم — فلا ينحرف ما تراه الشاشة عمّا يحسبه الخادم.
 */
const ClinicZoneContext = createContext<string>(CLINIC_ZONE_FALLBACK);

export function SettingsProvider({ value, timeZone, children }: {
  value: Partial<SettingsMap>;
  timeZone?: string;
  children: React.ReactNode;
}) {
  return (
    <ClinicZoneContext.Provider value={timeZone || CLINIC_ZONE_FALLBACK}>
      <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
    </ClinicZoneContext.Provider>
  );
}

/** منطقةُ توقيت العيادة — تُقرأ ولا تُكتب حرفيًّا في شاشة. */
export function useClinicTimeZone(): string {
  return useContext(ClinicZoneContext);
}

export function useSettings(): Partial<SettingsMap> {
  return useContext(SettingsContext);
}

export function useSetting(key: keyof SettingsMap): string {
  const settings = useContext(SettingsContext);
  return settings[key] ?? SETTING_DEFAULTS[key];
}

export function useClinicName(): string {
  return useSetting("clinic.name");
}

export function useChairCount(): number {
  const settings = useContext(SettingsContext);
  return chairCount({ ...SETTING_DEFAULTS, ...settings } as SettingsMap);
}
