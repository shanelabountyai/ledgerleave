import { formatDays } from './days';
import type { StepView } from '@/leave-db/read';

/** The frozen chain, step by step: `STEP:approver[codes]`, dropped steps struck through, the current one marked. */
export function Chain({ steps }: { steps: readonly StepView[] }) {
  if (steps.length === 0) return <span className="ll-muted">no chain</span>;
  return (
    <ol className="ll-chain">
      {steps.map((s) => {
        const text = `${s.stepId}:${s.approver || '(nobody)'}[${s.codes.join(',')}]`;
        return (
          <li key={s.index} className={s.current ? 'll-current' : undefined}>
            {s.kept ? <code>{text}</code> : <del><code>{text}</code></del>}
            {!s.kept && <span className="ll-muted"> dropped</span>}
            {s.approver !== s.routedApprover && <span className="ll-muted"> (routed to {s.routedApprover}, reassigned)</span>}
            {s.requiresHr && s.kept && <span className="ll-muted"> · must hold HR when acting</span>}
            {s.current && <strong> ← current step</strong>}
          </li>
        );
      })}
    </ol>
  );
}

/** Days are what a reader sees (D-60); `exact` adds the integer minutes underneath where a reader reconciles against the ledger. */
export function Days({ value, exact }: { value: number; exact?: boolean }) {
  return (
    <span className="ll-num">
      {formatDays(value)}
      {exact && <span className="ll-muted ll-exact"> {value} min</span>}
    </span>
  );
}
