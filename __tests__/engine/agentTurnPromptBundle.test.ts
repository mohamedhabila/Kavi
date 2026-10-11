import { buildAgentTurnPromptBundle } from '../../src/engine/graph/agentTurnPromptBundle';
import { renderPlanPromptSection } from '../../src/engine/plan/agentPlan';
import { splitCacheableSystemPromptSections } from '../../src/services/llm/core/systemPromptSections';

describe('buildAgentTurnPromptBundle', () => {
  const baseParams = {
    effectiveForceTextThisTurn: false,
    groundedRequestScopedTools: [],
    iteration: 1,
    maxToolIterations: 25,
    resolvedPrompt: 'You are a helpful assistant.',
    selectedTools: [],
    skillPrompts: '',
    toolingEnabledForProvider: true,
  };

  it('includes the plan section, as a dynamic section of its own', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      planPromptSection: renderPlanPromptSection([
        { step: 'Find flights', status: 'completed' },
        { step: 'Book the hotel', status: 'in_progress' },
      ]),
    });
    expect(bundle.enrichedSystemPrompt).toContain('## Plan');
    expect(bundle.enrichedSystemPrompt).toContain('- [x] Find flights');
    expect(bundle.enrichedSystemPrompt).toContain('- [>] Book the hotel');
    const planSection = bundle.enrichedSystemPromptSections.find(
      (section) => section.purpose === 'plan',
    );
    expect(planSection?.cacheable).toBeUndefined();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
  ])('omits the plan section when it is %s', (_label, planPromptSection) => {
    const bundle = buildAgentTurnPromptBundle({ ...baseParams, planPromptSection });
    expect(bundle.enrichedSystemPrompt).not.toContain('## Plan');
    expect(
      bundle.enrichedSystemPromptSections.some((section) => section.purpose === 'plan'),
    ).toBe(false);
  });

  it('adds structural workflow continuation guidance as dynamic runtime context', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      workflowRuntimePrompt:
        '## Available Workflow Continuations\n- notification_schedule → notification_cancel',
    });

    expect(bundle.enrichedSystemPrompt).toContain('notification_schedule → notification_cancel');
    const workflowSection = bundle.enrichedSystemPromptSections.find(
      (section) => section.purpose === 'workflow_runtime',
    );
    expect(workflowSection).toBeDefined();
    expect(workflowSection?.cacheable).toBeUndefined();
  });

  it('keeps cacheable sections as a contiguous provider-visible prefix after memory and the plan are appended', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      livingMemorySections: [
        { text: '## This Turn\n### Retrieved Memory\nUser prefers concise updates.' },
        { text: '## Stable Addendum\nInvariant policy.', cacheable: true },
      ],
      planPromptSection: '## Plan\n- [ ] Finish the task.',
    });
    const firstDynamicIndex = bundle.enrichedSystemPromptSections.findIndex(
      (section) => !section.cacheable,
    );
    const lastCacheableIndex = bundle.enrichedSystemPromptSections.findLastIndex(
      (section) => section.cacheable,
    );

    expect(firstDynamicIndex).toBeGreaterThan(-1);
    expect(lastCacheableIndex).toBeGreaterThan(-1);
    expect(lastCacheableIndex).toBeLessThan(firstDynamicIndex);
    expect(bundle.enrichedSystemPrompt).toMatch(
      /## Stable Addendum\nInvariant policy\.[\s\S]*## This Turn[\s\S]*## Plan/,
    );
    expect(bundle.enrichedSystemPrompt).not.toContain('Runtime context:');
  });

  it('omits tool-only cacheable guidance when the turn has no selected tools', () => {
    const withTools = buildAgentTurnPromptBundle({
      ...baseParams,
      selectedTools: [
        {
          name: 'calendar_list',
          description: 'List calendar events.',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    });
    const withoutTools = buildAgentTurnPromptBundle({
      ...baseParams,
      selectedTools: [],
    });

    const withToolsCacheable = splitCacheableSystemPromptSections(
      withTools.enrichedSystemPromptSections,
    ).cacheableText;
    const withoutToolsCacheable = splitCacheableSystemPromptSections(
      withoutTools.enrichedSystemPromptSections,
    ).cacheableText;

    expect(withoutToolsCacheable.length).toBeLessThan(withToolsCacheable.length);
    expect(withoutToolsCacheable).toContain('Passive memory runs only after final delivery');
    expect(withoutToolsCacheable).toContain(
      'Without verified current-turn durable-memory write evidence',
    );
    expect(withoutToolsCacheable).toContain('never promise to remember or save it');
    expect(withoutToolsCacheable).not.toContain('With tools, batch independent calls');
    expect(
      splitCacheableSystemPromptSections(withoutTools.enrichedSystemPromptSections).dynamicText,
    ).toContain('Execution mode for this turn: no registered executable tools');
  });

  it('keeps the run prompt for a turn forced to text while tools exist', () => {
    // Traced on GLM 5.3 Flash: after a provider stall forced a checkpoint, the no-tools
    // prompt made the model tell the person the app had no calendar tools.
    const selectedTools = [
      {
        name: 'calendar_create_event',
        description: 'Create a calendar event.',
        input_schema: { type: 'object', properties: {} },
      },
    ];
    const toolTurn = buildAgentTurnPromptBundle({ ...baseParams, selectedTools });
    const forcedTurn = buildAgentTurnPromptBundle({
      ...baseParams,
      selectedTools,
      effectiveForceTextThisTurn: true,
    });

    expect(forcedTurn.toolsForIteration).toBeUndefined();
    expect(forcedTurn.enrichedSystemPrompt).not.toContain('no registered executable tools');
    expect(splitCacheableSystemPromptSections(forcedTurn.enrichedSystemPromptSections).cacheableText).toBe(
      splitCacheableSystemPromptSections(toolTurn.enrichedSystemPromptSections).cacheableText,
    );
  });
});
