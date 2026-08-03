// ---------------------------------------------------------------------------
// Tests — Personas
// ---------------------------------------------------------------------------

import {
  getPersona,
  BUILT_IN_PERSONAS,
  resolvePersonaSystemPrompt,
  resolvePersonaModel,
} from '../../src/services/agents/personas';

describe('BUILT_IN_PERSONAS', () => {
  it('has 6 built-in personas', () => {
    expect(BUILT_IN_PERSONAS).toHaveLength(6);
  });

  it('each persona has required fields', () => {
    for (const p of BUILT_IN_PERSONAS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.systemPrompt).toBeTruthy();
    }
  });

  it('includes default, coder, researcher, writer, planner', () => {
    const ids = BUILT_IN_PERSONAS.map((p) => p.id);
    expect(ids).toContain('default');
    expect(ids).toContain('coder');
    expect(ids).toContain('researcher');
    expect(ids).toContain('writer');
    expect(ids).toContain('planner');
  });

  it('guides coder persona toward session-first canvas workflows', () => {
    const coder = BUILT_IN_PERSONAS.find((persona) => persona.id === 'coder');
    expect(coder?.systemPrompt).toContain('file_edit');
    expect(coder?.systemPrompt).toContain('canvas_list');
    expect(coder?.systemPrompt).toContain('canvas_read');
    expect(coder?.systemPrompt).toContain('contentEdits');
    expect(coder?.systemPrompt).toContain('componentOperations');
    expect(coder?.systemPrompt).toContain('session-local');
    expect(coder?.systemPrompt).toContain('persisted files');
  });

  it('leads the default persona with everyday mobile work, not files or code', () => {
    const assistant = BUILT_IN_PERSONAS.find((persona) => persona.id === 'default');
    expect(assistant?.systemPrompt).toContain('Everyday work is your primary job');
    expect(assistant?.systemPrompt).toContain('calendar');
    expect(assistant?.systemPrompt).toContain('Reserve files and canvases');
    // Completion honesty has to survive prompt edits: it is the guard against
    // reporting an action as done without a result that shows it.
    expect(assistant?.systemPrompt).toContain('Never claim an action succeeded');
  });

  it('limits researcher and writer canvases to explicitly relevant cases', () => {
    const researcher = BUILT_IN_PERSONAS.find((persona) => persona.id === 'researcher');
    const writer = BUILT_IN_PERSONAS.find((persona) => persona.id === 'writer');
    expect(researcher?.systemPrompt).toContain('Do not create files or canvases');
    expect(writer?.systemPrompt).toContain('only create a canvas when the user explicitly wants');
  });

  it('keeps the SuperAgent action-oriented instead of requiring a formal pre-tool plan', () => {
    const superAgent = BUILT_IN_PERSONAS.find((persona) => persona.id === 'super-agent');

    expect(superAgent?.systemPrompt).not.toContain('running in Kavi');
    expect(superAgent?.systemPrompt).toContain(
      'do not emit a formal workstream plan before the first tool call unless the user explicitly asks for one',
    );
    expect(superAgent?.systemPrompt).toContain(
      'If the next step is clear, start acting and keep any short pre-tool explanation concise.',
    );
    expect(superAgent?.systemPrompt).not.toContain('Workstreams:');
    expect(superAgent?.systemPrompt).not.toContain('Stop Conditions:');
  });

  it('requires the SuperAgent to cite provider research claims and avoid unsupported comparisons', () => {
    const superAgent = BUILT_IN_PERSONAS.find((persona) => persona.id === 'super-agent');

    expect(superAgent?.systemPrompt).toContain('For live information and provider comparisons');
    expect(superAgent?.systemPrompt).toContain('cite source names/URLs');
    expect(superAgent?.systemPrompt).toContain('qualify unsupported metrics or superlatives');
  });

  it('keeps ordinary repo worker tool bundles narrow by default', () => {
    const superAgent = BUILT_IN_PERSONAS.find((persona) => persona.id === 'super-agent');

    expect(superAgent?.systemPrompt).toContain(
      "omit tools unless you need to narrow the worker's scope",
    );
    expect(superAgent?.systemPrompt).toContain(
      'Use python as a capability bridge only when first-class tools are insufficient',
    );
    expect(superAgent?.systemPrompt).toContain(
      'Use tool_catalog only when the exposed tool surface is insufficient for the next step',
    );
  });
});

describe('getPersona', () => {
  it('returns persona by id', () => {
    expect(getPersona('coder')?.name).toBe('Coder');
  });

  it('returns undefined for unknown id', () => {
    expect(getPersona('nonexistent')).toBeUndefined();
  });
});

describe('resolvePersonaSystemPrompt', () => {
  it('keeps the default persona prompt as the base and appends user customization', () => {
    const persona = getPersona('default')!;
    const result = resolvePersonaSystemPrompt(persona, 'Custom prompt');
    // Regression guard: this used to discard the persona entirely, which made
    // editing the Assistant persona in the agent roster a silent no-op.
    expect(result).toContain(persona.systemPrompt);
    expect(result).toContain('Custom prompt');
  });

  it('falls back to the default persona prompt when no persona resolves', () => {
    const defaultPersona = getPersona('default')!;
    const result = resolvePersonaSystemPrompt(undefined, 'Custom prompt');
    expect(result).toContain(defaultPersona.systemPrompt);
    expect(result).toContain('Custom prompt');
  });

  it('drops empty customization instead of leaving a trailing separator', () => {
    const persona = getPersona('default')!;
    expect(resolvePersonaSystemPrompt(persona, '   ')).toBe(persona.systemPrompt);
  });

  it('never emits two competing identity statements', () => {
    for (const persona of BUILT_IN_PERSONAS) {
      const resolved = resolvePersonaSystemPrompt(persona, 'You are a helpful assistant.');
      expect(resolved.match(/\bYou are\b/g)?.length ?? 0).toBeLessThanOrEqual(2);
    }
    // The shipped default is empty, so a stock install carries exactly one identity.
    for (const persona of BUILT_IN_PERSONAS) {
      const resolved = resolvePersonaSystemPrompt(persona, '');
      expect(resolved.match(/\bYou are\b/g)?.length ?? 0).toBe(1);
    }
  });

  it('prepends persona prompt for non-default', () => {
    const persona = getPersona('coder')!;
    const result = resolvePersonaSystemPrompt(persona, 'Additional instructions');
    expect(result).toContain(persona.systemPrompt);
    expect(result).toContain('Additional instructions');
  });

  it('uses only persona prompt when user prompt is empty', () => {
    const persona = getPersona('researcher')!;
    const result = resolvePersonaSystemPrompt(persona, '');
    expect(result).toBe(persona.systemPrompt);
  });
});

describe('resolvePersonaModel', () => {
  it('returns defaults when persona has no overrides', () => {
    const persona = getPersona('default')!;
    const result = resolvePersonaModel(persona, 'provider-1', 'gpt-5.4');
    expect(result.providerId).toBe('provider-1');
    expect(result.model).toBe('gpt-5.4');
  });

  it('returns defaults for undefined persona', () => {
    const result = resolvePersonaModel(undefined, 'p1', 'm1');
    expect(result).toEqual({ providerId: 'p1', model: 'm1' });
  });

  it('overrides with persona-specific model', () => {
    const persona = { ...getPersona('coder')!, model: 'custom-model', providerId: 'custom-p' };
    const result = resolvePersonaModel(persona, 'default-p', 'default-m');
    expect(result.model).toBe('custom-model');
    expect(result.providerId).toBe('custom-p');
  });
});
