/**
 * @fileoverview Centralised clock — returns the current date/time, honouring
 * an optional in-process override for testing and demos (date spoofing).
 *
 * Priority (highest to lowest):
 *   1. In-memory override set via setSpoofDate()  — survives hot-reloads
 *   2. SPOOF_DATE env var                         — set at process startup
 *   3. Real system clock                          — default
 *
 * @module shared/clock
 */

let _override: Date | null = null;

/**
 * Set (or clear) the in-process spoof date.
 * Pass `null` to revert to real system time.
 */
export function setSpoofDate(d: Date | null): void {
  _override = d;
}

/** Returns the active spoof date, or null if not set. */
export function getSpoofDate(): Date | null {
  if (_override) return new Date(_override.getTime());
  const env = process.env.SPOOF_DATE;
  if (env) {
    const d = new Date(env);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Returns current date/time, respecting any active spoof. */
export function now(): Date {
  return getSpoofDate() ?? new Date();
}

/** Returns current timestamp in ms, respecting any active spoof. */
export function nowMs(): number {
  return now().getTime();
}

/** Returns current timestamp as ISO-8601 string, respecting any active spoof. */
export function nowIso(): string {
  return now().toISOString();
}
