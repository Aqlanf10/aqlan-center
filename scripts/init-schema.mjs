import "./load-env.mjs";
import { ensureSchema, getPool } from "../lib/db.ts";
try { await ensureSchema(); } finally { await getPool().end(); }
