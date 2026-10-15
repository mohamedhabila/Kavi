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
    digest: jest.fn(async (algorithm: string, value: ArrayBuffer | ArrayBufferView) => {
      if (algorithm !== 'SHA-256') {
        throw new Error(`Unsupported digest algorithm: ${algorithm}`);
      }
      const input = ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : Buffer.from(value);
      return Uint8Array.from(createHash('sha256').update(input).digest()).buffer;
    }),
  };
});

// The phone's speech recognizer. Tests drive it with `__emitSpeechRecognitionEvent`.
jest.mock('expo-speech-recognition', () => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    ExpoSpeechRecognitionModule: {
      isRecognitionAvailable: jest.fn(() => true),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
      addListener: jest.fn((name: string, listener: (event: unknown) => void) => {
        const named = listeners.get(name) ?? new Set();
        named.add(listener);
        listeners.set(name, named);
        return { remove: () => named.delete(listener) };
      }),
    },
    __emitSpeechRecognitionEvent: (name: string, event: unknown = null) => {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(event);
    },
    __speechRecognitionListenerCount: () =>
      [...listeners.values()].reduce((count, named) => count + named.size, 0),
  };
});
