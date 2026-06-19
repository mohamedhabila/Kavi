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

  it('keeps the default persona direct for normal Q&A', () => {
    const assistant = BUILT_IN_PERSONAS.find((persona) => persona.id === 'default');
    expect(assistant?.systemPrompt).toContain('For normal Q&A');
    expect(assistant?.systemPrompt).toContain('Reserve files and canvases');
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
    expect(superAgent?.systemPrompt).toContain('Use python as a capability bridge only when first-class tools are insufficient');
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
  it('returns user prompt for default persona', () => {
    const persona = getPersona('default')!;
    expect(resolvePersonaSystemPrompt(persona, 'Custom prompt')).toBe('Custom prompt');
  });

  it('returns user prompt for undefined persona', () => {
    expect(resolvePersonaSystemPrompt(undefined, 'Custom prompt')).toBe('Custom prompt');
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
