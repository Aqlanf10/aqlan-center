import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

// Public health metadata only: never authenticate or fetch patient information.
const base = new URL(process.env.CLINIC_URL ?? 'https://web-production-d8b67.up.railway.app');
assert.ok(!base.username && !base.password && !base.search && !base.hash, 'Use a plain clinic URL');
assert.ok(base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname), 'HTTPS required');
let healthy = false;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const [ping, health] = await Promise.all(['/api/ping', '/api/health'].map(async path => {
      const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
      assert.equal(response.status, 200, 'Health endpoint unavailable');
      return response.json();
    }));
    assert.equal(ping.ok, true, 'Application is unavailable');
    assert.equal(health.ready, true, 'Database or session configuration is unavailable');
    assert.equal(health['تخزين_الملفات'], 'جاهز', 'Document storage is unavailable');
    console.log('Clinic, database, and document storage are healthy.');
    healthy = true;
    break;
  } catch {
    // Do not log response bodies, URLs with credentials, or patient information.
    console.error(`Health check attempt ${attempt}/3 failed.`);
    if (attempt < 3) await setTimeout(5000);
  }
}
if (!healthy) process.exitCode = 1;
