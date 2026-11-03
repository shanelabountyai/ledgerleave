// D-61: the template's /onboarding and /demo org lists go through the clone's filterListedOrgs, which hides archived orgs (D-47).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { db } from '@/core/db';
import { archiveOrg } from '@/leave-db/archive';
import { resetAuthTables, signInAs } from '../../helpers/auth';

vi.hoisted(() => {
  process.env.DEMO_MODE = '1'; // env.ts parses process.env at import; /demo 404s without it
});

const { default: Onboarding } = await import('@/app/onboarding/page');
const { default: Demo } = await import('@/app/(public)/demo/page');
const html = async (page: () => Promise<ReactElement>) => renderToStaticMarkup(await page());

beforeEach(async () => {
  await resetAuthTables();
  const live = await db.org.create({ data: { slug: 'live-co', name: 'Live Co' } });
  const gone = await db.org.create({ data: { slug: 'archived-co', name: 'Archived Co' } });
  const ada = await db.user.create({ data: { email: 'ada@example.test', isDemo: true } });
  await db.membership.createMany({
    data: [
      { orgId: live.id, userId: ada.id, role: 'owner' },
      { orgId: gone.id, userId: ada.id, role: 'member' },
    ],
  });
  await archiveOrg({ orgId: gone.id, userId: ada.id, reason: 'closed the company' });
  await signInAs(ada.id, { mfa: true });
});

describe('archived orgs are not listed (D-61)', () => {
  it('/onboarding lists the live org and not the archived one', async () => {
    const page = await html(Onboarding);
    expect(page).toContain('href="/o/live-co"');
    expect(page).not.toContain('archived-co');
  });

  it('/demo lists the live org and not the archived one', async () => {
    const page = await html(Demo);
    expect(page).toContain('Live Co');
    expect(page).not.toContain('Archived Co');
  });
});
