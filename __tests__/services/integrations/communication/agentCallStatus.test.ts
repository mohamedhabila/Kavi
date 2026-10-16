const mockGetBlandCall = jest.fn();
jest.mock('../../../../src/services/integrations/communication/blandClient', () => ({
  getBlandCall: (...args: unknown[]) => mockGetBlandCall(...args),
}));

import {
  followAgentCall,
  reportFromBlandCall,
  waitSecondsFrom,
} from '../../../../src/services/integrations/communication/agentCallStatus';

const ENDED = {
  call_id: 'c-123456789',
  completed: true,
  status: 'completed',
  queue_status: 'complete',
  answered_by: 'human',
  call_ended_by: 'ASSISTANT',
  call_length: 1.8,
  price: 0.25,
  summary: 'Booked a table for two at 8 pm under Sam Lee.',
  recording_url: 'https://recordings.bland.ai/c-123456789.mp3',
  transcripts: [
    { id: 1, user: 'user', text: 'Chez Marie, bonsoir.' },
    { id: 2, user: 'assistant', text: 'Bonjour, ici Kavi…' },
    { id: 3, user: 'robot', text: 'Call connected' },
    { id: 4, user: 'agent-action', text: 'Ended call' },
    { id: 5, user: 'user', text: '  ' },
  ],
  error_message: null,
};

describe('reportFromBlandCall', () => {
  it('reports how an ended call went, with only the spoken lines', () => {
    expect(reportFromBlandCall('c-123456789', ENDED)).toEqual({
      status: 'ended',
      callId: 'c-123456789',
      outcome: 'completed',
      queueStatus: 'complete',
      answeredBy: 'human',
      endedBy: 'ASSISTANT',
      minutes: 1.8,
      priceUsd: 0.25,
      summary: 'Booked a table for two at 8 pm under Sam Lee.',
      transcript: [
        { speaker: 'them', text: 'Chez Marie, bonsoir.' },
        { speaker: 'kavi', text: 'Bonjour, ici Kavi…' },
      ],
      recordingUrl: 'https://recordings.bland.ai/c-123456789.mp3',
    });
  });

  it('reports a call still going, and a call that never went out', () => {
    expect(
      reportFromBlandCall('c-1', { completed: false, status: 'unknown', queue_status: 'started' }),
    ).toEqual({ status: 'in_progress', callId: 'c-1', queueStatus: 'started', transcript: [] });
    expect(
      reportFromBlandCall('c-1', {
        completed: false,
        queue_status: 'call_error',
        error_message: 'Invalid destination',
      }),
    ).toMatchObject({ status: 'failed', error: 'Invalid destination' });
    expect(
      reportFromBlandCall('c-1', { ...ENDED, status: 'no-answer', answered_by: 'no-answer' }),
    ).toMatchObject({ status: 'ended', outcome: 'no-answer', answeredBy: 'no-answer' });
  });

  it('keeps the newest lines of a long call, bounded, and says how many it left out', () => {
    const transcripts = Array.from({ length: 100 }, (_, index) => ({
      user: index % 2 ? 'assistant' : 'user',
      text: `line ${index} ${'x'.repeat(600)}`,
    }));

    const report = reportFromBlandCall('c-1', {
      completed: true,
      status: 'completed',
      transcripts,
    });
    const chars = report.transcript.reduce((sum, line) => sum + line.text.length, 0);

    expect(report.transcript.at(-1)!.text.startsWith('line 99 ')).toBe(true);
    expect(report.transcript.every((line) => line.text.length <= 500)).toBe(true);
    expect(chars).toBeLessThanOrEqual(8_000);
    expect(report.transcriptLinesOmitted).toBe(100 - report.transcript.length);
  });

  it('drops a recording link that is not https', () => {
    expect(
      reportFromBlandCall('c-1', { ...ENDED, recording_url: 'http://x.example/a.mp3' }),
    ).not.toHaveProperty('recordingUrl');
  });
});

describe('followAgentCall', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetBlandCall.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('waits for the call to end, checking less often as it goes', async () => {
    const going = { completed: false, queue_status: 'started' };
    mockGetBlandCall
      .mockResolvedValueOnce(going)
      .mockResolvedValueOnce(going)
      .mockResolvedValueOnce(going)
      .mockResolvedValueOnce(ENDED);

    const pending = followAgentCall('c-123456789', 60);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockGetBlandCall).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(7_500);
    expect(mockGetBlandCall).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(11_250);

    await expect(pending).resolves.toMatchObject({ status: 'ended', outcome: 'completed' });
    expect(mockGetBlandCall).toHaveBeenCalledTimes(4);
  });

  it('returns the latest report when the wait runs out, or at once for a wait of 0', async () => {
    mockGetBlandCall.mockResolvedValue({ completed: false, queue_status: 'started' });

    await expect(followAgentCall('c-1', 0)).resolves.toMatchObject({ status: 'in_progress' });
    expect(mockGetBlandCall).toHaveBeenCalledTimes(1);

    const pending = followAgentCall('c-1', 10);
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ status: 'in_progress' });
    expect(mockGetBlandCall).toHaveBeenCalledTimes(1 + 3);
  });

  it('stops waiting when the run is stopped', async () => {
    mockGetBlandCall.mockResolvedValue({ completed: false, queue_status: 'started' });
    const run = new AbortController();

    const pending = followAgentCall('c-1', 120, run.signal);
    await jest.advanceTimersByTimeAsync(1_000);
    run.abort();

    await expect(pending).resolves.toMatchObject({ status: 'in_progress' });
    expect(mockGetBlandCall).toHaveBeenCalledTimes(1);
  });

  it('bounds the wait', () => {
    expect(waitSecondsFrom(undefined)).toBe(60);
    expect(waitSecondsFrom('abc')).toBe(60);
    expect(waitSecondsFrom(-5)).toBe(0);
    expect(waitSecondsFrom(900)).toBe(120);
  });
});
