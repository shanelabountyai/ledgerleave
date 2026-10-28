/**
 * D-47 (owner decision 2026-10-26): archive, keep Restrict. An org whose append-only history exists is never
 * deleted — the five append-only tables' triggers already refuse the cascaded DELETE — so it is ARCHIVED instead:
 * one `OrgArchive` row, itself append-only (archiving is one-way). An archived org takes no new writes: every
 * clone write path calls `assertWritable` (the replay, which every derived write goes through; the live actions; the
 * HR link; the settings write; the fixture import). The template's delete-org is refused up front by
 * `refuseOrgDelete`, called from the clone-owned `beforeOrgDelete` hook, with a message the person can act on.
 * Nothing here — or anywhere in this repo — disables a trigger (tests/integration/leave/archive.test.ts greps for it).
 */
import { audit } from '@/core/audit';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { ActionRefused } from './errors';

type Tx = Prisma.TransactionClient;

/** The append-only tables whose rows make an org's history (D-47). AuditEvent is not here: it has no FK and outlives any org. */
export const HISTORY_TABLES = ['LedgerEntry', 'RequestCommand', 'RequestEvent', 'FrozenChain', 'RequestStep'] as const;

export const ARCHIVED_MESSAGE = 'This org is archived and read-only: its leave history is kept, and nothing new can be written.';

export async function isArchived(orgId: string, tx: Pick<Tx, 'orgArchive'> = db): Promise<boolean> {
  return (await tx.orgArchive.findUnique({ where: { orgId }, select: { orgId: true } })) !== null;
}

/** Throws the user-facing refusal when the org is archived. Call it inside the write's transaction. */
export async function assertWritable(tx: Pick<Tx, 'orgArchive'>, orgId: string): Promise<void> {
  if (await isArchived(orgId, tx)) throw new ActionRefused(ARCHIVED_MESSAGE);
}

/** Does the org own any row of an append-only table? One `EXISTS` per table, stopping at the first. */
export async function hasHistory(orgId: string, tx: Pick<Tx, '$queryRawUnsafe'> = db): Promise<boolean> {
  for (const t of HISTORY_TABLES) {
    const r = await tx.$queryRawUnsafe<{ e: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM "${t}" WHERE "orgId" = $1::uuid) AS e`, orgId);
    if (r[0]?.e) return true;
  }
  return false;
}

export interface ArchiveInput {
  readonly orgId: string;
  readonly userId: string;
  readonly reason: string;
}

/** Archive the org (one-way). Audited as `org.archived` in the same transaction. */
export async function archiveOrg(input: ArchiveInput): Promise<void> {
  const reason = input.reason.trim();
  if (reason === '') throw new ActionRefused('Say why the org is being archived.');
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Org" WHERE id = ${input.orgId}::uuid FOR UPDATE`;
    if (await isArchived(input.orgId, tx)) throw new ActionRefused('This org is already archived.');
    await tx.orgArchive.create({ data: { orgId: input.orgId, archivedBy: input.userId, reason } });
    await audit({ orgId: input.orgId, userId: input.userId }, 'org.archived', { targetType: 'org', targetId: input.orgId, data: { reason } }, tx);
  });
}

/**
 * The delete-org pre-check (D-47), run by `beforeOrgDelete` before the template deletes anything. An org with history
 * or an archive row is refused with a message that names the alternative; an empty org may still be deleted.
 */
export async function refuseOrgDelete(orgId: string): Promise<void> {
  if (await isArchived(orgId)) throw new ActionRefused('This org is archived. Its leave history is append-only and is kept: an archived org is never deleted.');
  if (await hasHistory(orgId)) {
    throw new ActionRefused('This org has leave history (ledger entries and request events), which is append-only and is never deleted. Archive the org instead: Leave → HR → Archive org.');
  }
}
