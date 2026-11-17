import { describe, expect, it } from 'vitest';
import { ownCredential } from '@/app/demo-gate';

// The paths this clone's proxy leaves to their own credential (moved from tests/unit/demo-gate.test.ts at v1.6.5;
// the gate's own tests are now the template's, in that file).
describe('ledgerleave: routes outside the demo password', () => {
  it('leaves open only the cron, which answers to CRON_SECRET', () => {
    expect(ownCredential('/api/cron')).toBe(true);
    for (const p of ['/', '/demo', '/login', '/o/walk/leave', '/api/health', '/api/cron/x', '/api/webhooks/stripe']) expect(ownCredential(p)).toBe(false);
  });
});
