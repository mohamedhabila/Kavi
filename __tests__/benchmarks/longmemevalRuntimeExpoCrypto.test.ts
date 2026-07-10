import { createHash } from 'node:crypto';

import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  randomUUID,
} from '../../benchmarks/longmemeval_v2/runtimeExpoCryptoStub';

describe('LongMemEval runtime Expo crypto boundary', () => {
  it('matches the product SHA-256 contract without loading Expo', async () => {
    const input = 'memory_conversation\0conversation-42';

    await expect(digestStringAsync(CryptoDigestAlgorithm.SHA256, input)).resolves.toBe(
      createHash('sha256').update(input, 'utf8').digest('hex'),
    );
  });

  it('rejects algorithms outside the isolated runtime contract', async () => {
    await expect(digestStringAsync('SHA-1', 'value')).rejects.toThrow(
      'Unsupported benchmark digest algorithm',
    );
  });

  it('returns structural UUIDs for runtime-owned records', () => {
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});
