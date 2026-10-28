import Link from 'next/link';
import { ActionForm } from '@/core/ui/action-form';
import type { RequestView } from '@/leave-db/read';
import { Chain, Days } from './chain';

type Bound = (form: FormData) => Promise<unknown>;

/** One request: dates, size, state and final code, the frozen chain, the event log (void lines included), actions. */
export function RequestCard({ r, actions, href, level = 3 }: { r: RequestView; actions?: { label: string; action: Bound }[]; href?: string; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <article className="ll-card" aria-labelledby={`req-${r.requestId}`}>
      <H id={`req-${r.requestId}`}>
        {href ? <Link href={href}>{r.requestId}</Link> : r.requestId} · {r.employeeName} ({r.employeeId}) · {r.leaveType} {r.start}..{r.end}
      </H>
      <p>
        <span className={`ll-state ll-${r.state.startsWith('PENDING') ? 'pending' : r.state.toLowerCase()}`}>{r.state}</span>
        {r.finalCode && r.finalCode !== r.state && <> <code>{r.finalCode}</code></>} · {r.workingDays} working day{r.workingDays === 1 ? '' : 's'} · <Days value={-r.minutes} /> · submitted {r.submittedOn}
      </p>
      <Chain steps={r.steps} />
      <details>
        <summary>Event log ({r.log.length} line{r.log.length === 1 ? '' : 's'})</summary>
        <ul className="ll-log">
          {r.log.map((l, i) => (
            <li key={i}>{l.startsWith('VOID_') ? <strong className="ll-void">{l}</strong> : <code>{l}</code>}</li>
          ))}
        </ul>
      </details>
      {actions?.map((a) => (
        <ActionForm key={a.label} action={a.action}>
          <input type="hidden" name="request" value={r.id} />
          <button type="submit">{a.label} {r.requestId}</button>
        </ActionForm>
      ))}
    </article>
  );
}
