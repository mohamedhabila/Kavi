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

  it('requires the SuperAgent to emit a parseable semantic plan before tool calls', () => {
    const superAgent = BUILT_IN_PERSONAS.find((persona) => persona.id === 'super-agent');

    expect(superAgent?.systemPrompt).toContain('Objective: one concise sentence');
    expect(superAgent?.systemPrompt).toContain('Success Criteria:');
    expect(superAgent?.systemPrompt).toContain('Stop Conditions:');
    expect(superAgent?.systemPrompt).toContain('Workstreams:');
    expect(superAgent?.systemPrompt).toContain('Goal: ... | Success: ... | Depends on: ...');
    expect(superAgent?.systemPrompt).toContain('workstream-1');
  });

  it('requires the SuperAgent to cite provider research claims and avoid unsupported comparisons', () => {
    const superAgent = BUILT_IN_PERSONAS.find((persona) => persona.id === 'super-agent');

    expect(superAgent?.systemPrompt).toContain(
      'prefer official documentation over secondary summaries',
    );
    expect(superAgent?.systemPrompt).toContain(
      'attribute provider-specific claims to the supporting source names or URLs',
    );
    expect(superAgent?.systemPrompt).toContain(
      'unsupported quantitative, pricing, latency, or superlative claims',
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
