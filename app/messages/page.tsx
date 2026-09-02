"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import {
  MAX_TEXT_LENGTH, formatVoiceDuration, messagePreview, sortConversations,
} from "@/lib/messages";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/**
 * الرسائل الداخلية.
 *
 * العيادة تعمل بالنداء: الاستقبال تنادي على الطبيب من الباب وهو على كرسيٍّ آخر،
 * والطبيب يصرخ باسم المادّة الناقصة، والمريض بينهما يسمع كل شيء. ثم يُنسى ما
 * قيل، فيُسأل عنه غدًا فلا أحد يذكر من قاله ولا متى.
 *
 * وشاشةٌ واحدة تحلّ الثلاثة: يُقال بلا صوت، ويُقرأ حين يفرغ، ويبقى مكتوبًا.
 *
 * **والملاحظة الصوتية هي الفارق**: الطبيب ويداه في فم مريض لا يكتب، لكنه يقول
 * عشر كلمات في خمس ثوانٍ.
 */

interface Message {
  id: number;
  senderId: number;
  senderName: string;
  recipientId: number | null;
  kind: "text" | "voice";
  body: string | null;
  voiceMs: number | null;
  createdAt: string;
}

interface Conversation {
  userId: number | null;
  displayName: string;
  role: string | null;
  lastAt: string | null;
  lastKind: "text" | "voice" | null;
  lastBody: string | null;
  lastVoiceMs: number | null;
  unread: number;
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [meId, setMeId] = useState<number | null>(null);
  // `undefined` = لم يُختر شيء بعد؛ `null` = صندوق الفريق؛ رقم = زميل.
  const [openWith, setOpenWith] = useState<number | null | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/messages?conversations=1", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setConversations(payload.conversations ?? []);
      setMeId(payload.meId ?? null);
    } catch {
      // القائمة تبقى على آخر قيمة: قائمةٌ قديمة أنفع من شاشةٍ فارغة.
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (target: number | null) => {
    const query = target === null ? "broadcast=1" : `withUser=${target}`;
    try {
      const response = await fetch(`/api/messages?${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) { setError(payload.message ?? "تعذّر تحميل المحادثة."); return; }
      setMessages(payload.messages ?? []);
      setMeId(payload.meId ?? null);
      setError(null);
      // فتحُ المحادثة يعلّمها مقروءة على الخادم، فتُحدَّث العدّادات معها.
      void loadConversations();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    }
  }, [loadConversations]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (openWith === undefined) return;
    void loadThread(openWith);
    /*
     * استطلاعٌ كل عشر ثوانٍ — لا مقابس ويب.
     *
     * خمسة أشخاص في مبنى واحد لا يحتاجون خادم دردشة، وعشر ثوانٍ فرقٌ لا يُلاحَظ
     * بين رسالةٍ تصل وأخرى. والمقابس تعني بنيةً ثانية تُصان وتنقطع بلا صوت.
     */
    const timer = setInterval(() => { void loadThread(openWith); }, 10_000);
    return () => clearInterval(timer);
  }, [openWith, loadThread]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const ordered = useMemo(() => sortConversations(conversations), [conversations]);
  const active = useMemo(
    () => ordered.find((row) => row.userId === (openWith ?? null)) ?? null,
    [ordered, openWith],
  );
  const totalUnread = useMemo(
    () => conversations.reduce((sum, row) => sum + row.unread, 0), [conversations]);

  const send = async (payload: Record<string, unknown>) => {
    if (openWith === undefined) return false;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: openWith === null ? "broadcast" : { kind: "user", userId: openWith },
          ...payload,
        }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.message ?? "تعذّر إرسال الرسالة."); return false; }
      setMessages((current) => [...current, result as Message]);
      void loadConversations();
      return true;
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendText = async () => {
    const body = draft.trim();
    if (!body) return;
    if (await send({ kind: "text", body })) setDraft("");
  };

  return (
    <main className="mx-auto max-w-6xl p-4 lg:p-6">
      <PageHeader
        title="الرسائل"
        subtitle={totalUnread > 0
          ? `${totalUnread} رسالة لم تُقرأ`
          : "ما يُقال بين الطاقم يبقى مكتوبًا — لا يُنادى به من الباب"}
      />

      {error ? (
        <p role="alert" className="mb-3 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* القائمة: تُخفى على الهاتف متى فُتحت محادثة — الشاشة صغيرة والاثنان لا يسعان */}
        <aside className={`${openWith === undefined ? "" : "hidden lg:block"} space-y-1.5`}>
          {loading ? <p className="text-xs font-semibold text-slate-400">…جارٍ التحميل</p> : null}
          {ordered.map((row) => (
            <button
              key={row.userId ?? "broadcast"}
              onClick={() => setOpenWith(row.userId)}
              className={`flex w-full items-start gap-2.5 rounded-2xl border p-3 text-right transition-colors ${
                (openWith ?? null) === row.userId && openWith !== undefined
                  ? "border-navy-800 bg-navy-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                row.userId === null ? "bg-accent-100 text-accent-700" : "bg-navy-100 text-navy-800"
              }`}>
                {row.userId === null ? <Icon name="inbox" className="h-4 w-4" /> : row.displayName.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-bold text-navy-900">{row.displayName}</span>
                  {row.unread > 0 ? (
                    <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                      {row.unread}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">
                  {row.lastAt
                    ? messagePreview(row.lastKind ?? "text", row.lastBody, row.lastVoiceMs)
                    : row.role
                      ? (ROLE_LABEL[row.role as Role] ?? row.role)
                      : "لا رسائل بعد"}
                </span>
              </span>
            </button>
          ))}
        </aside>

        <section className={`${openWith === undefined ? "hidden lg:flex" : "flex"} min-h-[60vh] flex-col rounded-2xl border border-slate-200 bg-white`}>
          {openWith === undefined ? (
            <p className="m-auto p-6 text-center text-xs font-semibold text-slate-400">
              اختر محادثة من القائمة.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-100 p-3">
                <button
                  onClick={() => setOpenWith(undefined)}
                  aria-label="رجوع إلى المحادثات"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 lg:hidden"
                >
                  <Icon name="back" className="h-4 w-4" />
                </button>
                <p className="flex-1 text-sm font-bold text-navy-900">
                  {active?.displayName ?? (openWith === null ? "الفريق كلّه" : "محادثة")}
                </p>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-xs font-semibold text-slate-400">
                    لا رسائل بعد — اكتب أوّل واحدة.
                  </p>
                ) : null}
                {messages.map((message, index) => {
                  const mine = message.senderId === meId;
                  const newDay = index === 0
                    || dayOf(messages[index - 1].createdAt) !== dayOf(message.createdAt);
                  return (
                    <div key={message.id}>
                      {newDay ? (
                        <p className="my-3 text-center text-[10px] font-bold text-slate-400">
                          {dayOf(message.createdAt)}
                        </p>
                      ) : null}
                      <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                          mine ? "bg-navy-900 text-white" : "border border-slate-200 bg-slate-50 text-navy-900"
                        }`}>
                          {/* اسمُ المرسِل في صندوق الفريق وحده: في محادثة اثنين هو معروف */}
                          {!mine && openWith === null ? (
                            <p className="mb-0.5 text-[10px] font-bold text-accent-600">{message.senderName}</p>
                          ) : null}
                          {message.kind === "voice" ? (
                            <span className="flex items-center gap-2">
                              <audio
                                controls
                                preload="none"
                                src={`/api/messages/voice/${message.id}`}
                                className="h-8 max-w-[200px]"
                              />
                              <span className={`text-[10px] font-bold ${mine ? "text-white/70" : "text-slate-500"}`}>
                                {formatVoiceDuration(message.voiceMs ?? 0)}
                              </span>
                            </span>
                          ) : (
                            <p className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed">
                              {message.body}
                            </p>
                          )}
                          <p className={`mt-0.5 text-[10px] font-semibold ${mine ? "text-white/60" : "text-slate-400"}`}>
                            {timeOf(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>

              <div className="flex items-end gap-2 border-t border-slate-100 p-3">
                <VoiceRecorder
                  disabled={sending}
                  onError={setError}
                  onRecorded={async (clip) => {
                    await send({
                      kind: "voice",
                      voiceMime: clip.mime,
                      voiceData: clip.base64,
                      voiceMs: clip.ms,
                    });
                  }}
                />
                <textarea
                  aria-label="نصّ الرسالة"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, MAX_TEXT_LENGTH))}
                  onKeyDown={(event) => {
                    // Enter يُرسل، وShift+Enter سطرٌ جديد — لأن أغلب الرسائل سطر.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendText();
                    }
                  }}
                  rows={1}
                  placeholder="اكتب رسالة…"
                  className="max-h-32 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-navy-700 focus:outline-none"
                />
                <button
                  onClick={() => void sendText()}
                  disabled={sending || !draft.trim()}
                  className="shrink-0 rounded-xl bg-navy-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  إرسال
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
