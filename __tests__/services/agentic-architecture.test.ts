// ---------------------------------------------------------------------------
// Tests — Agentic Architecture (SuperAgent, ConversationMode, Enhanced Spawn)
// ---------------------------------------------------------------------------

import {
  BUILT_IN_PERSONAS,
  SUPER_AGENT_PERSONA,
  SUPER_AGENT_PERSONA_ID,
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

  it('has a substantial system prompt with all 7 phases', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT.length).toBeGreaterThan(500);
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 1');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 2');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 3');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 4');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 5');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 6');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Phase 7');
  });

  it('mentions sessions_spawn for sub-agent delegation', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_spawn');
  });

  it('mentions sessions_status for monitoring', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_status');
  });

  it('mentions sessions_wait when worker output is required to proceed', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_wait');
  });

  it('mentions sessions_output for final worker deliverables', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_output');
  });

  it('tells the supervisor not to re-fetch output immediately after sessions_wait', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Do not call sessions_output immediately afterward unless you need to recall a terminal deliverable later.',
    );
  });

  it('mentions sessions_surface_output for direct worker-deliverable surfacing', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_surface_output');
  });

  it('requires dependency-aware worker sequencing', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('workstreamId');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('dependsOnWorkstreams');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Never launch dependent workflows in the same turn',
    );
  });

  it('reserves direct handling for trivial tasks only', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Trivial tasks');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('handle DIRECTLY');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Simple tasks');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('handle them directly');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('execute directly first');
  });

  it('limits max simultaneous sub-agents to 5', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('5 sub-agents');
  });

  it('caps orchestration re-plan cycles at 3', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('3 full orchestration');
  });

  it('requires current-time awareness for freshness-sensitive work', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('current time injected by the app runtime');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('freshness-sensitive');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('verify up-to-date facts with tools');
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
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain("pass a focused 'tools' array in sessions_spawn");
  });

  it('treats numbered workstreams as stable ids', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('item 1 is workstream-1');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Prefer referencing dependencies by workstream id');
  });

  it('provides concrete tool examples for different sub-agent roles', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('web_search');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('ssh_exec');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('read_file');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('file_edit');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('workspace_list_files');
  });

  it('warns about consequences of not passing tools', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('only gets generic tools');
  });
});
