// ---------------------------------------------------------------------------
// Tests — Enhanced sessions_spawn Tool Schema
// ---------------------------------------------------------------------------

import { SESSION_SPAWN_TOOL } from '../../src/engine/tools/parity-definitions';

describe('SESSION_SPAWN_TOOL schema', () => {
  const schema = SESSION_SPAWN_TOOL.input_schema;

  it('has prompt as the only required field', () => {
    expect(schema.required).toEqual(['prompt']);
  });

  it('includes systemPrompt property', () => {
    expect(schema.properties.systemPrompt).toBeDefined();
    expect(schema.properties.systemPrompt.type).toBe('string');
    expect(schema.properties.systemPrompt.description).toContain('system prompt');
  });

  it('includes dependency-aware workstream fields', () => {
    expect(schema.properties.workstreamId).toBeDefined();
    expect(schema.properties.workstreamId.type).toBe('string');
    expect(schema.properties.dependsOnWorkstreams).toBeDefined();
    expect(schema.properties.dependsOnWorkstreams.type).toBe('array');
    expect(schema.properties.dependsOnWorkstreams.items.type).toBe('string');
  });

  it('includes name property', () => {
    expect(schema.properties.name).toBeDefined();
    expect(schema.properties.name.type).toBe('string');
    expect(schema.properties.name.description).toContain('name');
  });

  it('includes tools property as array of strings', () => {
    expect(schema.properties.tools).toBeDefined();
    expect(schema.properties.tools.type).toBe('array');
    expect(schema.properties.tools.items.type).toBe('string');
  });

  it('retains original properties', () => {
    expect(schema.properties.prompt).toBeDefined();
    expect(schema.properties.model).toBeDefined();
    expect(schema.properties.inheritMemory).toBeDefined();
    expect(schema.properties.sandboxPolicy).toBeDefined();
    expect(schema.properties.announce).toBeDefined();
    expect(schema.properties.waitForCompletion).toBeDefined();
    expect(schema.properties.waitTimeoutMs).toBeDefined();
  });

  it('does not expose hard-deadline timeoutMs to the model', () => {
    expect(schema.properties.timeoutMs).toBeUndefined();
  });

  it('does not expose maxIterations loop caps to the model', () => {
    expect(schema.properties.maxIterations).toBeUndefined();
  });

  it('describes workers as untimed by default', () => {
    expect(SESSION_SPAWN_TOOL.description).toContain('intentionally untimed');
    expect(SESSION_SPAWN_TOOL.description).toContain('cancel them for drift');
    expect(SESSION_SPAWN_TOOL.description).toContain('generous internal iteration budget');
  });

  it('documents dependency-aware launch sequencing', () => {
    expect(SESSION_SPAWN_TOOL.description).toContain('workstreamId');
    expect(SESSION_SPAWN_TOOL.description).toContain('dependsOnWorkstreams');
    expect(SESSION_SPAWN_TOOL.description).toContain('independent');
  });
});
