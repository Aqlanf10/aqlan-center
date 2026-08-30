import { readSessionToken, type SessionPayload } from "./auth";
import { ensureSchema, getPool } from "./db";

/** Fail closed. Every request uses current account state; no process-local cache. */
export async function validateSessionToken(token: string | undefined): Promise<SessionPayload | null> {
  const payload = readSessionToken(token);
  if (!payload) return null;
  await ensureSchema();
  const { rows } = await getPool().query<{ username: string; role: string }>(
    `SELECT username, role FROM users
      WHERE id = $1 AND is_active AND session_version = $2`,
    [payload.userId, payload.sessionVersion],
  );
  return rows[0] ? { ...payload, username: rows[0].username, role: rows[0].role } : null;
}
