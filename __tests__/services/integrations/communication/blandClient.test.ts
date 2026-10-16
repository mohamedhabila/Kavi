const mockGetSecure = jest.fn();
jest.mock('../../../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: unknown[]) => mockGetSecure(...args),
}));

import {
  BlandError,
  getBlandCall,
  queueBlandCall,
  stopBlandCall,
} from '../../../../src/services/integrations/communication/blandClient';

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

async function failureOf(promise: Promise<unknown>): Promise<BlandError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BlandError) return error;
    throw error;
  }
  throw new Error('expected a BlandError');
}

beforeEach(() => {
  mockGetSecure.mockReset();
  mockGetSecure.mockResolvedValue(' bland-key ');
});

describe('Bland client', () => {
  it("queues a call with the person's key in the authorization header", async () => {
    const fetchImpl = jest.fn(async () =>
      reply(200, {
        status: 'success',
        message: 'Call successfully queued.',
        call_id: 'c-123456789',
      }),
    );

    await expect(
      queueBlandCall(
        { phone_number: '+15550100' },
        undefined,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBe('c-123456789');
    expect(mockGetSecure).toHaveBeenCalledWith('BLAND_API_KEY');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: { authorization: 'bland-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: '+15550100' }),
      signal: expect.any(Object),
    });
  });

  it('reads and stops a call by its id, escaped into the path', async () => {
    const fetchImpl = jest.fn(async () =>
      reply(200, { status: 'success', message: 'Call ended successfully.' }),
    );

    await getBlandCall('a/b', undefined, fetchImpl as unknown as typeof fetch);
    await expect(
      stopBlandCall('c-1', undefined, fetchImpl as unknown as typeof fetch),
    ).resolves.toBe('Call ended successfully.');
    expect(fetchImpl.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method])).toEqual([
      ['https://api.bland.ai/v1/calls/a%2Fb', 'GET'],
      ['https://api.bland.ai/v1/calls/c-1/stop', 'POST'],
    ]);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).body).toBeUndefined();
  });

  it('says the key is missing without asking Bland', async () => {
    mockGetSecure.mockResolvedValue('   ');
    const fetchImpl = jest.fn();

    const error = await failureOf(queueBlandCall({}, undefined, fetchImpl));

    expect(error.kind).toBe('not_configured');
    expect(error.message).toContain('setup_guide with topic phone_calls');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      400,
      {
        status: 'error',
        message: 'Invalid parameters',
        errors: ['Missing required parameter: task.'],
      },
      'invalid_request',
      'Missing required parameter: task.',
    ],
    [
      400,
      { status: 'DNC Error', message: 'Number is on the do-not-call list' },
      'invalid_request',
      'DNC Error',
    ],
    [
      401,
      { data: null, errors: [{ error: 'AUTH_FAILURE', message: 'Unauthorized' }] },
      'auth',
      'Unauthorized',
    ],
    [
      402,
      { status: 'error', message: 'Insufficient balance.' },
      'billing',
      'Insufficient balance.',
    ],
    [403, { status: 'error', message: 'Account flagged' }, 'blocked', 'Account flagged'],
    [404, '', 'not_found', 'no such call'],
    [429, { status: 'error', message: 'Rate limit exceeded' }, 'rate_limited', '10 seconds'],
    [500, 'Error triggering call', 'provider', 'Error triggering call'],
  ])('maps a %i answer to what Kavi can do about it', async (status, body, kind, said) => {
    const error = await failureOf(
      queueBlandCall({}, undefined, (async () => reply(status, body)) as unknown as typeof fetch),
    );

    expect(error).toMatchObject({ kind, httpStatus: status });
    expect(error.message).toContain(said);
  });

  it('treats a success answer without a call id as not queued', async () => {
    const error = await failureOf(
      queueBlandCall({}, undefined, (async () =>
        reply(200, { status: 'error', message: 'Bad number' })) as unknown as typeof fetch),
    );

    expect(error).toMatchObject({ kind: 'provider' });
    expect(error.message).toContain('Bad number');
  });

  it('tells a network failure from a timeout and from a stopped run', async () => {
    const network = await failureOf(
      getBlandCall('c-1', undefined, (async () => {
        throw new Error('Network request failed');
      }) as unknown as typeof fetch),
    );
    expect(network).toMatchObject({ kind: 'network' });

    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    jest.useFakeTimers();
    try {
      const timedOut = failureOf(
        getBlandCall('c-1', undefined, hanging as unknown as typeof fetch),
      );
      await jest.advanceTimersByTimeAsync(15_000);
      await expect(timedOut).resolves.toMatchObject({
        kind: 'timeout',
        message: 'Bland did not answer in time.',
      });

      const run = new AbortController();
      const stopped = failureOf(
        getBlandCall('c-1', run.signal, hanging as unknown as typeof fetch),
      );
      await jest.advanceTimersByTimeAsync(0);
      run.abort();
      await expect(stopped).resolves.toMatchObject({
        kind: 'timeout',
        message: 'The request to Bland was stopped.',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
