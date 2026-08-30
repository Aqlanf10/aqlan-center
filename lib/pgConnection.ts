/** Verify remote database certificates. Private/local plaintext must be intentional. */
export function pgConnection(value: string): { connectionString: string; ssl: false | { rejectUnauthorized: true; ca?: string } } {
  const url = new URL(value);
  const mode = process.env.PG_SSL_MODE ?? url.searchParams.get("sslmode");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const privateRailway = url.hostname.endsWith(".railway.internal");
  // Prevent pg-connection-string from silently replacing our verification options.
  for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
  if (mode === "disable" || (!mode && (local || privateRailway))) {
    return { connectionString: url.toString(), ssl: false };
  }
  return { connectionString: url.toString(), ssl: {
    rejectUnauthorized: true, ...(process.env.PG_SSL_CA ? { ca: process.env.PG_SSL_CA } : {}),
  } };
}
