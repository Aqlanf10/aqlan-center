import { createHmac } from "node:crypto";
import { ensureSchema, getPool } from "./db";

/** Shared across instances and restarts. Account limits cannot be bypassed by IP rotation. */
export async function consumeLoginAttempt(username: string, headers: Headers): Promise<{ allowed: boolean; retryAfter: number }> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is missing");
  const hash = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  const limits = [{ key: hash(`account:${username.toLowerCase()}`), maximum: 10 }];
  // Only enable behind a proxy that overwrites/appends the actual source address.
  if (process.env.TRUST_PROXY === "true") {
    const address = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (address) limits.push({ key: hash(`source:${address}`), maximum: 60 });
  }
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let allowed = true;
    let retryAfter = 1;
    for (const limit of limits.sort((a, b) => a.key.localeCompare(b.key))) {
      const { rows } = await client.query<{ attempts: number; retry: number }>(
        `INSERT INTO login_limits (key) VALUES ($1)
         ON CONFLICT (key) DO UPDATE SET
           attempts = CASE WHEN login_limits.window_start <= NOW() - INTERVAL '15 minutes'
             THEN 1 ELSE LEAST(login_limits.attempts + 1, $2 + 1) END,
           window_start = CASE WHEN login_limits.window_start <= NOW() - INTERVAL '15 minutes'
             THEN NOW() ELSE login_limits.window_start END
         RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_start + INTERVAL '15 minutes' - NOW())))::int AS retry`,
        [limit.key, limit.maximum],
      );
      if (rows[0].attempts > limit.maximum) {
        allowed = false;
        retryAfter = Math.max(retryAfter, rows[0].retry);
      }
    }
    await client.query("DELETE FROM login_limits WHERE window_start < NOW() - INTERVAL '1 day'");
    await client.query("COMMIT");
    return { allowed, retryAfter };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
