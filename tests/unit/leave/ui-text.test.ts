// The two sentences the pages must carry verbatim: the README's scope-honesty paragraph and D-26's sick-policy label.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCOPE_BANNER, SICK_POLICY_LABEL } from '@/app/o/[org]/leave/_ui/banner';

const root = new URL('../../../', import.meta.url);

describe('scope honesty on screen', () => {
  it('the banner is the README paragraph word for word', () => {
    const readme = readFileSync(new URL('README.md', root), 'utf8');
    const para = readme.split('## ⚠️ Scope Honesty (read first)')[1]!.trim().split('\n')[0];
    expect(SCOPE_BANNER).toBe(para);
  });
  it('the sick-policy label is the D-26 sentence word for word', () => {
    const decisions = readFileSync(new URL('docs/decisions.md', root), 'utf8');
    expect(decisions).toContain(`"${SICK_POLICY_LABEL}"`);
  });
});
