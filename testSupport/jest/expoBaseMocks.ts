// Mock expo modules
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => {
  const { createHash } = require('crypto');
  return {
    CryptoDigestAlgorithm: {
      SHA256: 'SHA-256',
    },
    digestStringAsync: jest.fn(async (algorithm: string, value: string) => {
      if (algorithm !== 'SHA-256') {
        throw new Error(`Unsupported digest algorithm: ${algorithm}`);
      }
      return createHash('sha256').update(value).digest('hex');
    }),
  };
});
