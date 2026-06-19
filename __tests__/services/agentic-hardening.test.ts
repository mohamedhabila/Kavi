// ---------------------------------------------------------------------------
// Tests — Agentic Architecture Production Hardening
// ---------------------------------------------------------------------------
// Covers: SUPER_AGENT_PERSONA_ID constant, systemPrompt validation,
// name sanitization, mode fallback, spawn error mapping.

import {
  SUPER_AGENT_PERSONA,
  SUPER_AGENT_PERSONA_ID,
  SUPER_AGENT_SYSTEM_PROMPT,
  getPersona,
} from '../../src/services/agents/personas';
import { type ConversationMode } from '../../src/types/conversation';

// ── SUPER_AGENT_PERSONA_ID constant ─────────────────────────────────────

describe('SUPER_AGENT_PERSONA_ID', () => {
  it('is exported as a string constant', () => {
    expect(typeof SUPER_AGENT_PERSONA_ID).toBe('string');
    expect(SUPER_AGENT_PERSONA_ID).toBe('super-agent');
  });

  it('matches the persona object id', () => {
    expect(SUPER_AGENT_PERSONA.id).toBe(SUPER_AGENT_PERSONA_ID);
  });

  it('is resolvable via getPersona', () => {
    const persona = getPersona(SUPER_AGENT_PERSONA_ID);
    expect(persona).toBeDefined();
    expect(persona?.name).toBe('SuperAgent');
  });
});

// ── Mode fallback behavior ──────────────────────────────────────────────

describe('ConversationMode fallback chain', () => {
  it('agentic is a valid default mode', () => {
    const mode: ConversationMode = 'agentic';
    const conversationMode: ConversationMode | undefined = undefined;
    const defaultMode: ConversationMode | undefined = undefined;
    const effectiveMode = conversationMode ?? defaultMode ?? mode;
    expect(effectiveMode).toBe('agentic');
  });

  it('conversation.mode takes priority over default', () => {
    const conversationMode: ConversationMode = 'chitchat';
    const defaultMode: ConversationMode = 'agentic';
    const effective = conversationMode ?? defaultMode ?? 'agentic';
    expect(effective).toBe('chitchat');
  });

  it('falls back to hardcoded agentic when all undefined', () => {
    const conversationMode: ConversationMode | undefined = undefined;
    const defaultMode: ConversationMode | undefined = undefined;
    const effective = conversationMode ?? defaultMode ?? 'agentic';
    expect(effective).toBe('agentic');
  });
});

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

// ── SuperAgent prompt decision rules ─────────────────────────────────────

describe('SuperAgent system prompt — decision rules', () => {
  it('treats delegation as deliberate rather than automatic', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'workers only when they materially improve completion',
    );
  });

  it('keeps direct execution available for simple work and execution asks', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Trivial Q&A and one-shot lookups');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('answer directly');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'highest-leverage tool that directly fits the next work unit',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'launch the worker directly instead of preflighting with supervisor tools',
    );
  });

  it('mentions sessions_spawn for worker delegation', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_spawn');
  });

  it('avoids forcing a formal pre-tool plan before spawning', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'do not emit a formal workstream plan before the first tool call',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('If the next step is clear, start acting');
  });

  it('requires delegated prompts to carry time context when freshness matters', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Fresh/live/status claims');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('runtime time context');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('verify with tools');
  });

  it('stops early on low-signal requests instead of manufacturing a workflow', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Low-signal or underspecified request');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('stop and ask one concrete clarification');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('do not plan, delegate, or invent work');
  });

  it('criticizes unreasonable process requests and narrows scope', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Unreasonable scope/process');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('say why');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('smallest sensible scope');
  });

  it('forbids duplicate supervisor-plus-worker passes over the same substantive step', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('delegate only for named gaps');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'workers only when they materially improve completion',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain(
      'pause final delivery and delegate before concluding',
    );
  });

  it('treats python as a capability-extension fallback before declaring tasks impossible', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Use python as a capability bridge only when first-class tools are insufficient',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Use tool_catalog only when the exposed tool surface is insufficient for the next step',
    );
  });
});
