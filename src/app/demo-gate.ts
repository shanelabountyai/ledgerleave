// The demo gate itself lives in core since saas-foundation v1.6.5 (src/core/demo-gate.ts, read through @/core/env, K11).
// This file keeps only what is this clone's: the paths that carry their own credential.
export { gate, type Gate } from '@/core/demo-gate';

/** Paths that carry their own credential, so the password never stands between a caller and the route. */
export const ownCredential = (path: string) => path === '/api/cron'; // CRON_SECRET
