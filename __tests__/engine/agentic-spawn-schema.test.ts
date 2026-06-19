// ---------------------------------------------------------------------------
// Tests — Enhanced sessions_spawn Tool Schema
// ---------------------------------------------------------------------------

import { SESSION_SPAWN_TOOL } from '../../src/engine/tools/builtin-definitions';

describe('SESSION_SPAWN_TOOL schema', () => {
  const schema = SESSION_SPAWN_TOOL.input_schema;

  it('has prompt as the only required field', () => {
    expect(schema.required).toEqual(['prompt']);
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
    expect(schema.properties.tools.description).toContain('Optional worker-tool restriction');
  });

  it('keeps the compact worker-launch properties', () => {
    expect(schema.properties.prompt).toBeDefined();
    expect(schema.properties.waitForCompletion).toBeDefined();
    expect(schema.properties.model).toBeUndefined();
    expect(schema.properties.systemPrompt).toBeUndefined();
    expect(schema.properties.inheritMemory).toBeUndefined();
    expect(schema.properties.sandboxPolicy).toBeUndefined();
    expect(schema.properties.announce).toBeUndefined();
    expect(schema.properties.waitTimeoutMs).toBeUndefined();
    expect(schema.properties.objective).toBeUndefined();
    expect(schema.properties.expectedOutput).toBeUndefined();
  });

  it('does not expose hard-deadline timeoutMs to the model', () => {
    expect(schema.properties.timeoutMs).toBeUndefined();
  });

  it('does not expose maxIterations loop caps to the model', () => {
    expect(schema.properties.maxIterations).toBeUndefined();
  });

  it('documents dependency-aware launch sequencing', () => {
    expect(SESSION_SPAWN_TOOL.input_schema.properties.workstreamId.description).toContain(
      'structured workstream',
    );
    expect(
      SESSION_SPAWN_TOOL.input_schema.properties.dependsOnWorkstreams.description,
    ).toContain('prerequisite');
    expect(SESSION_SPAWN_TOOL.description).toContain(
      "omit tools unless you need a narrower worker scope",
    );
    expect(SESSION_SPAWN_TOOL.description).not.toContain('transcript or reasoning trace');
  });
});
