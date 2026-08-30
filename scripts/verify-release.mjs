import "./load-env.mjs";
import assert from "node:assert/strict";
import { Client } from "pg";
import { pgConnection } from "../lib/pgConnection.ts";
import { createSessionToken, hashPassword } from "../lib/auth.ts";

const source = process.env.DATABASE_URL;
if (!source) throw new Error("DATABASE_URL required (test server with CREATE DATABASE permission)");
const temporary = `release_check_${Date.now()}`;
const target = new URL(source); target.pathname = `/${temporary}`;
const admin = new Client(pgConnection(source)); await admin.connect();
await admin.query(`CREATE DATABASE ${temporary}`);
process.env.DATABASE_URL = target.toString();
process.env.SESSION_SECRET = "test-only-secret-for-release-verification-2026";
const db = await import("../lib/db.ts");
const { validateSessionToken } = await import("../lib/sessionValidation.ts");
const { consumeLoginAttempt } = await import("../lib/loginLimit.ts");
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`✓ ${name}`); };
let closer;
try {
  await db.ensureSchema();
  const staff = await db.createFirstAdmin({ username: "admin", displayName: "Test", passwordHash: await hashPassword("test-password-123") });
  const mint = async () => {
    const user = await db.findUserByUsername("admin");
    return createSessionToken({ userId:user.id, username:user.username, role:user.role, sessionVersion:user.sessionVersion, expiresAt:Date.now()+3600000 });
  };
  let token = await mint();
  check("valid session accepted", !!await validateSessionToken(token));
  await db.updateUser(staff.id, { role: "doctor" });
  check("role change revokes old session", await validateSessionToken(token) === null);
  token = await mint();
  await db.updateUser(staff.id, { passwordHash: await hashPassword("changed-password-456") });
  check("password change revokes old session", await validateSessionToken(token) === null);
  token = await mint();
  await db.updateUser(staff.id, { isActive: false });
  check("disabled account loses session immediately", await validateSessionToken(token) === null);
  await db.updateUser(staff.id, { isActive: true });
  check("reactivation does not revive previous sessions", await validateSessionToken(token) === null);
  check("forged token rejected", await validateSessionToken("wrong.token") === null);
  const limits = await Promise.all(Array.from({ length: 25 }, () => consumeLoginAttempt("same-user", new Headers())));
  check("atomic account throttle permits exactly 10 of 25 attempts", limits.filter(x => x.allowed).length === 10);
  check("throttle includes retry interval", limits.filter(x => !x.allowed).every(x => x.retryAfter > 0));
  await db.getPool().query("UPDATE login_limits SET window_start = NOW() - INTERVAL '16 minutes'");
  check("throttle expires", (await consumeLoginAttempt("same-user", new Headers())).allowed);

  const person = name => db.createPatient({ fullName:name,phone:null,altPhone:null,gender:"male",birthYear:null,address:null,medicalAlert:null,note:null });
  const p1 = await person("Patient one"); const p2 = await person("Patient two");
  const visits = await Promise.all(Array.from({ length: 12 }, (_,i) => db.addVisit({patientName:`Visit ${i}`,patientPhone:null,note:null,patientId:p1.id})));
  const called = await Promise.all(visits.map(v => db.callVisit(v.id, 1)));
  check("one call wins a shared chair", called.filter(Boolean).length === 1);
  const winner = called.find(Boolean);
  const other = visits.find(v => v.id !== winner.id);
  check("cannot seat another patient on a reserved chair", await db.seatVisit(other.id, 1) === null);
  check("reserved patient can sit", !!await db.seatVisit(winner.id, 1));
  check("nonexistent chair rejected", await db.callVisit(other.id, 999) === null);
  await db.finishVisit(winner.id);
  check("finished chair can be reused", !!await db.callVisit(other.id, 1));
  const seated = await Promise.all(visits.filter(v => v.id !== winner.id && v.id !== other.id).map(v => db.seatVisit(v.id, 2)));
  check("one seat wins a shared chair", seated.filter(Boolean).length === 1);

  const shift = await db.openShift({openedBy:"test",opening:{YER:0,SAR:0,USD:0}});
  const invoice = await db.createInvoice({patientId:p1.id,baseCurrency:"YER",discountMinor:0,note:null,createdBy:"test",items:[{serviceId:null,doctorId:null,description:"Test",quantity:1,unitPriceMinor:1000}]});
  const payment = {patientId:p1.id,invoiceId:invoice.id,kind:"payment",amountMinor:100,currency:"YER",baseCurrency:"YER",exchangeRate:1,method:"cash",note:null,createdBy:"test"};
  check("invoice belonging to another patient rejected", (await db.recordPayment({...payment,patientId:p2.id})).reason === "invalid_invoice");
  check("matching invoice payment accepted", !!(await db.recordPayment(payment)).payment);
  await db.setInvoiceStatus(invoice.id, "cancelled");
  check("cancelled invoice payment rejected", (await db.recordPayment(payment)).reason === "invalid_invoice");
  closer = new Client(pgConnection(target.toString())); await closer.connect();
  await closer.query("BEGIN");
  await closer.query("UPDATE cashier_shifts SET status='closed',closed_at=NOW() WHERE id=$1", [shift.id]);
  const pending = Promise.all([
    db.recordPayment({...payment,invoiceId:null}),
    db.recordExpense({category:"other",partyId:null,payeeText:"Test",amountMinor:100,currency:"YER",baseCurrency:"YER",exchangeRate:1,payableId:null,note:null,createdBy:"test"}),
  ]);
  await new Promise(r => setTimeout(r, 150));
  await closer.query("COMMIT");
  const closedResults = await pending;
  check("payment and expense lose to closing shift", closedResults.every(x => x.reason === "no_shift"));
  check("closing did not add a late payment", (await db.listShiftPayments(shift.id)).length === 1);
  check("closing did not add a late expense", (await db.listShiftExpenses(shift.id)).length === 0);
  console.log(`${checks} release regression checks passed.`);
} finally {
  if (closer) { await closer.query("ROLLBACK").catch(() => {}); await closer.end(); }
  await db.getPool().end();
  await admin.query(`DROP DATABASE ${temporary} WITH (FORCE)`);
  await admin.end();
}
