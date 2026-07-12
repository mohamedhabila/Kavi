import * as Crypto from 'expo-crypto';
import { hashVerifiedProcedureProvenanceSync } from '../../src/services/memory/verifiedProcedure/provenanceHash';
import { sha256HexUtf8 } from '../../src/utils/sha256';

describe('synchronous SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['hello world', 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'],
  ])('matches the known digest for %j', (value, expected) => {
    expect(sha256HexUtf8(value)).toBe(expected);
  });

  it('matches Expo Crypto for verified-procedure provenance input', async () => {
    const sourceRunId = 'execution-run-withdrawal-1';
    const expected = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `kavi.verified-procedure.source-run.v1\u0000${sourceRunId}`,
    );

    expect(hashVerifiedProcedureProvenanceSync('source-run', sourceRunId)).toBe(
      expected.toLowerCase(),
    );

    const unicode = 'Kavi remembers across conversations 🧠';
    await expect(
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, unicode),
    ).resolves.toBe(sha256HexUtf8(unicode));
  });
});
