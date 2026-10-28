import { describe, expect, it } from 'vitest';
import { gate, ownCredential } from '@/app/demo-gate';

const basic = (userPass: string) => `Basic ${Buffer.from(userPass).toString('base64')}`;
const env = { DEMO_ACCESS_PASSWORD: 'correct horse', VERCEL: '1' };

describe('the demo gate', () => {
  it('admits the right password under any username, and challenges everything else', () => {
    expect(gate(basic('anyone:correct horse'), env)).toBe('allowed');
    expect(gate(basic(':correct horse'), env)).toBe('allowed');
    for (const h of [null, '', 'Bearer x', basic('anyone:wrong'), basic('correct horse'), basic('anyone:correct horse '), 'Basic !!!'])
      expect(gate(h, env)).toBe('challenge');
  });

  it('fails closed on Vercel without a password, and is open only off Vercel', () => {
    expect(gate(basic('a:b'), { VERCEL: '1' })).toBe('misconfigured');
    expect(gate(null, {})).toBe('open');
  });

  it('leaves open only the cron, which answers to CRON_SECRET', () => {
    expect(ownCredential('/api/cron')).toBe(true);
    for (const p of ['/', '/demo', '/login', '/o/walk/leave', '/api/health', '/api/cron/x', '/api/webhooks/stripe']) expect(ownCredential(p)).toBe(false);
  });
});
