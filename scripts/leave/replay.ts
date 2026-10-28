// leave:replay — Phase 2 task 2.4 CLI: run the engines over an org's input tables and store the derived rows the
// tables lack (src/leave-db/replay.ts). Idempotent: a second run reports 0 inserted. Refuses, writing nothing, when
// the stored rows are not a prefix of the engine's answer.
//
//   npm run leave:replay -- [--org <slug>] [--asof YYYY-MM-DD] [--open]     # default: the org's fixtureAsOf, day closed
import { pathToFileURL } from 'node:url';
import { calendarDay } from '../../src/accrual/calendar';
import { db } from '../../src/core/db';
import { REPLAY_TX, type ReplayResult, lockOrg, replay } from '../../src/leave-db/replay';

export async function replayOrg(slug: string, asOf?: string, openAsOfDay = false): Promise<ReplayResult> {
  const org = await db.org.findUnique({ where: { slug } });
  if (!org) throw new Error(`org ${slug} not found`);
  const settings = await db.leaveSettings.findUnique({ where: { orgId: org.id } });
  const day = asOf ?? settings?.fixtureAsOf ?? undefined;
  if (!day) throw new Error(`org ${slug}: pass --asof (no fixtureAsOf in LeaveSettings)`);
  return db.$transaction(async (tx) => {
    await lockOrg(tx, org.id);
    return replay(tx, org.id, calendarDay(day), { openAsOfDay });
  }, REPLAY_TX);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : undefined;
  };
  const r = await replayOrg(flag('--org') ?? 'ledgerleave-fixture', flag('--asof'), args.includes('--open'));
  console.log(`leave:replay — org ${r.orgId} as of ${r.asOf}${r.openAsOfDay ? ' (day open)' : ''}; engine: ${r.engine.entries} entries, ${r.engine.requests} requests, ${r.engine.voided} void, ${r.engine.ignored} ignored, ${r.engine.recomputed} recomputed`);
  for (const [t, c] of Object.entries({ LedgerEntry: r.ledger, FrozenChain: r.chains, RequestStep: r.steps, RequestEvent: r.events })) console.log(`  ${t}: ${c.existing} existing, ${c.inserted} inserted`);
  console.log(`  Outbox: ${r.outboxQueued} queued`);
  console.log(`  ledger hash ${r.ledgerHash}`);
  console.log(`leave:replay OK: ${r.ledger.inserted + r.chains.inserted + r.steps.inserted + r.events.inserted} row(s) inserted`);
  await db.$disconnect();
}
