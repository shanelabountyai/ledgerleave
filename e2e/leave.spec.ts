// Phase 3 task 3.7: the brief §9 GR-15 walk in a browser, the overlap denial (D-45) and the archive (D-47), with axe
// in light and dark on every leave page (e2e/axe.ts). Q1/Q2 are SUBMITTED as history on 2025-05-05 through the live
// library (D-49), so the org changes of 05-06/05-07 land after the frozen chain; everything after that is clicked in
// the browser on the server's real today (D-43), so log lines carry today's date and the golden's verdicts.
import { type Browser, type Page, expect, test } from '@playwright/test';
import { WALK_ACTORS as ACTORS, WALK_OWNER as OWNER, seedDemoWalk } from '../scripts/leave/seed-hand-org';
import { db } from '../src/core/db';
import { expectAccessible } from './axe';

const SLUG = `leave-e2e-${process.pid}-${Date.now() % 1_000_000}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => seedDemoWalk(SLUG));
test.afterAll(() => db.$disconnect());

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/demo');
  await page.getByRole('button', { name: email, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your orgs' })).toBeVisible();
  return page;
}
const leave = (path = '') => `/o/${SLUG}/leave${path}`;
const status = (page: Page) => page.getByRole('status');

test('H3 sees both requests in the inbox and approves Q2’s manager step', async ({ browser }) => {
  const page = await signIn(browser, ACTORS.H3);
  await page.goto(leave('/inbox'));
  await expect(page).toHaveURL(new RegExp(`${leave('/inbox')}$`));
  await expect(page.getByRole('heading', { level: 3, name: /R-0001/ })).toBeVisible();
  await expectAccessible(page, 'Requests waiting on Hilde (manager) (H3): 2');
  await page.getByRole('button', { name: 'Approve R-0002' }).click();
  await expect(status(page)).toContainText(/R-0002: PENDING_2 — APPROVE:H3:\d{4}-\d{2}-\d{2}:MANAGER/);
});

test('H2 approves Q2’s skip-level step; as H4’s NEW manager H2’s approval of Q1 is VOID, shown with its code', async ({ browser }) => {
  const page = await signIn(browser, ACTORS.H2);
  await page.goto(leave('/inbox'));
  await page.getByRole('button', { name: 'Approve R-0002' }).click();
  await expect(status(page)).toContainText('R-0002: PENDING_3');
  await page.goto(leave('/inbox'));
  await expect(page.getByText('Requests waiting on Hugo (VP) (H2): 0')).toBeVisible(); // the frozen chain never routed Q1 to H2
  await page.getByRole('link', { name: 'R-0001' }).click(); // listed under "your reports", not under "waiting on you"

  await expect(page).toHaveURL(new RegExp(`${leave('/requests/R-0001')}$`));
  await expectAccessible(page, 'MANAGER:H3[MANAGER_OF_REQUESTER]');
  await page.getByRole('button', { name: 'Approve R-0001' }).click();
  await expect(status(page)).toContainText(/R-0001: VOID — VOID_APPROVE:H2:\d{4}-\d{2}-\d{2}:APPROVER_NOT_STEP_APPROVER/);
});

test('H7 lost HR on 05-06: the approval of Q2’s HR step is VOID APPROVER_INELIGIBLE_ROLE_REVOKED', async ({ browser }) => {
  const page = await signIn(browser, ACTORS.H7);
  await page.goto(leave('/inbox'));
  await page.getByRole('button', { name: 'Approve R-0002' }).click();
  await expect(status(page)).toContainText(/R-0002: VOID — VOID_APPROVE:H7:\d{4}-\d{2}-\d{2}:APPROVER_INELIGIBLE_ROLE_REVOKED/);
});

test('H8 (HR) reassigns the step to H8 in the HR console, then approves: Q2 APPROVED', async ({ browser }) => {
  const page = await signIn(browser, ACTORS.H8);
  await page.goto(leave('/hr'));
  await expect(page).toHaveURL(new RegExp(`${leave('/hr')}$`));
  await expectAccessible(page, 'Employee-year table');
  await page.getByLabel('Reassign the current step of R-0002 to').selectOption({ label: 'H8 Heidi (HR generalist)' });
  await page.getByRole('button', { name: 'Reassign R-0002' }).click();
  await expect(status(page)).toContainText(/REASSIGN:H8:\d{4}-\d{2}-\d{2}:STEP_REASSIGNED->H8/);
  await page.goto(leave('/inbox'));
  await page.getByRole('button', { name: 'Approve R-0002' }).click();
  await expect(status(page)).toContainText(/R-0002: APPROVED — APPROVE:H8:\d{4}-\d{2}-\d{2}:HR/);
});

test('H3 approves Q1 (the frozen approver): APPROVED', async ({ browser }) => {
  const page = await signIn(browser, ACTORS.H3);
  await page.goto(leave('/inbox'));
  await page.getByRole('button', { name: 'Approve R-0001' }).click();
  await expect(status(page)).toContainText('R-0001: APPROVED');
});

test('H4: both approved with their chains; a request over approved days previews and is DENIED OVERLAPPING_REQUEST', async ({ browser }) => {
  const page = await signIn(browser, ACTORS.H4);
  await page.goto(leave());
  await expect(page).toHaveURL(new RegExp(`${leave()}$`));
  await expectAccessible(page, 'Balances as of');
  await expect(page.getByText('(routed to H7, reassigned)')).toBeVisible(); // the step now names H8; the frozen routing is kept beside it
  await page.getByLabel('Leave type').selectOption('SICK');
  await page.getByLabel('First day').fill('2025-05-20');
  await page.getByLabel('Last day').fill('2025-05-20');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('would be DENIED OVERLAPPING_REQUEST');
  await expectAccessible(page, 'overlaps your open request R-0001');
  await page.getByRole('button', { name: 'Submit SICK 2025-05-20..2025-05-20' }).click();
  await expect(status(page)).toContainText(/R-0003: DENIED \(OVERLAPPING_REQUEST\)/);
  await page.getByRole('link', { name: 'My ledger' }).click();
  await expectAccessible(page, 'Ledger: Hal (IC) (H4)');
});

test('a shared demo owner cannot archive the org (D-58): refused, nothing archived', async ({ browser }) => {
  const page = await signIn(browser, OWNER);
  await page.goto(leave('/hr'));
  await page.getByLabel('Reason').fill('end of the e2e walk');
  await page.getByRole('button', { name: 'Archive org' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('This is a shared demo account');
  await page.goto(leave());
  await expect(page.getByRole('note')).toHaveCount(0); // no read-only banner
  await expectAccessible(page, 'My leave');
});
