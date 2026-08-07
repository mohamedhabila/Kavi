import { findMisdirectedJsonFieldCriteria } from '../../../src/engine/goals/successCriteriaInspection';
import { validateGoalMutation } from '../../../src/engine/goals/validation';
import { SUCCESS_CRITERION_FORMS } from '../../../src/engine/goals/completionEvidence';
import type { AgentGoalMutation } from '../../../src/engine/goals/types';

// Traced live on `direct-bfcl-v4-parallel-relevance`. The goal declared
// `evidence.json_field:artifacts/bfcl-direct-output.txt:content:BFCL-DIRECT-A|BFCL-DIRECT-B`.
// The two-part grammar reads that as field path `artifacts/bfcl-direct-output.txt` and
// value `content:…`, and `readJsonFieldAtPath` looks for a field literally named after
// the file — which never exists. The write succeeded, completion was refused eight times
// in a row, and every retry rewrote the file and appended another effect criterion.
// Twenty-six tool calls, run ended blocked, deliverable correct on disk throughout.
const MISDIRECTED = 'evidence.json_field:artifacts/bfcl-direct-output.txt:content:A|B';

function criteriaOf(successCriteria: string[]) {
  return findMisdirectedJsonFieldCriteria({ successCriteria } as never);
}

describe('a json_field criterion addresses a document, not a filesystem', () => {
  it('rejects a workspace path used where a field path belongs', () => {
    expect(criteriaOf([MISDIRECTED])).toHaveLength(1);
  });

  it('rejects a windows-style path just as readily', () => {
    expect(criteriaOf(['evidence.json_field:artifacts\\out.txt:value'])).toHaveLength(1);
  });

  it('accepts an ordinary dotted field path', () => {
    expect(criteriaOf(['evidence.json_field:calendar.allowsModifications:true'])).toEqual([]);
  });

  it('accepts a single-segment field path', () => {
    expect(criteriaOf(['evidence.json_field:status:completed'])).toEqual([]);
  });

  it('ignores a separator that appears only in the expected value', () => {
    // The value may legitimately contain a path; only the field path is addressed here.
    expect(criteriaOf(['evidence.json_field:resource.id:artifacts/out.txt'])).toEqual([]);
  });

  it('leaves every other criterion form alone', () => {
    expect(
      criteriaOf([
        'evidence.artifact:artifacts/out.txt',
        'evidence.file_hash:artifacts/out.txt:sha256',
        'evidence.tool:write_file',
        'evidence.min:1',
      ]),
    ).toEqual([]);
  });
});

describe('the rejection tells the caller which form it actually wanted', () => {
  it('names the field-path form and the file-path alternatives', () => {
    const { valid, errors } = validateGoalMutation(
      {
        action: 'add',
        goals: [
          {
            id: 'g1',
            title: 'Produce the output',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['evidence.artifact:artifacts/out.txt', MISDIRECTED],
          },
        ],
      } as unknown as AgentGoalMutation,
      [],
    );
    const message = errors.map((entry) => entry.message).join(' ');

    expect(valid).toBe(false);
    expect(message).toContain('dotted field path');
    expect(message).toContain('evidence.artifact:<path>');
    // It must say why this matters now rather than later.
    expect(message).toContain('could not be withdrawn once accepted');
  });
});

describe('the documented forms do not invite the mistake', () => {
  it('distinguishes a json field path from the file paths its siblings take', () => {
    const jsonForm = SUCCESS_CRITERION_FORMS.find((form) => form.startsWith('evidence.json_field'));
    const artifactForm = SUCCESS_CRITERION_FORMS.find((form) =>
      form.startsWith('evidence.artifact'),
    );

    expect(artifactForm).toContain('<path>');
    expect(jsonForm).not.toContain(':<path>:');
    expect(jsonForm).toContain('field');
  });
});
