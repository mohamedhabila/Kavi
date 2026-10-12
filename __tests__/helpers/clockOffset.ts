/**
 * Moves the wall clock by `offsetMs` and lets it keep running (unlike fake timers, which
 * freeze it and would stall every timeout and latency measurement), until the returned
 * function restores the real clock. `new Date()` and `Date.now()` see the shifted time;
 * dates built from explicit values are unchanged.
 */
export function installClockOffset(offsetMs: number): () => void {
  if (!Number.isFinite(offsetMs)) throw new Error('Clock offset must be a finite number.');
  const RealDate = globalThis.Date;

  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      // Forwarded as given; the cast only satisfies the overloaded constructor's typing.
      super(...((args.length > 0 ? args : [RealDate.now() + offsetMs]) as [number]));
    }

    static override now(): number {
      return RealDate.now() + offsetMs;
    }
  }

  globalThis.Date = ShiftedDate as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}
