import {
  buildMissingRequiredEvidenceLabels,
  evaluateGoalEvidenceGaps,
  formatSuccessCriteriaFormsDescription,
  isRecognizedSuccessCriterionForm,
  isSuccessCriterionMet,
  resolveSuccessCriterionSurfaceHints,
} from '../../../src/engine/goals/completionEvidence';
import { createGoal } from '../../../src/engine/goals/types';

describe('completionEvidence', () => {
  it('documents supported structural criterion forms', () => {
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.tool:<name>');
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.artifact:<path>');
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.count:<n>');
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.json_field:<path>:<value>');
    expect(formatSuccessCriteriaFormsDescription()).toContain(
      'evidence.file_hash:<path>:<algo>[:<hex>]',
    );
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.exit_code:<n>');
  });

  it('recognizes only formal structural success criterion forms', () => {
    expect(isRecognizedSuccessCriterionForm('evidence.min:1')).toBe(true);
    expect(isRecognizedSuccessCriterionForm('evidence.prefix:worker')).toBe(true);
    expect(isRecognizedSuccessCriterionForm('evidence.json_field:status:ok')).toBe(true);
    expect(isRecognizedSuccessCriterionForm('meal-planning-scope')).toBe(false);
  });

  it('maps structural success criteria to provider-neutral tool surface hints', () => {
    expect(resolveSuccessCriterionSurfaceHints('evidence.tool:write_file')).toEqual({
      toolNames: ['write_file'],
      capabilities: [],
      resourceKinds: [],
      categories: [],
    });
    expect(resolveSuccessCriterionSurfaceHints('evidence.prefix:memory_remember')).toEqual({
      toolNames: ['memory_remember'],
      capabilities: [],
      resourceKinds: [],
      categories: [],
    });
    expect(resolveSuccessCriterionSurfaceHints('evidence.prefix:worker')).toEqual({
      toolNames: [],
      capabilities: ['coordinate'],
      resourceKinds: [],
      categories: ['sessions'],
    });
    expect(resolveSuccessCriterionSurfaceHints('evidence.artifact:artifacts/out.txt')).toEqual({
      toolNames: [],
      capabilities: ['write'],
      resourceKinds: ['conversation_workspace'],
      categories: ['workspace_files'],
    });
    expect(
      resolveSuccessCriterionSurfaceHints('evidence.file_hash:artifacts/out.txt:sha256'),
    ).toEqual({
      toolNames: [],
      capabilities: ['write'],
      resourceKinds: ['conversation_workspace'],
      categories: ['workspace_files'],
    });
    expect(resolveSuccessCriterionSurfaceHints('evidence.json_field:status:ok')).toEqual({
      toolNames: [],
      capabilities: [],
      resourceKinds: [],
      categories: [],
    });
  });

  it('returns no gaps when active goals have no criteria', () => {
    const goals = [createGoal({ id: 'g1', title: 'Build', status: 'active' })];
    expect(evaluateGoalEvidenceGaps(goals)).toEqual([]);
  });

  it('detects evidence.min gaps for active goals', () => {
    const goals = [
      createGoal({
        id: 'g1',
        title: 'Build',
        status: 'active',
        successCriteria: ['evidence.min:2'],
        evidence: ['read_file:content'],
      }),
    ];

    expect(evaluateGoalEvidenceGaps(goals)).toEqual([
      { goalId: 'g1', criterionId: 'evidence.min:2' },
    ]);
  });

  it('detects evidence.count gaps as an alias for evidence.min', () => {
    const goals = [
      createGoal({
        id: 'g1',
        title: 'Build',
        status: 'active',
        successCriteria: ['evidence.count:2'],
        evidence: ['read_file:content'],
      }),
    ];

    expect(evaluateGoalEvidenceGaps(goals)).toEqual([
      { goalId: 'g1', criterionId: 'evidence.count:2' },
    ]);
  });

  it('detects evidence.prefix gaps for active goals', () => {
    const goals = [
      createGoal({
        id: 'g1',
        title: 'Build',
        status: 'active',
        successCriteria: ['evidence.prefix:python'],
        evidence: ['read_file:content'],
      }),
    ];

    expect(evaluateGoalEvidenceGaps(goals)).toEqual([
      { goalId: 'g1', criterionId: 'evidence.prefix:python' },
    ]);
  });

  it('detects evidence.tool gaps for active goals', () => {
    const goals = [
      createGoal({
        id: 'g1',
        title: 'Build',
        status: 'active',
        successCriteria: ['evidence.tool:write_file'],
        evidence: ['read_file:content'],
      }),
    ];

    expect(evaluateGoalEvidenceGaps(goals)).toEqual([
      { goalId: 'g1', criterionId: 'evidence.tool:write_file' },
    ]);
  });

  it('detects evidence.artifact gaps using structural path tokens', () => {
    const goals = [
      createGoal({
        id: 'g1',
        title: 'Build',
        status: 'active',
        successCriteria: ['evidence.artifact:artifacts/e2e-gate.txt'],
        evidence: ['write_file:Wrote to artifacts/other.txt'],
      }),
    ];

    expect(evaluateGoalEvidenceGaps(goals)).toEqual([
      { goalId: 'g1', criterionId: 'evidence.artifact:artifacts/e2e-gate.txt' },
    ]);
  });

  it('satisfies evidence.tool and evidence.artifact criteria structurally', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Build',
      status: 'active',
      evidence: ['write_file:Wrote to artifacts/out.txt'],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.tool:write_file')).toBe(true);
    expect(isSuccessCriterionMet(goal, 'evidence.artifact:artifacts/out.txt')).toBe(true);
  });

  it('detects and satisfies evidence.json_field criteria from tool JSON evidence', () => {
    const unmet = createGoal({
      id: 'g1',
      title: 'Verify',
      status: 'active',
      successCriteria: ['evidence.json_field:status:ok'],
      evidence: ['calendar_list:[{"allowsModifications":true}]'],
    });
    expect(evaluateGoalEvidenceGaps([unmet])).toEqual([
      { goalId: 'g1', criterionId: 'evidence.json_field:status:ok' },
    ]);

    const met = createGoal({
      id: 'g1',
      title: 'Verify',
      status: 'active',
      successCriteria: ['evidence.json_field:0.allowsModifications:true'],
      evidence: ['calendar_list:[{"allowsModifications":true}]'],
    });
    expect(isSuccessCriterionMet(met, 'evidence.json_field:0.allowsModifications:true')).toBe(true);

    const arrayRootMet = {
      ...met,
      evidence: ['calendar_list:[{"allowsModifications":true}]'],
      successCriteria: ['evidence.json_field:allowsModifications:true'],
    };
    expect(
      isSuccessCriterionMet(arrayRootMet, 'evidence.json_field:allowsModifications:true'),
    ).toBe(true);
  });

  it('detects and satisfies evidence.file_hash criteria structurally', () => {
    const unmet = createGoal({
      id: 'g1',
      title: 'Verify',
      status: 'active',
      successCriteria: ['evidence.file_hash:artifacts/out.txt:sha256'],
      evidence: ['write_file:Wrote to artifacts/out.txt'],
    });
    expect(evaluateGoalEvidenceGaps([unmet])).toEqual([
      { goalId: 'g1', criterionId: 'evidence.file_hash:artifacts/out.txt:sha256' },
    ]);

    const met = createGoal({
      id: 'g1',
      title: 'Verify',
      status: 'active',
      successCriteria: ['evidence.file_hash:artifacts/out.txt:sha256'],
      evidence: [
        'write_file:file_hash:artifacts/out.txt:sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ],
    });
    expect(isSuccessCriterionMet(met, 'evidence.file_hash:artifacts/out.txt:sha256')).toBe(true);
    expect(
      isSuccessCriterionMet(
        met,
        'evidence.file_hash:artifacts/out.txt:sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ),
    ).toBe(true);
    expect(
      isSuccessCriterionMet(
        met,
        'evidence.file_hash:artifacts/out.txt:sha256:0000c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ),
    ).toBe(false);
  });

  it('detects and satisfies evidence.exit_code criteria structurally', () => {
    const unmet = createGoal({
      id: 'g1',
      title: 'Run',
      status: 'active',
      successCriteria: ['evidence.exit_code:0'],
      evidence: ['python:exit_code:1'],
    });
    expect(evaluateGoalEvidenceGaps([unmet])).toEqual([
      { goalId: 'g1', criterionId: 'evidence.exit_code:0' },
    ]);

    const met = createGoal({
      id: 'g1',
      title: 'Run',
      status: 'active',
      successCriteria: ['evidence.exit_code:0'],
      evidence: ['python:exit_code:0'],
    });
    expect(isSuccessCriterionMet(met, 'evidence.exit_code:0')).toBe(true);
  });

  it('ignores completed goals and satisfied criteria', () => {
    const goals = [
      createGoal({
        id: 'g1',
        title: 'Build',
        status: 'completed',
        successCriteria: ['evidence.min:2'],
        evidence: [],
      }),
      createGoal({
        id: 'g2',
        title: 'Verify',
        status: 'active',
        successCriteria: ['evidence.prefix:python'],
        evidence: ['python:execution:success'],
      }),
    ];

    expect(evaluateGoalEvidenceGaps(goals)).toEqual([]);
  });

  it('builds missing required evidence labels from goal and criterion ids', () => {
    const labels = buildMissingRequiredEvidenceLabels([
      { goalId: 'g1', criterionId: 'evidence.min:2' },
      { goalId: 'g2', criterionId: 'evidence.prefix:worker' },
    ]);

    expect(labels).toEqual(['g1:evidence.min:2', 'g2:evidence.prefix:worker']);
  });

});
