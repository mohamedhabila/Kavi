import { buildAgentTurnPromptBundle } from '../../src/engine/graph/agentTurnPromptBundle';
import { createGoal } from '../../src/engine/goals/types';
import { renderGoalPromptSection } from '../../src/engine/goals/promptSection';
import { splitCacheableSystemPromptSections } from '../../src/services/llm/core/systemPromptSections';

describe('buildAgentTurnPromptBundle', () => {
  const baseParams = {
    conversationMemory: null,
    effectiveForceTextThisTurn: false,
    globalMemory: null,
    groundedRequestScopedTools: [],
    iteration: 1,
    maxToolIterations: 25,
    resolvedPrompt: 'You are a helpful assistant.',
    selectedTools: [],
    skillPrompts: '',
    toolingEnabledForProvider: true,
  };

  it('includes goals prompt section when provided', () => {
    const goals = [
      createGoal({ id: 'g1', title: 'Active goal', status: 'active' }),
      createGoal({ id: 'g2', title: 'Pending goal', status: 'pending' }),
    ];
    const goalsSection = renderGoalPromptSection(goals);
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      goalsPromptSection: goalsSection,
    });
    expect(bundle.enrichedSystemPrompt).toContain('## Current Goals');
    expect(bundle.enrichedSystemPrompt).toContain('Active goal');
    expect(bundle.enrichedSystemPrompt).toContain('Pending goal');
  });

  it('omits goals prompt section when null', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      goalsPromptSection: null,
    });
    expect(bundle.enrichedSystemPrompt).not.toContain('## Current Goals');
  });

  it('omits goals prompt section when undefined', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
    });
    expect(bundle.enrichedSystemPrompt).not.toContain('## Current Goals');
  });

  it('omits goals prompt section when empty string', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      goalsPromptSection: '',
    });
    expect(bundle.enrichedSystemPrompt).not.toContain('## Current Goals');
  });

  it('keeps cacheable sections as a contiguous provider-visible prefix after memory and goals are appended', () => {
    const bundle = buildAgentTurnPromptBundle({
      ...baseParams,
      livingMemorySections: [
        { text: '## Persistent Memory\nUser prefers concise updates.' },
        { text: '## Stable Addendum\nInvariant policy.', cacheable: true },
      ],
      goalsPromptSection: '## Current Goals\n- Finish the task.',
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
      /## Stable Addendum\nInvariant policy\.[\s\S]*## Persistent Memory[\s\S]*## Current Goals/,
    );
    expect(bundle.enrichedSystemPrompt).not.toContain('Runtime context:');
  });

  it('keeps the cacheable baseline stable when the turn has no selected tools', () => {
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

    expect(
      splitCacheableSystemPromptSections(withoutTools.enrichedSystemPromptSections).cacheableText,
    ).toBe(splitCacheableSystemPromptSections(withTools.enrichedSystemPromptSections).cacheableText);
    expect(
      splitCacheableSystemPromptSections(withoutTools.enrichedSystemPromptSections).dynamicText,
    ).toContain('Execution mode for this turn: no registered executable tools');
  });
});
