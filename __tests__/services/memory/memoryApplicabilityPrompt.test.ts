import { makeMemoryFact } from '../../helpers/memoryFactFixtures';
import {
  assemblePrompt,
  flattenPromptSections,
  type PromptMemoryFact,
} from '../../../src/services/memory/promptAssembly';
import { MEMORY_APPLICABILITY_PROMPT_LIMITS } from '../../../src/services/memory/memoryApplicabilityPrompt';
import type { MemoryApplicabilityReason } from '../../../src/services/memory/memoryApplicabilityTypes';

function promptFact(
  action: 'use' | 'ask' | 'abstain',
  reason: MemoryApplicabilityReason,
): PromptMemoryFact {
  return {
    ...makeMemoryFact({ objectText: 'bounded-memory-value', scope: 'global' }),
    subjectLabel: 'user',
    applicability: { action, reason },
  };
}

describe('memory applicability prompt annotations', () => {
  it('renders use facts without an uncertainty policy label', () => {
    const prompt = flattenPromptSections(
      assemblePrompt({
        basePrompt: '',
        retrievedFacts: [promptFact('use', 'eligible')],
      }).sections,
    );

    expect(prompt).toContain('bounded-memory-value');
    expect(prompt).not.toContain('Memory Resolution Required');
    expect(prompt).not.toContain('policy=');
  });

  it.each([
    ['ask', 'stale_memory'],
    ['abstain', 'objective_external_conflict'],
  ] as const)('renders a binding %s instruction and closed reason', (action, reason) => {
    const prompt = flattenPromptSections(
      assemblePrompt({
        basePrompt: '',
        retrievedFacts: [promptFact(action, reason)],
      }).sections,
    );

    expect(prompt).toContain('### Memory Resolution Required');
    expect(prompt).toContain(
      action === 'ask' ? '#### Ask User to Confirm' : '#### Abstain Pending Evidence',
    );
    expect(prompt).toContain('memory policy labels are binding');
    expect(prompt).toContain(`policy=${action} reason=${reason}`);
    expect(prompt).toContain('bounded-memory-value');
    if (action === 'ask') {
      expect(prompt).toContain('require user confirmation before reliance');
    } else {
      expect(prompt).toContain('must not be asserted or used for an action');
    }
  });

  it('bounds the aggregate resolution allocation and drops lower-priority entries', () => {
    const guarded = Array.from(
      { length: 12 },
      (_, index): PromptMemoryFact => ({
        ...promptFact(
          index % 2 === 0 ? 'ask' : 'abstain',
          index % 2 === 0 ? 'stale_memory' : 'objective_external_conflict',
        ),
        id: `guarded-${index}`,
        objectText: `guarded-value-${index}-${'x'.repeat(2_000)}`,
      }),
    );
    const silentContent = 'silent-raw-content-must-never-render';
    const defensiveSilent = {
      ...promptFact('use', 'eligible'),
      id: 'defensive-silent',
      objectText: silentContent,
      applicability: { action: 'silent', reason: 'restricted_sensitivity' },
    } as unknown as PromptMemoryFact;
    const prompt = flattenPromptSections(
      assemblePrompt({
        basePrompt: '',
        retrievedFacts: [...guarded, defensiveSilent],
      }).sections,
    );

    expect(prompt.length).toBeLessThanOrEqual(MEMORY_APPLICABILITY_PROMPT_LIMITS.sectionChars);
    expect(prompt).toContain('guarded-value-0');
    expect(prompt).toContain('guarded-value-1');
    expect(prompt).toContain('guarded-value-3');
    expect(prompt).toContain('guarded-value-5');
    expect(prompt).not.toContain('guarded-value-2');
    expect(prompt).not.toContain('guarded-value-7');
    expect(prompt).not.toContain(silentContent);
    expect(prompt.match(/### Memory Resolution Required/gu)).toHaveLength(1);
  });
});
