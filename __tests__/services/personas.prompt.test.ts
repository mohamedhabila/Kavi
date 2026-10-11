import { SUPER_AGENT_SYSTEM_PROMPT } from '../../src/services/agents/personas';

describe('agent persona prompts', () => {
  it('keeps the SuperAgent durable prompt lean while preserving workflow contracts', () => {
    expect(SUPER_AGENT_SYSTEM_PROMPT.length).toBeLessThan(2900);
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Reply to the user in the language of their latest message',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'Never narrate your internal tools, goals, workers, sessions, or other mechanics',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Skip the plan for a request one step answers');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'start acting and keep any short pre-tool explanation concise',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain(
      'tools field is a strict security allowlist, not a task plan',
    );
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('keep a short plan with update_plan');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain('update_goals');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('inspect user-designated files or attachments');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('sessions_wait');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('one focused sessions_send continuation');
    expect(SUPER_AGENT_SYSTEM_PROMPT).toContain('Verify worker status and deliverables');
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain(['Phase', '1'].join(' '));
    expect(SUPER_AGENT_SYSTEM_PROMPT).not.toContain(['Phase', '7'].join(' '));
  });
});
