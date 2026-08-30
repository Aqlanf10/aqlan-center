import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, readSessionToken } from "../lib/auth";
import { pgConnection } from "../lib/pgConnection";

afterEach(() => vi.unstubAllEnvs());
describe("signed sessions", () => {
  it("rejects expired and tampered tokens and sessions from before versioning", () => {
    vi.stubEnv("SESSION_SECRET", "test-only-secret-at-least-thirty-two-characters");
    const payload = {userId:1,username:"test",role:"admin",sessionVersion:1,expiresAt:Date.now()+10000};
    const valid=createSessionToken(payload);
    expect(readSessionToken(valid)?.userId).toBe(1);
    expect(readSessionToken(valid+'.extra')).toBeNull();
    expect(readSessionToken(valid.slice(0,-3)+'bad')).toBeNull();
    expect(readSessionToken(createSessionToken({...payload,expiresAt:Date.now()-1}))).toBeNull();
    expect(readSessionToken(createSessionToken({...payload,sessionVersion:0}))).toBeNull();
  });
});
describe("database TLS", () => {
  it("verifies remote certificates even when sslmode=require is in the URL", () => {
    vi.stubEnv("PG_SSL_MODE", ""); vi.stubEnv("PG_SSL_CA", "");
    const options=pgConnection("postgresql://user:pass@database.example/test?sslmode=require");
    expect(options.ssl).toEqual({rejectUnauthorized:true});
    expect(options.connectionString).not.toContain("sslmode");
  });
  it("permits explicitly disabled local TLS", () => {
    vi.stubEnv("PG_SSL_MODE", "disable");
    expect(pgConnection("postgresql://user@127.0.0.1/test").ssl).toBe(false);
  });
});
