import { validateGoalMutation } from '../../../src/engine/goals/validation';
import { findUnsatisfiableStructuralCriteria } from '../../../src/engine/goals/successCriteriaInspection';
import type { AgentGoalMutation } from '../../../src/engine/goals/types';

// Traced live on `direct-spabench-cross-app-device-actions`. A blocking goal accumulated
// seventeen success criteria, eleven of them over three hundred characters. The grammar
// behind `evidence.artifact:` and `evidence.json_field:` is `(.+)`, so a description
// passed as a structural criterion, counted as "specific", and gated the goal — while
// matching no evidence the run could ever produce. Blocking criteria are monotonic, so
// the criterion could not be removed either. The model had no legal move: ten rejected
// mutations, thirty-two tool calls, run ended by stagnation detection.
const PROSE =
  'The clipboard content is verified and the share sheet has been opened for the user, ' +
  'and afterwards a notification is scheduled and then cancelled so the device returns ' +
  'to its original state without leaving anything pending for the person using it.';

function criteriaOf(successCriteria: string[]) {
  return findUnsatisfiableStructuralCriteria({ successCriteria } as never);
}

describe('structural criteria must name a resource, not describe one', () => {
  it('rejects a description passed as an artifact criterion', () => {
    expect(criteriaOf([`evidence.artifact:${PROSE}`])).toHaveLength(1);
  });

  it('rejects a description passed as a json_field criterion', () => {
    expect(criteriaOf([`evidence.json_field:${PROSE}`])).toHaveLength(1);
  });

  it('accepts an ordinary workspace path', () => {
    expect(criteriaOf(['evidence.artifact:artifacts/report.md'])).toEqual([]);
  });

  it('accepts a path containing spaces, which is a legitimate filename', () => {
    expect(criteriaOf(['evidence.artifact:notes/Q3 planning notes.md'])).toEqual([]);
  });

  it('accepts a dotted json field reference with an expected value', () => {
    expect(criteriaOf(['evidence.json_field:calendar.allowsModifications:true'])).toEqual([]);
  });

  it('accepts a file hash criterion', () => {
    expect(
      criteriaOf([`evidence.file_hash:artifacts/out.txt:sha256:${'a'.repeat(64)}`]),
    ).toEqual([]);
  });

  it('rejects an operand carrying line breaks', () => {
    expect(criteriaOf(['evidence.artifact:first line\nsecond line'])).toHaveLength(1);
  });

  it('rejects an operand made of multiple sentences', () => {
    expect(criteriaOf(['evidence.artifact:Write the file. Then verify it.'])).toHaveLength(1);
  });

  it('leaves criteria of other forms alone', () => {
    expect(criteriaOf(['evidence.tool:write_file', 'evidence.min:2'])).toEqual([]);
  });

  it('refuses the goal at declaration, while it is still repairable', () => {
    const { valid, errors } = validateGoalMutation(
      {
        action: 'add',
        goals: [
          {
            id: 'g1',
            title: 'Device actions',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.tool:write_file', `evidence.artifact:${PROSE}`],
          },
        ],
      } as unknown as AgentGoalMutation,
      [],
    );

    expect(valid).toBe(false);
    const message = errors.map((entry) => entry.message).join(' ');
    expect(message).toContain('name a resource');
    // The message must say why this matters now: after acceptance there is no way back.
    expect(message).toContain('cannot be removed once accepted');
  });
});
