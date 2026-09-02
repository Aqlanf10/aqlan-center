"use client";

import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { MAX_VOICE_MS, formatVoiceDuration, isAllowedVoiceMime } from "@/lib/messages";

/**
 * زرّ التسجيل — الفارق العملي في هذه الشاشة.
 *
 * الطبيب ويداه في فم مريض لا يكتب، لكنه يقول عشر كلمات في خمس ثوانٍ. وضغطةٌ
 * واحدة تبدأ، وضغطةٌ تنهي وترسل.
 *
 * وثلاثة أشياء تُعالَج هنا لأنها تُنسى فتفشل الميزة بصمت:
 *
 * ١) **الإذن قد يُرفض** — فتظهر رسالةٌ عربية تقول ما يُفعل، لا زرٌّ لا يستجيب.
 * ٢) **المجرى يبقى مفتوحًا** إن لم يُغلق صراحةً، فيبقى ضوء الميكروفون مضاءً على
 *    الهاتف بعد الإرسال — ومن يرى ذلك مرّةً لا يستعمل الزرّ ثانية.
 * ٣) **الحدّ يُفرض هنا وعلى الخادم معًا**: مؤقّتٌ يُنهي التسجيل عند الدقيقتين،
 *    وحدٌّ على الخادم لأن حارس الواجهة وحده ليس حارسًا.
 */
export function VoiceRecorder({ onRecorded, onError, disabled }: {
  onRecorded: (clip: { base64: string; mime: string; ms: number }) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (ticker.current) { clearInterval(ticker.current); ticker.current = null; }
    if (limit.current) { clearTimeout(limit.current); limit.current = null; }
    setRecording(false);
    setElapsed(0);
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("هذا المتصفّح لا يدعم التسجيل الصوتي.");
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("لم يُسمح باستعمال الميكروفون — اسمح به من إعدادات المتصفّح.");
      return;
    }
    stream.current = media;

    const chunks: Blob[] = [];
    const started = Date.now();
    const device = new MediaRecorder(media);
    recorder.current = device;
    device.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    device.onstop = async () => {
      const ms = Date.now() - started;
      const blob = new Blob(chunks, { type: device.mimeType || "audio/webm" });
      release();
      // تسجيلٌ أقصر من ثانية ضغطةٌ بالخطأ لا رسالة.
      if (ms < 1000 || blob.size === 0) return;
      if (!isAllowedVoiceMime(blob.type)) {
        onError("نوع التسجيل الصوتي غير مدعوم في هذا المتصفّح.");
        return;
      }
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      // على دفعات: `String.fromCharCode(...bytes)` ينهار على مكدّس الاستدعاء
      // عند ملفٍّ بحجم ميغابايت — وهو أشيع من الحالة التي تعمل.
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      await onRecorded({ base64: btoa(binary), mime: blob.type, ms: Math.min(ms, MAX_VOICE_MS) });
    };

    device.start();
    setRecording(true);
    ticker.current = setInterval(() => setElapsed(Date.now() - started), 200);
    limit.current = setTimeout(() => { device.stop(); }, MAX_VOICE_MS);
  };

  const stop = () => { recorder.current?.stop(); };

  if (recording) {
    return (
      <button
        onClick={stop}
        aria-label="إنهاء التسجيل وإرساله"
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-danger-600 px-3 py-2 text-sm font-bold text-white"
      >
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
        {formatVoiceDuration(elapsed)}
      </button>
    );
  }

  return (
    <button
      onClick={() => void start()}
      disabled={disabled}
      aria-label="تسجيل ملاحظة صوتية"
      className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
    >
      <Icon name="mic" className="h-5 w-5" />
    </button>
  );
}
