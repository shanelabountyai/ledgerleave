// The ONE accessibility helper every leave spec calls (Bookable A-096: a check that only runs one way is the default
// shape of the assertion). It scans the page in LIGHT and in DARK, prints the URL it measured, and refuses to scan a
// page that does not show the content the caller expects (a green run over the login page looks like a green run).
// axe-core comes from node_modules, where eslint-plugin-jsx-a11y already installs it (D-48: no new dependency).
import { createRequire } from 'node:module';
import { type Page, expect } from '@playwright/test';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

type Violation = { id: string; impact: string; nodes: { target: string[]; failureSummary: string }[] };

export async function expectAccessible(page: Page, mustShow: RegExp | string): Promise<void> {
  await expect(page.getByRole('main')).toContainText(mustShow);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: (o: object) => Promise<{ violations: Violation[] }> } }).axe.run({ resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, failureSummary: n.failureSummary })) }));
    });
    expect(violations, `axe (${colorScheme}) on ${page.url()}:\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
