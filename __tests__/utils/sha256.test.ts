import { sha256HexUtf8 } from '../../src/utils/sha256';
import { sha256HexUtf8Async } from '../../src/utils/sha256Async';

describe('synchronous SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['hello world', 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'],
  ])('matches the known digest for %j', (value, expected) => {
    expect(sha256HexUtf8(value)).toBe(expected);
  });

  it('matches the byte-oriented async digest', async () => {
    const domainSeparated = 'kavi.example.v1\u0000execution-run-withdrawal-1';
    await expect(sha256HexUtf8Async(domainSeparated)).resolves.toBe(sha256HexUtf8(domainSeparated));

    const unicode = 'Kavi remembers across conversations 🧠';
    await expect(sha256HexUtf8Async(unicode)).resolves.toBe(sha256HexUtf8(unicode));
  });

  it('hashes bytes after embedded NUL code points', async () => {
    const left = 'tool-effect-dispatch-identity-v1\u0000left';
    const right = 'tool-effect-dispatch-identity-v1\u0000right';

    await expect(sha256HexUtf8Async(left)).resolves.toBe(sha256HexUtf8(left));
    await expect(sha256HexUtf8Async(right)).resolves.toBe(sha256HexUtf8(right));
    await expect(sha256HexUtf8Async(left)).resolves.not.toBe(sha256HexUtf8(right));
  });
});
