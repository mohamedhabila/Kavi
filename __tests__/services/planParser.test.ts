import { extractStructuredAgentPlan } from '../../src/services/agents/planParser';

describe('extractStructuredAgentPlan', () => {
  it('parses objective, success criteria, stop conditions, and workstreams', () => {
    const plan = extractStructuredAgentPlan(
      [
        'Objective: Ship the parity fix.',
        'Success Criteria:',
        '- The workflow state is persisted.',
        '- The UI renders a visible timeline.',
        'Stop Conditions:',
        '- Stop when the fix is verified.',
        '- Stop if a blocking dependency remains unresolved.',
        'Workstreams:',
        '1. Store model | Goal: Add semantic plan state | Success: persisted plan, migration | Depends on: none',
        '2. UI surface | Goal: Render plan and timeline | Success: workflow card updates | Depends on: Store model',
      ].join('\n'),
      'Fallback goal',
    );

    expect(plan.objective).toBe('Ship the parity fix.');
    expect(plan.successCriteria).toEqual([
      'The workflow state is persisted.',
      'The UI renders a visible timeline.',
    ]);
    expect(plan.stopConditions).toEqual([
      'Stop when the fix is verified.',
      'Stop if a blocking dependency remains unresolved.',
    ]);
    expect(plan.workstreams).toEqual([
      expect.objectContaining({
        id: 'workstream-1',
        title: 'Store model',
        goal: 'Add semantic plan state',
        successCriteria: ['persisted plan', 'migration'],
      }),
      expect.objectContaining({
        id: 'workstream-2',
        title: 'UI surface',
        goal: 'Render plan and timeline',
        successCriteria: ['workflow card updates'],
        dependencies: ['workstream-1'],
      }),
    ]);
  });

  it('handles markdown-style headings and multiline list items', () => {
    const plan = extractStructuredAgentPlan(
      [
        '## Objective: Harden the run model',
        '**Success Criteria:**',
        '- The run model stores semantic planning data',
        '  and survives app restarts.',
        '- Important tool activity appears in the workflow card.',
        '**Stop Conditions:**',
        '- The change is fully tested.',
        'Workstreams:',
        '- Parser and store — wire the semantic plan object',
      ].join('\n'),
      'Fallback goal',
    );

    expect(plan.objective).toBe('Harden the run model');
    expect(plan.successCriteria).toEqual([
      'The run model stores semantic planning data and survives app restarts.',
      'Important tool activity appears in the workflow card.',
    ]);
    expect(plan.stopConditions).toEqual(['The change is fully tested.']);
    expect(plan.workstreams).toEqual([
      expect.objectContaining({
        title: 'Parser and store',
        goal: 'wire the semantic plan object',
      }),
    ]);
  });

  it('falls back to safe defaults when the assistant does not follow the format', () => {
    const plan = extractStructuredAgentPlan(
      'I will inspect the repo and apply the fix.',
      'Inspect the repo and apply the fix.',
    );

    expect(plan.objective).toBe('Inspect the repo and apply the fix.');
    expect(plan.successCriteria).toEqual([
      'Produce the requested deliverable.',
      'Verify the result before finalizing.',
    ]);
    expect(plan.stopConditions).toEqual([
      'Stop when the deliverable is complete and the success criteria are satisfied.',
      'Stop early if a concrete blocker, missing permission, or dependency prevents further progress.',
    ]);
    expect(plan.workstreams).toEqual([]);
    expect(plan.rawPlan).toBe('I will inspect the repo and apply the fix.');
  });

  it('stops parsing workstreams before trailing narration and normalizes numbered dependencies', () => {
    const plan = extractStructuredAgentPlan(
      [
        'Objective: Compare providers.',
        'Success Criteria:',
        '- Each provider gets its own research workstream.',
        'Workstreams:',
        '1. **Anthropic Research** | Goal: Review Anthropic docs | Success: source-backed notes | Depends on: none',
        '2. **OpenAI Research** | Goal: Review OpenAI docs | Success: source-backed notes | Depends on: none',
        '3. **Google Gemini Research** | Goal: Review Gemini docs | Success: source-backed notes | Depends on: none',
        '4. **Critic/Synthesis** | Goal: Compare findings | Success: synthesis memo | Depends on: workstreams 1, 2, 3',
        'Now spawning the research sub-agents in parallel:',
      ].join('\n'),
      'Fallback goal',
    );

    expect(plan.workstreams).toEqual([
      expect.objectContaining({ id: 'workstream-1', title: 'Anthropic Research' }),
      expect.objectContaining({ id: 'workstream-2', title: 'OpenAI Research' }),
      expect.objectContaining({ id: 'workstream-3', title: 'Google Gemini Research' }),
      expect.objectContaining({
        id: 'workstream-4',
        title: 'Critic/Synthesis',
        dependencies: ['workstream-1', 'workstream-2', 'workstream-3'],
      }),
    ]);
    expect(plan.rawPlan).toContain('Now spawning the research sub-agents in parallel:');
  });
});
