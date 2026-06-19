import { SUPER_AGENT_SYSTEM_PROMPT } from '../../src/services/agents/personas';

describe('agent persona prompts', () => {
  it('keeps the SuperAgent durable prompt lean while preserving workflow contracts', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT.length).toBeLessThan(2600);
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('do not emit a formal workstream plan before the first tool call');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('start acting and keep any short pre-tool explanation concise');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      "omit tools unless you need to narrow the worker's scope",
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_wait');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain(['Phase', '1'].join(' '));
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain(['Phase', '7'].join(' '));
  });
});
