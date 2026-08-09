import { validateGoalMutation } from '../../../src/engine/goals/validation';
import {
  REGISTERED_NON_TOOL_EVIDENCE_PREFIXES,
  formatRegisteredNonToolEvidencePrefixes,
} from '../../../src/engine/goals/successCriteriaInspection';

// Traced live on an Android emulator. Two of the first four update_goals calls in a run
// were rejected for an unregistered evidence.prefix token — the model had guessed
// `evidence.prefix:output` for python output and `evidence.prefix:edit` for a file edit —
// and each cost a second call to correct. The refusal named the category ("a registered
// graph evidence prefix") but never the members, so the only way to find the one legal
// token was to guess again. There is exactly one, so it is now enumerated.

function rejectionFor(criterion: string): string {
  const result = validateGoalMutation(
    {
      action: 'add',
      goals: [
        {
          id: 'g',
          name: 'Goal',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.artifact:artifacts/out.md', criterion],
        },
      ],
    } as Parameters<typeof validateGoalMutation>[0],
    [],
  );

  return (result.errors ?? []).map((error) => error.message).join(' ');
}

describe('an unregistered evidence prefix is answered with the legal set', () => {
  it('names the allowed prefix instead of describing it', () => {
    const message = rejectionFor('evidence.prefix:output');

    expect(message).toContain('evidence.prefix:output');
    expect(message).toContain('evidence.prefix:worker');
  });

  it('answers the other traced guess the same way', () => {
    expect(rejectionFor('evidence.prefix:edit')).toContain('evidence.prefix:worker');
  });

  it('still points at the criterion that asserts a file, not a prefix', () => {
    const message = rejectionFor('evidence.prefix:output');
    expect(message).toContain('evidence.artifact:');
    expect(message).toContain('evidence.tool:');
  });
});

describe('the enumeration tracks the registry', () => {
  it('formats every registered prefix', () => {
    const formatted = formatRegisteredNonToolEvidencePrefixes();
    for (const prefix of REGISTERED_NON_TOOL_EVIDENCE_PREFIXES) {
      expect(formatted).toContain(`evidence.prefix:${prefix}`);
    }
  });

  it('accepts a registered prefix without complaint', () => {
    expect(rejectionFor('evidence.prefix:worker')).not.toContain('names the source');
  });

  it('accepts a tool name as a prefix source', () => {
    expect(rejectionFor('evidence.prefix:python')).not.toContain('names the source');
  });
});
