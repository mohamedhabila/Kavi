import {
  normalizeJavaScriptToolResult,
  normalizePythonToolResult,
} from '../../src/engine/tools/resultNormalization/runtimeResult';

function parseResult(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

describe('code execution result normalization', () => {
  it('records a completed JavaScript interpreter run without claiming an observed mutation', () => {
    expect(parseResult(normalizeJavaScriptToolResult({ success: true, output: '42' }))).toEqual({
      summary: 'JavaScript execution completed.',
      status: 'completed',
      workspaceMutationState: 'none_observed',
      output: '42',
    });
  });

  it('records JavaScript workspace mutations without presenting them as verification', () => {
    expect(
      parseResult(
        normalizeJavaScriptToolResult({
          success: true,
          output: '',
          files: [{ path: 'result.txt', content: 'done' }],
          deletedPaths: ['old.txt'],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'completed',
        workspaceMutationState: 'applied',
        fileCount: 1,
        files: [expect.objectContaining({ path: 'result.txt' })],
        deletedCount: 1,
        deletedPaths: ['old.txt'],
      }),
    );
  });

  it('keeps JavaScript logs and interpreter failure separate', () => {
    expect(
      parseResult(
        normalizeJavaScriptToolResult({
          success: false,
          output: 'started',
          error: 'Error: boom',
        }),
      ),
    ).toEqual({
      status: 'failed',
      isError: true,
      summary: 'JavaScript execution failed.',
      error: 'Error: boom',
      failureKind: 'execution_failed',
      workspaceMutationState: 'unknown',
      output: 'started',
    });
  });

  it('records a completed Python interpreter run without claiming an observed mutation', () => {
    expect(parseResult(normalizePythonToolResult({ success: true, output: '42' }))).toEqual({
      summary: 'Python execution completed.',
      status: 'completed',
      workspaceMutationState: 'none_observed',
      output: '42',
    });
  });

  it('records Python workspace mutations separately from interpreter completion', () => {
    expect(
      parseResult(
        normalizePythonToolResult({
          success: true,
          output: 'saved',
          files: [{ path: 'result.txt', contentBase64: 'ZG9uZQ==' }],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'completed',
        workspaceMutationState: 'applied',
        output: 'saved',
        fileCount: 1,
        files: [{ path: 'result.txt', size: 4 }],
      }),
    );
  });

  it.each([
    ['JavaScript', normalizeJavaScriptToolResult],
    ['Python', normalizePythonToolResult],
  ] as const)('keeps %s completion truth when workspace persistence fails', (_label, normalize) => {
    expect(
      parseResult(
        normalize({
          success: false,
          output: 'computed',
          error: 'storage unavailable',
          failureKind: 'workspace_persistence_failed',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'effect_failed',
        isError: true,
        failureKind: 'workspace_persistence_failed',
        workspaceMutationState: 'unknown',
        output: 'computed',
      }),
    );
  });

  it('classifies timeout from the code-owned failure kind instead of error prose', () => {
    const error = 'execution budget exhausted';

    expect(
      parseResult(normalizePythonToolResult({ success: false, error, failureKind: 'timed_out' })),
    ).toEqual(
      expect.objectContaining({
        status: 'timed_out',
        isError: true,
        workspaceMutationState: 'unknown',
        error,
        failureKind: 'timed_out',
      }),
    );
  });

  it.each([
    ['runtime failure', 'Python runtime startup timed out after 30000ms', 'runtime_failed'],
    [
      'user-code failure',
      'AssertionError: expected timeout while parsing input',
      'execution_failed',
    ],
  ] as const)('does not infer timeout from %s prose', (_label, error, failureKind) => {
    expect(parseResult(normalizePythonToolResult({ success: false, error, failureKind }))).toEqual(
      expect.objectContaining({
        status: 'failed',
        isError: true,
        error,
        failureKind,
      }),
    );
  });
});
