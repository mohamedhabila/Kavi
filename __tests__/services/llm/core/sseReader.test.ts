import { iterateSseData } from '../../../../src/services/llm/core/streaming/sseReader';

describe('iterateSseData', () => {
  it('aborts a pending stream read', async () => {
    const abortController = new AbortController();
    const cancel = jest.fn().mockResolvedValue(undefined);
    const releaseLock = jest.fn();
    const read = jest.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}));
    const response = {
      body: {
        getReader: () => ({
          read,
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response;

    const iterator = iterateSseData(response, abortController.signal);
    const pendingRead = iterator.next();

    abortController.abort();

    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
