# Design brief: Ledgerleave screens

Status: **draft for Shane's review, nothing applied yet.** Scope: one stylesheet (`src/app/o/[org]/leave/leave.css`, loaded by the leave layout) over the existing semantic HTML. No new dependency, no component library. Template-owned pages stay untouched (they inherit the root tokens only).

Goal: the app and the exec brief read as one thing, and a non-HR reader can read a balance without doing arithmetic.

## Today

One 33-line sheet: system-ui, grey cards, colour-only state words, balances shown as `2400 min (5 d)` (`Minutes` in `_ui/chain.tsx`). Both schemes are real and axe runs on each (A-096); that stays the gate.

## Tokens (light / dark)

Every pair must pass axe contrast in both schemes, and the existing `--ll-*` names stay so no markup changes.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ll-bg` | #fbfaf7 | #101414 | page |
| `--ll-card` | #ffffff | #181e1e | cards, table header band |
| `--ll-fg` | #1b1f1f | #e9eeee | text |
| `--ll-muted` | #4a5353 | #b4bfbf | secondary text |
| `--ll-line` | #8a9494 | #5f6b6b | borders (≥3:1 for form controls) |
| `--ll-accent` | #0b6b66 (teal) | #6fd0c8 | links, focus ring, primary button |
| accrual | #1e6b2f / tint #e6f2e8 | #8fd19e / #1c2e20 | ACCRUAL chip, positive numbers |
| usage | #0b57d0 / tint #e6eefb | #8ab4f8 / #1a2436 | USAGE chip |
| forfeit | #7a4b00 / tint #f8eedb | #f2c46d / #33280f | FORFEITURE chip, PENDING |
| void | #a3141c / tint #fbe7e8 | #ff9b9b / #361a1c | DENIED, VOID, CANCELLED |

## Type and spacing

- Body: Hanken Grotesk 16/1.55 (self-hosted via `next/font`, falls back to system-ui). Headings: Newsreader, `h1` 1.75rem, `h2` 1.25rem, `h3` 1rem; card headings stay 1rem.
- 4px spacing base: 4, 8, 12, 16, 24, 40. Page max width stays 72rem; 16px gutter.
- Numbers: `font-variant-numeric: tabular-nums`, right-aligned in table cells (`.ll-n`); code stays monospace and wraps.

## Components

- **Tables:** header row on `--ll-card` with a 2px bottom rule, 8px/12px cell padding, row hairlines only, `.ll-scroll` wrapper kept. Net-zero rows are not shaded; negative numbers get the void colour and a minus sign (never colour alone).
- **Status pills** (`.ll-state`): rounded 999px, tint background plus text, always the word. PENDING_* forfeit pair, APPROVED accrual pair, DENIED / VOID / CANCELLED void pair.
- **Ledger-kind chips:** ACCRUAL accrual pair, USAGE usage pair, USAGE_REVERSAL usage outline, FORFEITURE forfeit pair, ADJUSTMENT and TRANSFER neutral.
- **Forms:** labels above controls, 36px min height, 2px accent focus ring (3:1 against both backgrounds), primary button filled accent, others outlined; `p[role=alert]` and `p[role=status]` get an icon-free left rule in the void and accrual colours.
- **Scope banner** (`.ll-banner`): wording verbatim, set in a left-ruled box with a "Synthetic data" label; stays on every leave page.
- **Chain** (`.ll-chain`): current step bold with an accent marker; dropped steps muted and struck through.

## Minutes to days (display only)

- One formatter, `formatDays(minutes, workDayMinutes)` beside `Minutes`: `minutes / work_day_minutes`, **2 decimals, trailing zeros trimmed, half-up**, unit "day" at exactly 1, else "days" (`1.25 days`, `0.5 days`, `0 days`).
- Shown as the main number with the exact minutes as a muted second line only where a reader needs to reconcile (ledger entry rows, HR table). Elsewhere days only.
- `work_day_minutes` comes from policy data (480 today); an hourly employee's odd minutes round-trip through the formatter in a unit test.
- Engines, ledger rows, `leave:eval`, CSVs and `docs/EVAL.md` stay integer minutes (non-negotiable 4). D-60 records the rule.

## Open questions

1. Unit wording at 0.5: "0.5 days" or "0.5 day"? Proposal: plural for everything except exactly 1.
2. Fonts: self-host Newsreader + Hanken Grotesk (adds two font files, no npm package beyond `next/font`) or keep system fonts? Proposal: self-host, matches the brief.

## Verification

`npm test` (formatter unit test, any text assertions on minutes updated), `npm run test:e2e -- --workers=1` (axe light + dark on every leave page), then push `main` and look at production with Shane.
