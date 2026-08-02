import { createGoal } from '../../src/engine/goals/types';
import {
  CRITICAL_THRESHOLD,
  STAGNANT_PROGRESS_THRESHOLD,
  WARNING_THRESHOLD,
  buildGoalProgressFingerprint,
  buildIterationSemanticProgressFingerprint,
  buildToolMultisetKey,
  detectConsecutiveBlockedPreflightCalls,
  detectLoops,
  detectStagnantProgress,
  hashResult,
  recordIterationProgressSignature,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../../src/engine/loopDetection';

const rec = (
  name: string,
  args: string,
  result?: string,
  status: ToolCallRecord['status'] = 'completed',
): ToolCallRecord => ({
  name,
  arguments: args,
  timestamp: Date.now(),
  status,
  result,
  resultHash: result !== undefined ? hashResult(result) : undefined,
});

describe('blocked preflight retry detection', () => {
  const blocked = (path: string, modelTurnIteration?: number): ToolCallRecord => ({
    ...rec('read_file', JSON.stringify({ path }), 'model_turn_memory_epoch_expired', 'failed'),
    preflightBlockedKind: 'authority_revoked',
    ...(modelTurnIteration === undefined ? {} : { modelTurnIteration }),
  });

  it('does not count distinct sibling rejections as repeated attempts', () => {
    expect(
      detectConsecutiveBlockedPreflightCalls([
        blocked('attachments/one.txt'),
        blocked('attachments/two.txt'),
        blocked('attachments/three.txt'),
      ]),
    ).toEqual({ detected: false });
  });

  it('does not count duplicate sibling rejections from one model turn as retries', () => {
    expect(
      detectConsecutiveBlockedPreflightCalls([
        blocked('attachments/one.txt', 7),
        blocked('attachments/one.txt', 7),
        blocked('attachments/one.txt', 7),
      ]),
    ).toEqual({ detected: false });
  });

  it('detects the same blocked call repeated across distinct model turns', () => {
    expect(
      detectConsecutiveBlockedPreflightCalls([
        blocked('attachments/one.txt', 7),
        blocked('attachments/one.txt', 8),
        blocked('attachments/one.txt', 9),
      ]),
    ).toEqual({
      detected: true,
      kind: 'authority_revoked',
      count: 3,
    });
  });

  it('resets when a mixed turn completed another tool call', () => {
    expect(
      detectConsecutiveBlockedPreflightCalls([
        blocked('attachments/one.txt', 7),
        blocked('attachments/one.txt', 8),
        { ...rec('sessions_spawn', '{}', 'started'), modelTurnIteration: 9 },
        blocked('attachments/one.txt', 9),
      ]),
    ).toEqual({ detected: false });
  });
});

describe('semantic progress detection', () => {
  it('does not call advancing inspection batches stagnant when one batch also has a failure', () => {
    const signatures: IterationProgressSignature[] = [];
    const goalProgressFingerprint = buildGoalProgressFingerprint([
      { id: 'audit', status: 'active', evidence: [] },
    ]);

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, {
        toolMultisetKey: buildToolMultisetKey(['read_file', 'read_file']),
        goalProgressFingerprint,
        activeGoalId: 'audit',
        semanticProgressFingerprint: buildIterationSemanticProgressFingerprint([
          rec(
            'read_file',
            JSON.stringify({ path: 'bundle.txt', offset: index * 8_000 }),
            `chunk-${index}`,
          ),
          rec(
            'read_file',
            JSON.stringify({ path: 'missing.txt', offset: index }),
            'file not found',
            'failed',
          ),
        ]),
      });
    }

    expect(detectStagnantProgress(signatures)).toEqual({ detected: false });
  });

  it('still calls identical inspection batches stagnant', () => {
    const signatures: IterationProgressSignature[] = [];
    const semanticProgressFingerprint = buildIterationSemanticProgressFingerprint([
      rec('read_file', JSON.stringify({ path: 'bundle.txt' }), 'same chunk'),
    ]);
    const entry: IterationProgressSignature = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'audit', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'audit',
      semanticProgressFingerprint,
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
    }

    expect(detectStagnantProgress(signatures)).toEqual({
      detected: true,
      count: STAGNANT_PROGRESS_THRESHOLD,
      multisetKey: 'read_file',
    });
  });

  it('treats progressive chunks from one large file as information progress without goals', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([]),
      activeGoalId: null,
    };

    for (let index = 0; index < CRITICAL_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec(
          'read_file',
          JSON.stringify({ path: 'attachments/guide.md', offset: index * 7_000 }),
          JSON.stringify({ content: `chunk-${index}`, nextOffset: (index + 1) * 7_000 }),
        ),
      );
    }

    expect(detectLoops(history, signatures, { goals: [] })).toEqual({ loopDetected: false });
  });

  it('allows one repeated terminal chunk before warning on a real semantic stall', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['read_file']),
      goalProgressFingerprint: buildGoalProgressFingerprint([]),
      activeGoalId: null,
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec(
          'read_file',
          JSON.stringify({ path: 'attachments/guide.md', offset: index * 7_000 }),
          JSON.stringify({ content: `chunk-${index}`, nextOffset: (index + 1) * 7_000 }),
        ),
      );
    }

    const terminalArgs = JSON.stringify({ path: 'attachments/guide.md', offset: 21_000 });
    const terminalResult = JSON.stringify({ content: 'final chunk', complete: true });
    recordIterationProgressSignature(signatures, entry);
    history.push(rec('read_file', terminalArgs, terminalResult));
    recordIterationProgressSignature(signatures, entry);
    history.push(rec('read_file', terminalArgs, terminalResult));

    expect(detectLoops(history, signatures, { goals: [] })).toEqual({ loopDetected: false });

    recordIterationProgressSignature(signatures, entry);
    history.push(rec('read_file', terminalArgs, terminalResult));

    expect(detectLoops(history, signatures, { goals: [] })).toMatchObject({
      loopDetected: true,
      level: 'warning',
      type: 'generic_repeat',
      count: WARNING_THRESHOLD,
    });
  });

  it.each([
    ['directory traversal', 'list_files'],
    ['open-web research', 'web_search'],
  ])('treats distinct successful %s results as information progress', (_label, toolName) => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey([toolName]),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'research', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'research',
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(
        rec(
          toolName,
          JSON.stringify({ target: `scope-${index}` }),
          JSON.stringify({ items: [`result-${index}`] }),
        ),
      );
    }

    expect(
      detectLoops(history, signatures, {
        goals: [
          createGoal({
            id: 'research',
            title: 'Gather distinct evidence',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: ['Produce a grounded report'],
          }),
        ],
      }),
    ).toEqual({ loopDetected: false });
  });

  it('still detects directory traversal that returns no new information', () => {
    const signatures: IterationProgressSignature[] = [];
    const history: ToolCallRecord[] = [];
    const entry = {
      toolMultisetKey: buildToolMultisetKey(['list_files']),
      goalProgressFingerprint: buildGoalProgressFingerprint([
        { id: 'audit', status: 'active', evidence: [] },
      ]),
      activeGoalId: 'audit',
    };

    for (let index = 0; index < STAGNANT_PROGRESS_THRESHOLD; index += 1) {
      recordIterationProgressSignature(signatures, entry);
      history.push(rec('list_files', JSON.stringify({ path: `missing-${index}` }), '{"items":[]}'));
    }

    expect(detectLoops(history, signatures)).toMatchObject({
      loopDetected: true,
      level: 'warning',
      type: 'stagnant_progress',
      count: STAGNANT_PROGRESS_THRESHOLD,
    });
  });
});
