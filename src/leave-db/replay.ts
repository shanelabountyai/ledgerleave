/** The engine's verdict on a command (RequestEvent.outcome); the CHECK constraint mirrors this list. */
export const EVENT_OUTCOMES = ['APPLIED', 'VOID', 'IGNORED'] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];
