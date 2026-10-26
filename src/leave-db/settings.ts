/** D-43: the org's IANA zone is written here only — validated, refused on an archived org (D-47), audited. */
import { audit } from '@/core/audit';
import { db } from '@/core/db';
import { assertWritable } from './archive';
import { ActionRefused } from './errors';
import { isTimeZone } from './today';

export async function setOrgTimeZone(input: { orgId: string; timeZone: string; actorUserId: string }): Promise<void> {
  const zone = input.timeZone.trim();
  if (!isTimeZone(zone)) throw new ActionRefused(`"${zone}" is not a time zone this server knows. Use an IANA name such as America/Chicago.`);
  await db.$transaction(async (tx) => {
    await assertWritable(tx, input.orgId);
    const s = await tx.leaveSettings.findUnique({ where: { orgId: input.orgId } });
    if (!s) throw new ActionRefused('This org has no leave setup yet, so there is no calendar to set a time zone for.');
    if (s.timeZone === zone) return;
    await tx.leaveSettings.update({ where: { orgId: input.orgId }, data: { timeZone: zone } });
    await audit({ orgId: input.orgId, userId: input.actorUserId }, 'leave.time_zone_set', { targetType: 'org', targetId: input.orgId, data: { from: s.timeZone, to: zone } }, tx);
  });
}
