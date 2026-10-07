export interface Projection {
  pct: number;
  /** Consecutive classes that can still be missed while staying at or above the threshold. */
  canMiss: number;
  /** Consecutive classes that must be attended to reach the threshold (0 when already compliant). */
  mustAttend: number;
}

/**
 * Shortage projection for one subject.
 *   compliant:  max k such that a / (h + k) ≥ t          → k = floor(a / t − h)
 *   short:      min n such that (a + n) / (h + n) ≥ t    → n = ceil((t·h − a) / (1 − t))
 */
export function projectAttendance(attended: number, held: number, thresholdPct: number): Projection {
  const t = thresholdPct / 100;
  if (held <= 0) return { pct: 100, canMiss: 0, mustAttend: 0 };
  const pct = (attended / held) * 100;
  if (attended / held >= t) {
    return { pct, canMiss: Math.max(0, Math.floor(attended / t - held + 1e-9)), mustAttend: 0 };
  }
  return { pct, canMiss: 0, mustAttend: Math.ceil((t * held - attended) / (1 - t) - 1e-9) };
}
