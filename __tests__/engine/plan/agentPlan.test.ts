import {
  MAX_AGENT_PLAN_STEP_CHARS,
  MAX_AGENT_PLAN_STEPS,
  normalizeAgentPlan,
  parseUpdatePlanArguments,
  renderPlanPromptSection,
} from '../../../src/engine/plan/agentPlan';

describe('parseUpdatePlanArguments', () => {
  it('reads the plan and an optional explanation', () => {
    expect(
      parseUpdatePlanArguments({
        explanation: '  Starting with the flights. ',
        plan: [
          { step: ' Find flights ', status: 'in_progress' },
          { step: 'Book the hotel', status: 'pending' },
        ],
      }),
    ).toEqual({
      arguments: {
        explanation: 'Starting with the flights.',
        plan: [
          { step: 'Find flights', status: 'in_progress' },
          { step: 'Book the hotel', status: 'pending' },
        ],
      },
    });
  });

  it('accepts an empty plan, which clears it', () => {
    expect(parseUpdatePlanArguments({ plan: [] })).toEqual({ arguments: { plan: [] } });
  });

  it('keeps step text in any language as the model wrote it', () => {
    const plan = [
      { step: 'احجز الفندق', status: 'completed' },
      { step: '航班を探す', status: 'pending' },
    ];
    expect(parseUpdatePlanArguments({ plan })).toEqual({ arguments: { plan } });
  });

  it.each([
    ['a non-object', 'plan'],
    ['an array', []],
    ['null', null],
  ])('refuses %s with the expected shape', (_label, args) => {
    const parsed = parseUpdatePlanArguments(args);
    expect('error' in parsed && parsed.error).toContain('"plan":[{"step"');
  });

  it('refuses a missing plan array with the expected shape', () => {
    const parsed = parseUpdatePlanArguments({ explanation: 'no plan' });
    expect('error' in parsed && parsed.error).toContain('needs a plan array');
  });

  it('names the step that has no text', () => {
    const parsed = parseUpdatePlanArguments({
      plan: [
        { step: 'One', status: 'completed' },
        { step: '   ', status: 'pending' },
      ],
    });
    expect('error' in parsed && parsed.error).toContain('Plan step 2');
  });

  it('names the step whose status is not one of the three', () => {
    const parsed = parseUpdatePlanArguments({ plan: [{ step: 'One', status: 'done' }] });
    expect('error' in parsed && parsed.error).toContain(
      'Plan step 1 needs a status of pending, in_progress or completed',
    );
  });

  it('refuses a plan longer than the bound', () => {
    const plan = Array.from({ length: MAX_AGENT_PLAN_STEPS + 1 }, (_unused, index) => ({
      step: `Step ${index}`,
      status: 'pending',
    }));
    const parsed = parseUpdatePlanArguments({ plan });
    expect('error' in parsed && parsed.error).toContain(`at most ${MAX_AGENT_PLAN_STEPS} steps`);
  });

  it('bounds a step text that runs past the limit', () => {
    const parsed = parseUpdatePlanArguments({
      plan: [{ step: 'x'.repeat(MAX_AGENT_PLAN_STEP_CHARS * 2), status: 'pending' }],
    });
    expect('arguments' in parsed && parsed.arguments.plan[0]?.step).toHaveLength(
      MAX_AGENT_PLAN_STEP_CHARS,
    );
  });
});

describe('normalizeAgentPlan', () => {
  it('keeps the well-formed steps of a stored plan and drops the rest', () => {
    expect(
      normalizeAgentPlan([
        { step: 'Keep', status: 'completed' },
        { step: '', status: 'pending' },
        { step: 'Bad status', status: 'blocked' },
        'not a step',
        null,
        { step: ' Also keep ', status: 'in_progress' },
      ]),
    ).toEqual([
      { step: 'Keep', status: 'completed' },
      { step: 'Also keep', status: 'in_progress' },
    ]);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeAgentPlan(undefined)).toEqual([]);
    expect(normalizeAgentPlan({ step: 'One', status: 'pending' })).toEqual([]);
  });

  it('bounds a stored plan to the step limit', () => {
    const stored = Array.from({ length: MAX_AGENT_PLAN_STEPS + 5 }, (_unused, index) => ({
      step: `Step ${index}`,
      status: 'pending',
    }));
    expect(normalizeAgentPlan(stored)).toHaveLength(MAX_AGENT_PLAN_STEPS);
  });
});

describe('renderPlanPromptSection', () => {
  it('renders nothing without a plan', () => {
    expect(renderPlanPromptSection(undefined)).toBe('');
    expect(renderPlanPromptSection([])).toBe('');
  });

  it('marks each step with its status, in order', () => {
    const section = renderPlanPromptSection([
      { step: 'Find flights', status: 'completed' },
      { step: 'Book the hotel', status: 'in_progress' },
      { step: 'Send the itinerary', status: 'pending' },
    ]);
    expect(section.split('\n')).toEqual([
      '## Plan',
      expect.stringContaining('it does not decide when you are done'),
      '- [x] Find flights',
      '- [>] Book the hotel',
      '- [ ] Send the itinerary',
    ]);
  });
});
