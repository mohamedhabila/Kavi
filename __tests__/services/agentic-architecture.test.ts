// ---------------------------------------------------------------------------
// Tests — Agentic Architecture (SuperAgent, ConversationMode, Enhanced Spawn)
// ---------------------------------------------------------------------------

import {
  BUILT_IN_PERSONAS,
  SUPER_AGENT_PERSONA,
  SUPER_AGENT_SYSTEM_PROMPT,
  getPersona,
  resolvePersonaSystemPrompt,
  resolvePersonaModel,
  type ConversationMode,
} from '../../src/services/agents/personas';

// ── SuperAgent Persona ───────────────────────────────────────────────────

describe('SUPER_AGENT_PERSONA', () => {
  it('is included in BUILT_IN_PERSONAS', () => {
    const ids = BUILT_IN_PERSONAS.map((p) => p.id);
    expect(ids).toContain('super-agent');
  });

  it('has the correct id, name, and icon', () => {
    expect(SUPER_AGENT_PERSONA.id).toBe('super-agent');
    expect(SUPER_AGENT_PERSONA.name).toBe('SuperAgent');
    expect(SUPER_AGENT_PERSONA.icon).toBe('🧠');
  });

  it('has thinkingLevel set to medium', () => {
    expect(SUPER_AGENT_PERSONA.thinkingLevel).toBe('medium');
  });

  it('has a compact system prompt with the core graph contracts', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT.length).toBeGreaterThan(500);
    expect(SUPER_AGENT_SYSTEM_PROMPT.length).toBeLessThan(3000);
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('## Agent Contract');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('do not emit a formal workstream plan before the first tool call');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('start acting and keep any short pre-tool explanation concise');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('Workstreams:');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain(['Phase', '1'].join(' '));
  });

  it('mentions sessions_spawn for sub-agent delegation', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_spawn');
  });

  it('does not mention sessions_status in the default monitoring path', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('sessions_status');
  });

  it('mentions sessions_wait when worker output is required to proceed', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_wait');
  });

  it('mentions sessions_output for final worker deliverables', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_output');
  });

  it('tells the supervisor not to re-fetch output immediately after sessions_wait', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'sessions_output or sessions_history only when you need to recall a finished result or inspect a transcript later',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('sessions_surface_output');
  });

  it('requires dependency-aware worker sequencing', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('workstreamId');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('self-contained');
  });

  it('reserves direct handling for trivial tasks only', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Trivial Q&A and one-shot lookups');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('answer directly');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('highest-leverage tool that directly fits the next work unit');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('launch the worker directly instead of preflighting with supervisor tools');
  });

  it('keeps delegation deliberate and gap-driven', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('delegate only for named gaps');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('workers only when they materially improve completion');
  });

  it('discourages repeated unchanged calls', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Do not repeat unchanged discovery, status, list, or search calls');
  });

  it('requires current-time awareness for freshness-sensitive work', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('runtime time context');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('freshness matters');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('verify with tools');
  });
});

describe('BUILT_IN_PERSONAS count', () => {
  it('has 6 built-in personas (including super-agent)', () => {
    expect(BUILT_IN_PERSONAS).toHaveLength(6);
  });

  it('includes super-agent, default, coder, researcher, writer, planner', () => {
    const ids = BUILT_IN_PERSONAS.map((p) => p.id);
    expect(ids).toContain('super-agent');
    expect(ids).toContain('default');
    expect(ids).toContain('coder');
    expect(ids).toContain('researcher');
    expect(ids).toContain('writer');
    expect(ids).toContain('planner');
  });
});

describe('getPersona with super-agent', () => {
  it('resolves super-agent persona by id', () => {
    const persona = getPersona('super-agent');
    expect(persona).toBeDefined();
    expect(persona?.name).toBe('SuperAgent');
  });
});

describe('resolvePersonaSystemPrompt with super-agent', () => {
  it('uses super-agent prompt and appends user instructions', () => {
    const persona = getPersona('super-agent')!;
    const result = resolvePersonaSystemPrompt(persona, 'Focus on backend tasks');
    expect(result).toContain('SuperAgent');
    expect(result).toContain('Focus on backend tasks');
  });

  it('uses super-agent prompt alone when user prompt is empty', () => {
    const persona = getPersona('super-agent')!;
    const result = resolvePersonaSystemPrompt(persona, '');
    expect(result).toBe(persona.systemPrompt);
  });
});

describe('resolvePersonaModel with super-agent', () => {
  it('uses default provider/model since super-agent has no overrides', () => {
    const result = resolvePersonaModel(SUPER_AGENT_PERSONA, 'p1', 'm1');
    expect(result.providerId).toBe('p1');
    expect(result.model).toBe('m1');
  });
});

// ── ConversationMode type ────────────────────────────────────────────────

describe('ConversationMode type', () => {
  it('accepts agentic and chitchat as valid modes', () => {
    const agentic: ConversationMode = 'agentic';
    const chitchat: ConversationMode = 'chitchat';
    expect(agentic).toBe('agentic');
    expect(chitchat).toBe('chitchat');
  });
});

// ── Sub-agent tool passing guidance ──────────────────────────────────────

describe('SuperAgent prompt — sub-agent tool guidance', () => {
  it('instructs to pass a focused tools array in sessions_spawn', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('When using sessions_spawn');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain("omit tools unless you need to narrow the worker's scope");
  });

  it('keeps workstream binding optional without forcing a formal plan', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('workstreamId');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('Treat numbered workstreams as stable ids');
  });

  it('keeps tool discovery and capability bridging narrow', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Use python as a capability bridge only when first-class tools are insufficient');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Use tool_catalog only when the exposed tool surface is insufficient for the next step',
    );
  });

  it('keeps worker/session output semantics visible', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'sessions_output or sessions_history only when you need to recall a finished result or inspect a transcript later',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_wait when blocked on worker output');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('sessions_surface_output');
  });
});
