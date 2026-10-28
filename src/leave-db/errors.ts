import { Refused } from '@/core/errors';

/**
 * A leave action the rules refuse, with a message safe to show the person who tried it. It IS the foundation's
 * `Refused`, so `orgAction` turns it into the form's `{ error }` with no per-action mapping (Phase 3, D-42).
 */
export class ActionRefused extends Refused {
  constructor(message: string) {
    super(message);
    this.name = 'ActionRefused';
  }
}
