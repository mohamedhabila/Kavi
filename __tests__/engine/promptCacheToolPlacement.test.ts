import { stampPromptCachePlacement } from '../../src/engine/graph/promptCacheToolPlacement';
import {
  buildPromptCachingToolOrder,
  buildToolDeclarationDigest,
} from '../../src/services/llm/core/toolCaching';
import { DEFAULT_CORE_TOOL_ORDER } from '../../src/engine/goals/toolSurface';
import { compressToolDefinitions } from '../../src/engine/tools/toolManagerTokenBudget';
import { buildAgentTurnPromptBundle } from '../../src/engine/graph/agentTurnPromptBundle';
import { splitCacheableSystemPromptSections } from '../../src/services/llm/core/systemPromptSections';
import type { ToolDefinition } from '../../src/types/tool';

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `does ${name}`,
    input_schema: { type: 'object', properties: {} },
  } as ToolDefinition;
}

const CORE_SAMPLE = DEFAULT_CORE_TOOL_ORDER.slice(0, 4).map((name) => tool(name));

function stablePrefixDigest(tools: ToolDefinition[]): string {
  const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder(tools);
  return buildToolDeclarationDigest(orderedTools.slice(0, lastStablePrefixIndex + 1));
}

describe('stampPromptCachePlacement', () => {
  it('marks default core tools as the stable prefix', () => {
    const stamped = stampPromptCachePlacement(CORE_SAMPLE);

    for (const entry of stamped) {
      expect(entry.promptCache?.placement).toBe('stable_prefix');
    }
  });

  it('marks discovery-activated tools as the dynamic suffix', () => {
    const stamped = stampPromptCachePlacement([tool('sms_compose'), tool('calendar_create')]);

    for (const entry of stamped) {
      expect(entry.promptCache?.placement).toBe('dynamic_suffix');
    }
  });

  it('does not mutate the tools it is given', () => {
    const original = tool('write_file');
    stampPromptCachePlacement([original]);

    expect(original.promptCache).toBeUndefined();
  });

  it('preserves every other field so the executable surface is unchanged', () => {
    const source: ToolDefinition = {
      ...tool('write_file'),
      contract: { capabilities: ['write'] },
    } as ToolDefinition;

    const [stamped] = stampPromptCachePlacement([source]);

    expect(stamped.name).toBe(source.name);
    expect(stamped.description).toBe(source.description);
    expect(stamped.input_schema).toEqual(source.input_schema);
    expect(stamped.contract).toEqual(source.contract);
  });

  it('survives prompt compaction, which strips only the execution contract', () => {
    const [compacted] = compressToolDefinitions(
      stampPromptCachePlacement([{ ...tool('write_file'), contract: { capabilities: ['write'] } } as ToolDefinition]),
    );

    expect(compacted.promptCache?.placement).toBe('stable_prefix');
    expect(compacted.contract).toBeUndefined();
  });
});

describe('prompt cache prefix stability under progressive tool disclosure', () => {
  it('keeps the stable prefix byte-identical when a tool is activated mid-run', () => {
    // The regression this exists for: without placement every tool counted as stable
    // and sorted by name, so activating one tool inserted it into the middle of the
    // declaration block and shifted every declaration after it. That invalidates the
    // prompt cache from the insertion point through the rest of the request.
    const beforeActivation = stampPromptCachePlacement(CORE_SAMPLE);
    const afterActivation = stampPromptCachePlacement([...CORE_SAMPLE, tool('sms_compose')]);

    expect(stablePrefixDigest(afterActivation)).toBe(stablePrefixDigest(beforeActivation));
  });

  it('keeps the prefix stable even when the new tool sorts before every core tool', () => {
    // Alphabetical ordering is what made this a mid-array insert rather than an
    // append, so the guard has to cover a name that sorts to the very front.
    const beforeActivation = stampPromptCachePlacement(CORE_SAMPLE);
    const afterActivation = stampPromptCachePlacement([...CORE_SAMPLE, tool('aaa_activated')]);

    expect(stablePrefixDigest(afterActivation)).toBe(stablePrefixDigest(beforeActivation));
  });

  it('places every stable tool ahead of every dynamic tool', () => {
    const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder(
      stampPromptCachePlacement([tool('aaa_activated'), ...CORE_SAMPLE]),
    );

    expect(lastStablePrefixIndex).toBe(CORE_SAMPLE.length - 1);
    for (const entry of orderedTools.slice(0, lastStablePrefixIndex + 1)) {
      expect(entry.promptCache?.placement).toBe('stable_prefix');
    }
    expect(orderedTools[orderedTools.length - 1].name).toBe('aaa_activated');
  });

  it('orders the stable prefix deterministically regardless of input order', () => {
    const forward = stampPromptCachePlacement(CORE_SAMPLE);
    const reversed = stampPromptCachePlacement([...CORE_SAMPLE].reverse());

    expect(stablePrefixDigest(reversed)).toBe(stablePrefixDigest(forward));
  });

  it('without placement, activating a tool would shift the declaration block', () => {
    // Pins the pre-fix behaviour so the value of stamping stays visible: unstamped
    // tools all count as stable, so the "stable" digest changes on every activation.
    const before = stablePrefixDigest(CORE_SAMPLE);
    const after = stablePrefixDigest([...CORE_SAMPLE, tool('aaa_activated')]);

    expect(after).not.toBe(before);
  });
});

describe('assembled system-prompt cacheable prefix', () => {
  // Measured on the live run: the tool block was only one of two churn sources. The
  // cacheable prefix digest count tracked the system-prompt digest count exactly,
  // meaning the prompt — not the tools — was the binding constraint. The capability
  // index sat first in that prefix and varied with the turn's surface, so this asserts
  // the assembled prefix survives an activation.
  function cacheablePrefixFor(selected: ToolDefinition[]): string | undefined {
    const bundle = buildAgentTurnPromptBundle({
      allTools: [...CORE_SAMPLE, tool('sms_compose'), tool('calendar_create')],
      effectiveForceTextThisTurn: false,
      groundedRequestScopedTools: selected,
      iteration: 1,
      maxToolIterations: 20,
      resolvedPrompt: 'You are a helpful assistant.',
      selectedTools: selected,
      skillPrompts: '',
      toolingEnabledForProvider: true,
    });
    return splitCacheableSystemPromptSections(bundle.enrichedSystemPromptSections).cacheableText;
  }

  it('stays byte-identical when a tool is activated mid-run', () => {
    const before = cacheablePrefixFor([...CORE_SAMPLE]);
    const after = cacheablePrefixFor([...CORE_SAMPLE, tool('sms_compose')]);

    expect(before).toBeTruthy();
    expect(after).toBe(before);
  });
});
