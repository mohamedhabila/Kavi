import { requireE2ePairedRunId } from '../../scripts/lib/e2ePairedRunId';

describe('paired E2E run ID contract', () => {
  it('accepts the 128-character boundary', () => {
    const runId = `r${'x'.repeat(127)}`;
    expect(requireE2ePairedRunId(runId)).toBe(runId);
  });

  it('rejects identifiers longer than 128 characters', () => {
    expect(() => requireE2ePairedRunId(`r${'x'.repeat(128)}`)).toThrow(
      'bounded path-free identifier',
    );
  });

  it.each(['../escape', 'run/id', ' run-id', 'run-id ', '.', '..', 'UPPER']) (
    'rejects non-canonical identifier %p',
    (runId) => {
      expect(() => requireE2ePairedRunId(runId)).toThrow('bounded path-free identifier');
    },
  );
});
