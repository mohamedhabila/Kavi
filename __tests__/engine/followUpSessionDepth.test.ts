import {
  resolveChildSessionDepth,
  resolveFollowUpSessionDepth,
} from '../../src/engine/tools/builtin-session-config';
import { MAX_SPAWN_DEPTH } from '../../src/services/agents/mobileSpawnPolicy';

// Traced live on an Android emulator. `sessions_send` continues an existing worker, but it
// reused the child-depth rule and counted every follow-up as one level deeper. With
// MAX_SPAWN_DEPTH at 2 a worker got exactly one follow-up before the ceiling refused it,
// and the refusal blamed spawn depth for a call that spawns nothing:
//   sessions_spawn -> depth 1
//   sessions_send  -> depth 2   (ran)
//   sessions_send  -> depth 3   -> "Max spawn depth 2 exceeded"
// The supervisor was only asking the same worker to finish writing its report.

describe('a follow-up stays at the depth the session already runs at', () => {
  it('does not move when continuing a session', () => {
    expect(resolveFollowUpSessionDepth({ depth: 1 }, undefined)).toBe(1);
    expect(resolveFollowUpSessionDepth({ depth: 2 }, undefined)).toBe(2);
  });

  it('falls back to the stored config depth', () => {
    expect(resolveFollowUpSessionDepth(undefined, { config: { depth: 1 } })).toBe(1);
  });

  it('prefers the live snapshot over the stored config', () => {
    expect(resolveFollowUpSessionDepth({ depth: 2 }, { config: { depth: 1 } })).toBe(2);
  });

  it('reports nothing when the session has no depth to inherit', () => {
    expect(resolveFollowUpSessionDepth(undefined, undefined)).toBeUndefined();
    expect(resolveFollowUpSessionDepth({ depth: 'deep' }, undefined)).toBeUndefined();
  });

  it('never reaches the ceiling by repetition alone', () => {
    // The traced failure: the third call in a chain that never nested.
    let depth = resolveChildSessionDepth({ depth: 0 }, undefined) ?? 0;
    for (let followUp = 0; followUp < 10; followUp += 1) {
      depth = resolveFollowUpSessionDepth({ depth }, undefined) ?? depth;
      expect(depth).toBeLessThan(MAX_SPAWN_DEPTH);
    }
  });
});

describe('spawning a worker still costs a level', () => {
  it('increments, because a child genuinely is one further from the user', () => {
    expect(resolveChildSessionDepth({ depth: 0 }, undefined)).toBe(1);
    expect(resolveChildSessionDepth({ depth: 1 }, undefined)).toBe(2);
  });

  it('still stops a worker that spawns its own worker', () => {
    // A real nesting chain reaches the ceiling exactly as before.
    const child = resolveChildSessionDepth({ depth: 0 }, undefined) ?? 0;
    const grandchild = resolveChildSessionDepth({ depth: child }, undefined) ?? 0;
    expect(grandchild).toBeGreaterThanOrEqual(MAX_SPAWN_DEPTH);
  });

  it('falls back to the stored config depth', () => {
    expect(resolveChildSessionDepth(undefined, { config: { depth: 1 } })).toBe(2);
    expect(resolveChildSessionDepth(undefined, undefined)).toBeUndefined();
  });
});
