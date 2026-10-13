// ---------------------------------------------------------------------------
// Tests — Sub-agent Production Hardening
// ---------------------------------------------------------------------------
// Covers: systemPrompt validation, name sanitization, spawn schema hardening,
// spawn error mapping.

// ── systemPrompt trimming in sub-agent ──────────────────────────────────

describe('systemPrompt validation logic', () => {
  it('empty string trims to falsy and uses fallback', () => {
    const rawSystemPrompt = '   '?.trim();
    const systemPrompt = rawSystemPrompt ? rawSystemPrompt.slice(0, 50_000) : 'default-fallback';
    expect(systemPrompt).toBe('default-fallback');
  });

  it('valid string is preserved after trim', () => {
    const rawSystemPrompt = '  You are a specialist.  '?.trim();
    const systemPrompt = rawSystemPrompt ? rawSystemPrompt.slice(0, 50_000) : 'default-fallback';
    expect(systemPrompt).toBe('You are a specialist.');
  });

  it('long string is capped at 50K chars', () => {
    const longPrompt = 'x'.repeat(60_000);
    const rawSystemPrompt = longPrompt?.trim();
    const systemPrompt = rawSystemPrompt ? rawSystemPrompt.slice(0, 50_000) : 'default-fallback';
    expect(systemPrompt.length).toBe(50_000);
  });

  it('undefined systemPrompt uses fallback', () => {
    const rawSystemPrompt = (undefined as string | undefined)?.trim();
    const systemPrompt = rawSystemPrompt ? rawSystemPrompt.slice(0, 50_000) : 'default-fallback';
    expect(systemPrompt).toBe('default-fallback');
  });
});

// ── Name sanitization ────────────────────────────────────────────────────

describe('sub-agent name sanitization', () => {
  function sanitizeName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    return (
      name
        .slice(0, 256)
        .replace(/[\x00-\x1f\x7f]/g, '_')
        .trim() || undefined
    );
  }

  it('preserves normal names', () => {
    expect(sanitizeName('Backend Architect')).toBe('Backend Architect');
  });

  it('strips control characters', () => {
    expect(sanitizeName('Agent\x00\x1b[0m')).toBe('Agent__[0m');
  });

  it('truncates long names to 256 chars', () => {
    const longName = 'A'.repeat(500);
    expect(sanitizeName(longName)!.length).toBe(256);
  });

  it('returns undefined for empty string', () => {
    expect(sanitizeName('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string after trim', () => {
    expect(sanitizeName('   ')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(sanitizeName(undefined)).toBeUndefined();
  });

  it('handles newlines and tabs', () => {
    expect(sanitizeName('My\nAgent\tName')).toBe('My_Agent_Name');
  });
});

// ── Spawn schema validation ─────────────────────────────────────────────

import { SESSION_SPAWN_TOOL } from '../../src/engine/tools/builtin-definitions';

describe('SESSION_SPAWN_TOOL schema hardening', () => {
  const schema = SESSION_SPAWN_TOOL.input_schema;

  it('name has maxLength of 256', () => {
    expect(schema.properties.name.maxLength).toBe(256);
  });

  it('omits worker-config tuning knobs from the model-facing schema', () => {
    expect(schema.properties.systemPrompt).toBeUndefined();
    expect(schema.properties.inheritMemory).toBeUndefined();
    expect(schema.properties.sandboxPolicy).toBeUndefined();
    expect(schema.properties.announce).toBeUndefined();
    expect(schema.properties.waitTimeoutMs).toBeUndefined();
  });
});

// ── Spawn error mapping ─────────────────────────────────────────────────

describe('spawn error message mapping', () => {
  function mapSpawnError(err: unknown): string {
    if (err instanceof Error && err.message.includes('MAX_SPAWN_DEPTH')) {
      return 'Max sub-agent nesting depth exceeded. Consider breaking the task into parallel agents instead.';
    } else if (err instanceof TypeError) {
      return `Configuration error: ${err.message}. Check that a provider is properly configured.`;
    }
    return err instanceof Error ? err.message : String(err);
  }

  it('maps MAX_SPAWN_DEPTH errors to user-friendly message', () => {
    const err = new Error('MAX_SPAWN_DEPTH exceeded');
    expect(mapSpawnError(err)).toContain('nesting depth exceeded');
  });

  it('maps TypeError to configuration error', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'model')");
    expect(mapSpawnError(err)).toContain('Configuration error');
  });

  it('passes through unknown errors as-is', () => {
    const err = new Error('Some random error');
    expect(mapSpawnError(err)).toBe('Some random error');
  });

  it('handles non-Error values', () => {
    expect(mapSpawnError('string error')).toBe('string error');
  });
});
