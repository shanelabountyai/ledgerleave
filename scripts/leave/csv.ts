// A small RFC 4180 reader and a writer that mirrors Python's csv.DictWriter with QUOTE_MINIMAL and "\n" line
// endings — the exact bytes tools/reference_leave.py writes, so leave:eval can diff byte for byte (D-24).
// Own code: no CSV dependency (CLAUDE.md ask-before-add).

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r, idx) => {
      if (r.length !== header.length) throw new Error(`csv row ${idx + 2} has ${r.length} fields, header has ${header.length}`);
      const o: Record<string, string> = {};
      header.forEach((h, k) => (o[h] = r[k]!));
      return o;
    });
}

/** Python csv QUOTE_MINIMAL: quote only when the field holds the delimiter, a quote or a line break; double quotes. */
export function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function writeCsv(columns: readonly string[], rows: readonly Record<string, string | number>[]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvField(r[c] ?? '')).join(','));
  return lines.join('\n') + '\n';
}

/** First differing line of two texts, 1-based, with both lines; null when equal. */
export function firstDiff(expected: string, actual: string): { line: number; expected: string | undefined; actual: string | undefined } | null {
  if (expected === actual) return null;
  const a = expected.split('\n');
  const b = actual.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { line: i + 1, expected: a[i], actual: b[i] };
  return { line: n, expected: undefined, actual: undefined };
}

/** Number of lines that differ between two texts (position-wise), plus the length difference. */
export function countDiffLines(expected: string, actual: string): number {
  const a = expected.split('\n');
  const b = actual.split('\n');
  let diffs = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}
