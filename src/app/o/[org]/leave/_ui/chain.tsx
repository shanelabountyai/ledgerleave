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

/** Minutes are the number; days are a reading aid next to it (480 minutes a work day, D-6). */
export function Minutes({ value }: { value: number }) {
  const sign = value < 0 ? '−' : '';
  const m = Math.abs(value);
  const days = (m - (m % 480)) / 480;
  const rest = m % 480;
  return (
    <span className="ll-num">
      {sign}{m} min <span className="ll-muted">({sign}{days} d{rest ? ` ${rest} min` : ''})</span>
    </span>
  );
}
