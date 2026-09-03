import { NextResponse } from "next/server";
import {
  approveCephStudy, archiveCephStudy, cephStudyAnalysis, linkStudyToCase, recordAudit,
} from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * دراسةٌ بعينها — تُقرأ بتحليلها، وتُعتمد أو تُؤرشف أو تُربط بحالة تقويم.
 *
 * والاعتماد **توقيعٌ** لا حفظ: لحظتَه تُنسخ المعالم إلى الدراسة فتنفصل عن
 * التتبّع الحيّ. وهو للطبيب والمدير وحدهما، ويُسجَّل في سجلّ التدقيق باسم من
 * وقّعه — فمن يُسأل بعد سنتين «من اعتمد هذه الأرقام» يجد الجواب.
 */

const denied = () =>
  NextResponse.json({ message: "انتهت الجلسة. سجّل الدخول من جديد." }, { status: 401 });

const clinicalOnly = () =>
  NextResponse.json({ message: "الدراسة السيفالومترية للطبيب والمدير." }, { status: 403 });

const idFrom = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role) && session.role !== "doctor") return clinicalOnly();
  const id = await idFrom(context);
  if (!id) return NextResponse.json({ message: "رقم الدراسة غير صالح." }, { status: 400 });

  try {
    const found = await cephStudyAnalysis(id);
    if (!found) return NextResponse.json({ message: "الدراسة غير موجودة." }, { status: 404 });
    return NextResponse.json({
      study: found.study,
      points: found.points,
      calibration: found.calibration,
      analysis: found.analysis,
      // من أين قُرئت أرقامُها — والشاشة تقولها للقارئ لا تُخفيها.
      source: found.study.status === "draft" ? "live" : "snapshot",
    });
  } catch {
    return NextResponse.json({ message: "تعذّر تحميل الدراسة." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return denied();
  if (!isAdmin(session.role) && session.role !== "doctor") return clinicalOnly();
  const id = await idFrom(context);
  if (!id) return NextResponse.json({ message: "رقم الدراسة غير صالح." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: "طلب غير صالح." }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;

  try {
    if (source.action === "approve") {
      const done = await approveCephStudy({ id, actor: session.username });
      if (!done.ok) return NextResponse.json({ message: done.message }, { status: 409 });
      void recordAudit({
        action: "ceph.study.approve",
        entity: "ceph_studies",
        entityId: id,
        entityLabel: `اعتماد الدراسة ${id}`,
        details: {},
        actor: session.username,
        actorRole: session.role,
      });
      return NextResponse.json({ ok: true });
    }

    if (source.action === "archive") {
      const done = await archiveCephStudy({ id });
      if (!done.ok) return NextResponse.json({ message: done.message }, { status: 409 });
      void recordAudit({
        action: "ceph.study.archive",
        entity: "ceph_studies",
        entityId: id,
        entityLabel: `أرشفة الدراسة ${id}`,
        details: {},
        actor: session.username,
        actorRole: session.role,
      });
      return NextResponse.json({ ok: true });
    }

    if (source.action === "link") {
      const raw = Number(source.orthoCaseId);
      const orthoCaseId = Number.isInteger(raw) && raw > 0 ? raw : null;
      const done = await linkStudyToCase({ id, orthoCaseId });
      if (!done.ok) return NextResponse.json({ message: done.message }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ message: "أمرٌ غير معروف." }, { status: 400 });
  } catch {
    return NextResponse.json({ message: "تعذّر تنفيذ الطلب." }, { status: 500 });
  }
}
