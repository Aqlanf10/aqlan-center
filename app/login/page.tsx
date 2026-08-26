"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message ?? "تعذّر تسجيل الدخول.");
        return;
      }
      // إعادة تحميل كاملة لا تنقّل داخل التطبيق: الكوكي وُضعت للتو، والتحميل الكامل
      // يضمن أن الحارس يراها من أول طلب.
      window.location.href = "/";
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-extrabold">انسياب العيادة</h1>
        <p className="mt-1 text-xs text-slate-500">مركز الدكتور عقلان الكامل</p>

        <label className="mt-5 block text-xs font-bold" htmlFor="username">اسم المستخدم</label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
        />

        <label className="mt-3 block text-xs font-bold" htmlFor="password">كلمة المرور</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
        />

        {error ? (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="mt-5 w-full rounded-xl bg-navy-800 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "جارٍ الدخول…" : "دخول"}
        </button>
      </form>
    </main>
  );
}
