import { describe, expect, it } from 'vitest';
import { formatDays } from '@/app/o/[org]/leave/_ui/days';

describe('formatDays (D-60)', () => {
  it.each([
    [0, '0 days'], [480, '1 day'], [960, '2 days'], [600, '1.25 days'], [240, '0.5 days'], [-480, '−1 day'],
    [-600, '−1.25 days'], [1, '0 days'], [2, '0 days'], [3, '0.01 days'], [5, '0.01 days'],
    [159, '0.33 days'], [3600, '7.5 days'],
  ])('%i minutes -> %s', (m, s) => expect(formatDays(m)).toBe(s));
  it('hourly employee odd minutes, 7h45 on a 450-minute day', () => {
    expect(formatDays(465, 450)).toBe('1.03 days');
    expect(formatDays(450, 450)).toBe('1 day');
  });
  it('a negative that rounds to zero shows no minus sign', () => expect(formatDays(-1)).toBe('0 days'));
});
