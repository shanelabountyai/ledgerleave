import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { balancesFor, leaveTypesOn, previewSubmit, requestViews } from '@/leave-db/read';
import { NO_EMPLOYEE_MESSAGE, employeeForUser } from '@/leave-db/people';
import { todayFor } from '@/leave-db/today';
import { calendarDay } from '@/accrual/calendar';
import { cancelLeave, submitLeave } from './actions';
import { Minutes } from './_ui/chain';
import { RequestCard } from './_ui/requests';

export const metadata = { title: 'My leave' };
export const dynamic = 'force-dynamic';

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function MyLeave({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrg((await params).org);
  const q = await searchParams;
  const me = await employeeForUser(ctx.orgId, ctx.userId);
  if (!me) {
    return (
      <main>
        <h1>My leave</h1>
        <p role="status">{NO_EMPLOYEE_MESSAGE}</p>
      </main>
    );
  }
  const today = await todayFor(ctx.orgId);
  const [balances, mine, types] = await Promise.all([balancesFor(ctx.orgId, me.employeeId, today), requestViews(ctx.orgId, { employeeId: me.employeeId }), leaveTypesOn(ctx.orgId, me.employeeId, today)]);
  const wantPreview = isDay(q.start) && isDay(q.end) && typeof q.leaveType === 'string' && types.includes(q.leaveType);
  let preview: Awaited<ReturnType<typeof previewSubmit>> | null = null;
  let previewError: string | null = null;
  if (wantPreview) {
    if (q.end! < q.start!) previewError = 'The end date is before the start date.';
    else {
      try {
        calendarDay(q.start!);
        calendarDay(q.end!);
        preview = await previewSubmit(ctx.orgId, { employeeId: me.employeeId, leaveType: q.leaveType!, start: q.start!, end: q.end!, on: today });
      } catch (e) {
        previewError = (e as Error).message;
      }
    }
  }
  const submit = submitLeave.bind(null, ctx.slug);
  const cancel = cancelLeave.bind(null, ctx.slug);
  return (
    <main>
      <h1>My leave</h1>
      <h2>Balances as of {today}</h2>
      <div className="ll-scroll">
        <table>
          <thead>
            <tr><th scope="col">Leave type</th><th scope="col" className="ll-n">Balance (L1, effective on or before {today})</th><th scope="col" className="ll-n">Available (L2, every posted entry)</th></tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.leaveType}><th scope="row">{b.leaveType}</th><td className="ll-n"><Minutes value={b.balance} /></td><td className="ll-n"><Minutes value={b.available} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {balances.length === 0 && <p>No ledger entries yet: the first action replays the ledger up to today.</p>}
      <p className="ll-muted">Both numbers are sums over the ledger on every page load; nothing is stored. <Link href={`/o/${ctx.slug}/leave/ledger/${me.employeeId}`}>See every entry</Link>.</p>

      <h2>Request leave</h2>
      <form method="get">
        <label>Leave type <select name="leaveType" defaultValue={q.leaveType ?? types[0]}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>First day <input type="date" name="start" defaultValue={q.start ?? today} required /></label>
        <label>Last day <input type="date" name="end" defaultValue={q.end ?? today} required /></label>
        <button type="submit">Preview</button>
      </form>
      {previewError && <p role="alert">{previewError}</p>}
      {preview && (
        <section aria-label="Preview" className="ll-card">
          <h3>What submitting would do today ({preview.on})</h3>
          <p>{preview.leaveType} {preview.start}..{preview.end} under {preview.policyId}: <strong>{preview.workingDays.length}</strong> working day{preview.workingDays.length === 1 ? '' : 's'} = <Minutes value={preview.minutes} /> ({preview.workingDays.join(', ') || 'none'})</p>
          <p>Chain it would freeze: <code>{preview.chain}</code></p>
          <p>Available now: <Minutes value={preview.available} />{preview.allowNegative ? ' (this policy allows a negative balance)' : ''}</p>
          <p>
            Verdict: <strong>{preview.verdict === 'PENDING' ? 'would go to step 1 for approval' : `would be DENIED ${preview.verdict}`}</strong>
            {preview.overlapsWith && <> — overlaps your open request <strong>{preview.overlapsWith}</strong> (D-45)</>}
          </p>
          <ActionForm action={submit}>
            <input type="hidden" name="leaveType" value={preview.leaveType} />
            <input type="hidden" name="start" value={preview.start} />
            <input type="hidden" name="end" value={preview.end} />
            <button type="submit">Submit {preview.leaveType} {preview.start}..{preview.end}</button>
          </ActionForm>
        </section>
      )}

      <h2>My requests ({mine.length})</h2>
      {mine.map((r) => <RequestCard key={r.id} r={r} href={`/o/${ctx.slug}/leave/requests/${r.requestId}`} actions={r.open || r.state === 'APPROVED' ? [{ label: 'Cancel', action: cancel }] : []} />)}
    </main>
  );
}
