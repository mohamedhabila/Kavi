import {
  areBlockingGoalsStructurallyComplete,
  buildMissingRequiredEvidenceLabels,
  evaluateGoalEvidenceGaps,
  formatModelAuthoredSuccessCriteriaFormsDescription,
  formatSuccessCriteriaFormsDescription,
  isRecognizedSuccessCriterionForm,
  isSuccessCriterionMet,
  resolveSuccessCriterionSurfaceHints,
} from '../../../src/engine/goals/completionEvidence';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { createGoal } from '../../../src/engine/goals/types';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

function contractIdentity(toolName: string): ToolEffectReceipt['contractIdentity'] {
  const digest = `sha256:${'5'.repeat(64)}` as const;
  return {
    kind: 'code_owned',
    version: 1,
    toolName,
    schemaDigest: digest,
    capabilityContractDigest: digest,
    workflowContractDigest: digest,
    effectContractDigest: digest,
    executionPolicyDigest: digest,
  };
}

function verifiedArtifactEvidence(
  path = 'artifacts/out.txt',
  digest = `sha256:${'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}` as const,
): string {
  return buildToolEffectReceiptEvidence({
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'call-write',
    toolName: 'write_file',
    executionRunId: 'execution-run-1',
    contractIdentity: contractIdentity('write_file'),
    transportState: 'returned',
    effectKind: 'artifact.write',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: `sha256:${'1'.repeat(64)}`,
    resultDigest: `sha256:${'2'.repeat(64)}`,
    resource: { kind: 'workspace_file', id: path, digest },
    recordedAt: 1,
  } satisfies ToolEffectReceipt);
}

function completedExecutionEvidence(toolName: 'javascript' | 'python' = 'python'): string {
  return buildToolEffectReceiptEvidence({
    version: 2,
    receiptId: `ter_${'b'.repeat(32)}`,
    toolCallId: 'call-code',
    toolName,
    executionRunId: 'execution-run-1',
    contractIdentity: contractIdentity(toolName),
    transportState: 'returned',
    executionState: 'completed',
    effectKind: 'compute.execute',
    effectState: 'unknown',
    verificationState: 'unverified',
    requestDigest: `sha256:${'3'.repeat(64)}`,
    resultDigest: `sha256:${'4'.repeat(64)}`,
    recordedAt: 1,
  } satisfies ToolEffectReceipt);
}

describe('completionEvidence', () => {
  it('documents supported structural criterion forms', () => {
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.tool:<name>');
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.artifact:<path>');
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.count:<n>');
    // Deliberately not `<path>`: that operand is a dotted field path inside a JSON
    // payload, while every sibling form takes a workspace file path in the same
    // position. Traced live, a goal named the file there instead of the field, matched
    // nothing, and — criteria being monotonic — could never be withdrawn.
    expect(formatSuccessCriteriaFormsDescription()).toContain(
      'evidence.json_field:<json.field.path>:<value>',
    );
    expect(formatSuccessCriteriaFormsDescription()).toContain(
      'evidence.file_hash:<path>:<algo>[:<hex>]',
    );
    expect(formatSuccessCriteriaFormsDescription()).toContain('evidence.exit_code:<n>');
    expect(formatSuccessCriteriaFormsDescription()).toContain(
      'evidence.effect:<closed-json-contract>',
    );
  });

  it('reserves request-bound effect criteria for code-owned repair contracts', () => {
    expect(formatModelAuthoredSuccessCriteriaFormsDescription()).not.toContain('evidence.effect:');
  });

  it('recognizes only formal structural success criterion forms', () => {
    expect(isRecognizedSuccessCriterionForm('evidence.min:1')).toBe(true);
    expect(isRecognizedSuccessCriterionForm('evidence.prefix:worker')).toBe(true);
    expect(isRecognizedSuccessCriterionForm('evidence.json_field:status:ok')).toBe(true);
    expect(isRecognizedSuccessCriterionForm('evidence.exit_code:1')).toBe(false);
    expect(isRecognizedSuccessCriterionForm('evidence.file_hash:a.txt:md5')).toBe(false);
    expect(isRecognizedSuccessCriterionForm('evidence.file_hash:a.txt:sha256:abcd')).toBe(false);
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
      evidence: ['write_file:completed', verifiedArtifactEvidence()],
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
      evidence: [verifiedArtifactEvidence()],
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
      evidence: ['read_file:{"exit_code":0}'],
    });
    expect(evaluateGoalEvidenceGaps([unmet])).toEqual([
      { goalId: 'g1', criterionId: 'evidence.exit_code:0' },
    ]);

    const met = createGoal({
      id: 'g1',
      title: 'Run',
      status: 'active',
      successCriteria: ['evidence.exit_code:0'],
      evidence: [completedExecutionEvidence()],
    });
    expect(isSuccessCriterionMet(met, 'evidence.exit_code:0')).toBe(true);
    expect(
      isSuccessCriterionMet(
        { ...met, evidence: ['web_fetch:effect_receipt:{"executionState":"completed"}'] },
        'evidence.exit_code:0',
      ),
    ).toBe(false);
  });

  it('revalidates completed blocking goals at terminal authority boundaries', () => {
    const satisfied = createGoal({
      id: 'satisfied',
      title: 'Persist the artifact',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:artifacts/out.txt'],
      evidence: [verifiedArtifactEvidence()],
    });
    const missingEvidence = { ...satisfied, id: 'missing-evidence', evidence: [] };
    const missingCriteria = { ...satisfied, id: 'missing-criteria', successCriteria: [] };

    expect(areBlockingGoalsStructurallyComplete([satisfied])).toBe(true);
    expect(areBlockingGoalsStructurallyComplete([missingEvidence])).toBe(false);
    expect(areBlockingGoalsStructurallyComplete([missingCriteria])).toBe(false);
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

describe('workspace resource identity in evidence criteria', () => {
  // The receipt always carries the path the workspace actually wrote, which every
  // write normalizes through sanitizeWorkspaceRelativePath. The criterion token is
  // typed by the model and is not normalized. Raw string equality between the two
  // made a goal permanently uncompletable whenever the spellings differed only in
  // form, even though the write succeeded and the evidence was routed.
  // Criterion tokens are raw model text, so every one of these spellings can arrive.
  const EQUIVALENT_CRITERION_SPELLINGS = [
    './saturn-moons.md',
    '/saturn-moons.md',
    'saturn-moons.md',
    '\\saturn-moons.md',
    '  saturn-moons.md  ',
  ];

  // Receipt ids are narrower: the evidence encoding rejects untrimmed ids outright
  // (see the invariant pinned below), so padding can never reach this side.
  const EQUIVALENT_RECEIPT_SPELLINGS = [
    './saturn-moons.md',
    '/saturn-moons.md',
    'saturn-moons.md',
    '\\saturn-moons.md',
  ];

  it.each(EQUIVALENT_CRITERION_SPELLINGS)(
    'satisfies evidence.artifact when the criterion is written as %s',
    (criterionPath) => {
      const goal = createGoal({
        id: 'g1',
        title: 'Research',
        status: 'active',
        successCriteria: [`evidence.artifact:${criterionPath}`],
        evidence: [verifiedArtifactEvidence('saturn-moons.md')],
      });

      expect(isSuccessCriterionMet(goal, `evidence.artifact:${criterionPath}`)).toBe(true);
    },
  );

  it.each(EQUIVALENT_RECEIPT_SPELLINGS)(
    'satisfies evidence.artifact when the receipt records the path as %s',
    (receiptPath) => {
      const goal = createGoal({
        id: 'g1',
        title: 'Research',
        status: 'active',
        successCriteria: ['evidence.artifact:saturn-moons.md'],
        evidence: [verifiedArtifactEvidence(receiptPath)],
      });

      expect(isSuccessCriterionMet(goal, 'evidence.artifact:saturn-moons.md')).toBe(true);
    },
  );

  it('still rejects a receipt for a genuinely different workspace file', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [verifiedArtifactEvidence('jupiter-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.artifact:saturn-moons.md')).toBe(false);
  });

  it('still rejects a nested path that shares only its file name', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [verifiedArtifactEvidence('reports/saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.artifact:saturn-moons.md')).toBe(false);
  });

  it('rejects a receipt whose resource id is not already trimmed', () => {
    // Pinned because the criterion side deliberately tolerates padding while this
    // side must not: if the encoding ever started accepting untrimmed ids, two
    // different receipts could claim the same file.
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:saturn-moons.md'],
      evidence: [verifiedArtifactEvidence('  saturn-moons.md  ')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.artifact:saturn-moons.md')).toBe(false);
  });

  it('agrees with the workspace on traversal segments being stripped, not resolved', () => {
    // The workspace sanitizer removes `../` rather than popping the preceding
    // segment, so `notes/../x.md` genuinely writes to `notes/x.md`. Both sides run
    // the same sanitizer, so the criterion agrees with where the file actually went
    // instead of where the spelling suggests it went.
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:notes/../saturn-moons.md'],
      evidence: [verifiedArtifactEvidence('notes/saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.artifact:notes/../saturn-moons.md')).toBe(true);
    expect(isSuccessCriterionMet(goal, 'evidence.artifact:saturn-moons.md')).toBe(false);
  });

  it('rejects an artifact criterion whose token normalizes to nothing', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.artifact:./'],
      evidence: [verifiedArtifactEvidence('saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.artifact:./')).toBe(false);
  });

  it('applies the same normalization to evidence.file_hash', () => {
    const digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: [`evidence.file_hash:./saturn-moons.md:sha256:${digest}`],
      evidence: [verifiedArtifactEvidence('saturn-moons.md', `sha256:${digest}`)],
    });

    expect(
      isSuccessCriterionMet(goal, `evidence.file_hash:./saturn-moons.md:sha256:${digest}`),
    ).toBe(true);
  });
});

describe('tool identity in evidence criteria', () => {
  // Effect-free tools contribute a plain `<toolName>:<summary>` evidence string;
  // effectful tools contribute only a structured receipt. Matching by string prefix
  // alone recognised the first kind and silently missed the second, so no effectful
  // tool in any family could satisfy evidence.tool — the goal stayed open however
  // many times the model did exactly what the criterion asked for.
  it('satisfies evidence.tool from an effectful tool receipt', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.tool:write_file'],
      evidence: [verifiedArtifactEvidence('saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.tool:write_file')).toBe(true);
  });

  it('satisfies evidence.prefix from an effectful tool receipt', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.prefix:write_file'],
      evidence: [verifiedArtifactEvidence('saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.prefix:write_file')).toBe(true);
  });

  it('still satisfies evidence.tool from a plain effect-free evidence string', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.tool:web_search'],
      evidence: ['web_search:found 3 sources'],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.tool:web_search')).toBe(true);
  });

  it('does not credit a receipt from a different tool', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.tool:file_edit'],
      evidence: [verifiedArtifactEvidence('saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.tool:file_edit')).toBe(false);
  });

  it('does not credit a tool name that is merely a prefix of the receipt tool', () => {
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.tool:write'],
      evidence: [verifiedArtifactEvidence('saturn-moons.md')],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.tool:write')).toBe(false);
  });

  it('does not credit a failed effect', () => {
    const failedReceipt = buildToolEffectReceiptEvidence({
      version: 2,
      receiptId: `ter_${'c'.repeat(32)}`,
      toolCallId: 'call-write',
      toolName: 'write_file',
      executionRunId: 'execution-run-1',
      contractIdentity: contractIdentity('write_file'),
      transportState: 'returned',
      effectKind: 'artifact.write',
      effectState: 'failed',
      verificationState: 'unverified',
      requestDigest: `sha256:${'1'.repeat(64)}`,
      resultDigest: `sha256:${'2'.repeat(64)}`,
      resource: { kind: 'workspace_file', id: 'saturn-moons.md' },
      recordedAt: 1,
    } satisfies ToolEffectReceipt);
    const goal = createGoal({
      id: 'g1',
      title: 'Research',
      status: 'active',
      successCriteria: ['evidence.tool:write_file'],
      evidence: [failedReceipt],
    });

    expect(isSuccessCriterionMet(goal, 'evidence.tool:write_file')).toBe(false);
  });
});
