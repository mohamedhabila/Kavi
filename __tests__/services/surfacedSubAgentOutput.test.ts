import {
  buildSurfacedSubAgentOutputToolResultSummary,
  createSurfacedSubAgentOutputPayload,
  parseSurfacedSubAgentOutputResult,
  SURFACED_SUB_AGENT_OUTPUT_GUIDANCE,
} from '../../src/services/agents/surfacedSubAgentOutput';

describe('surfacedSubAgentOutput', () => {
  it('surfaces the full worker output by default', () => {
    const result = createSurfacedSubAgentOutputPayload({
      sessionId: 'worker-1',
      sourceOutput: 'Final worker answer',
    });

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      status: 'surfaced',
      sessionId: 'worker-1',
      output: 'Final worker answer',
      outputLength: 'Final worker answer'.length,
      sourceOutputLength: 'Final worker answer'.length,
      selectionApplied: false,
      usedFullOutput: true,
      guidance: SURFACED_SUB_AGENT_OUTPUT_GUIDANCE,
    });
  });

  it('supports bounded worker output plus prefix and suffix wrapping', () => {
    const result = createSurfacedSubAgentOutputPayload({
      sessionId: 'worker-2',
      sourceOutput: 'Intro\n<answer>Only this part</answer>\nFooter',
      options: {
        prefix: 'Summary:\n',
        suffix: '\nThanks.',
        startMarker: '<answer>',
        endMarker: '</answer>',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual(
      expect.objectContaining({
        sessionId: 'worker-2',
        output: 'Summary:\nOnly this part\nThanks.',
        selectionApplied: true,
        usedFullOutput: false,
        startMarker: '<answer>',
        endMarker: '</answer>',
      }),
    );
  });

  it('falls back to the full output when markers are missing and fallback is enabled', () => {
    const result = createSurfacedSubAgentOutputPayload({
      sessionId: 'worker-3',
      sourceOutput: 'Final worker answer',
      options: {
        startMarker: '<missing>',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual(
      expect.objectContaining({
        output: 'Final worker answer',
        selectionApplied: false,
        usedFullOutput: true,
        selectionFallbackReason: 'Start marker not found: <missing>',
      }),
    );
  });

  it('returns an error when markers are missing and fallback is disabled', () => {
    const result = createSurfacedSubAgentOutputPayload({
      sessionId: 'worker-4',
      sourceOutput: 'Final worker answer',
      options: {
        startMarker: '<missing>',
        fallbackToFullOutput: false,
      },
    });

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(
      'Unable to surface worker output because startMarker was not found: <missing>',
    );
  });

  it('parses valid surfaced tool results and ignores unrelated payloads', () => {
    const payload = JSON.stringify({
      status: 'surfaced',
      sessionId: 'worker-5',
      output: 'Visible answer',
      outputLength: 14,
      sourceOutputLength: 14,
      selectionApplied: false,
      usedFullOutput: true,
      guidance: SURFACED_SUB_AGENT_OUTPUT_GUIDANCE,
    });

    expect(parseSurfacedSubAgentOutputResult(payload)).toEqual(
      expect.objectContaining({
        sessionId: 'worker-5',
        output: 'Visible answer',
      }),
    );
    expect(parseSurfacedSubAgentOutputResult('{"status":"ok"}')).toBeUndefined();
    expect(parseSurfacedSubAgentOutputResult(undefined)).toBeUndefined();
  });

  it('builds a delivery acknowledgement for persisted tool results', () => {
    expect(
      buildSurfacedSubAgentOutputToolResultSummary({
        status: 'surfaced',
        sessionId: 'worker-6',
        output: 'Visible answer',
        outputLength: 14,
        sourceOutputLength: 14,
        selectionApplied: false,
        usedFullOutput: true,
        guidance: SURFACED_SUB_AGENT_OUTPUT_GUIDANCE,
      }),
    ).toBe(
      'Full worker output from worker-6 was surfaced to the user in the assistant response.',
    );
  });
});