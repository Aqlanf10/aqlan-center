import { NextResponse } from "next/server";
import {
  CLINIC_TIME_ZONE, chairMinutes, executiveOperational, getSettings, journalEntries,
} from "@/lib/db";
import { trialBalance } from "@/lib/accounting";
import { chairOccupancy, executiveKpis, periodRange, type PeriodPreset } from "@/lib/executive";
import { isCurrency } from "@/lib/money";
import { isAdmin } from "@/lib/roles";
import { clinicDateString, toMinutes } from "@/lib/schedule";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRESETS: PeriodPreset[] = ["today", "week", "month", "quarter", "year"];

/**
 * غرفة القيادة — للمدير وحده.
 *
 * وهي أكثر ما يجب أن يُحجب عن غيره: دخلُ المركز وأرباحه وذممه في شاشةٍ واحدة.
 * والطبيب يعالج، والمال ليس عمله — وإطلاعه على ربح المركز يفتح بابًا لا يُغلق.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });
  }
  if (!isAdmin(session.role)) {
    return NextResponse.json({ message: "غرفة القيادة للمدير وحده." }, { status: 403 });
  }

  const given = new URL(request.url).searchParams.get("period");
  const preset: PeriodPreset = PRESETS.includes(given as PeriodPreset)
    ? (given as PeriodPreset) : "month";

  try {
    const today = clinicDateString(new Date(), CLINIC_TIME_ZONE);
    const { from, to } = periodRange(preset, today);
    const settings = await getSettings();
    const base = settings["finance.base_currency"];
    if (!isCurrency(base)) {
      return NextResponse.json({ message: "العملة الأساسية في الإعدادات غير صالحة." }, { status: 500 });
    }

    /*
     * قيدان اثنان لا واحد: الفترة للدخل والتحصيل، والتراكمي للذمم.
     *
     * فالذمم **رصيدٌ لا حركة**: «على المرضى ٣ ملايين» جوابٌ عن اليوم كلّه. ولو
     * حُسبت من قيود الشهر لقالت اللوحة إن الذمم صفرٌ في أوّل يومٍ من كل شهر.
     */
    const [periodEntries, allEntries, operational, minutes] = await Promise.all([
      journalEntries(from, to),
      journalEntries("1900-01-01", to),
      executiveOperational({
        from, to, today,
        adjustWeeks: Number(settings["ortho.adjust_weeks"]) || 4,
        retentionWeeks: Number(settings["ortho.retention_weeks"]) || 24,
      }),
      chairMinutes(from, to),
    ]);

    // وقتٌ غير صالح في الإعدادات لا يُسقط الشاشة ولا يُخرج سعةً سالبة: يُرجع إلى
    // دوامٍ معقول، فالنسبة تقريبٌ للقرار لا رقمٌ محاسبي.
    const start = toMinutes(settings["clinic.day_start"] ?? "") ?? toMinutes("09:00")!;
    const end = toMinutes(settings["clinic.day_end"] ?? "") ?? toMinutes("20:00")!;
    const dayMinutes = Math.max(0, end - start);

    return NextResponse.json({
      preset,
      kpis: executiveKpis({
        from, to, baseCurrency: base,
        periodBalances: trialBalance(periodEntries),
        cumulativeBalances: trialBalance(allEntries),
        operational,
        occupancy: chairOccupancy({
          chairs: Number(settings["clinic.chairs"]) || 1,
          activeDays: minutes.activeDays,
          occupiedMinutes: minutes.occupiedMinutes,
          dayMinutes,
        }),
      }),
    });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل غرفة القيادة." }, { status: 500 });
  }
}
