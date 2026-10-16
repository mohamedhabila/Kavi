import { File, Paths } from 'expo-file-system';

import {
  assertLocalLlmDownloadFits,
  LOCAL_LLM_DOWNLOAD_RESERVE_BYTES,
} from '../../../src/services/localLlm/storageCheck';

const GB = 1024 * 1024 * 1024;

function setAvailable(bytes: number | (() => number) | undefined): void {
  Object.defineProperty(Paths, 'availableDiskSpace', {
    configurable: true,
    get: typeof bytes === 'function' ? bytes : () => bytes,
  });
}

afterEach(() => {
  delete (Paths as { availableDiskSpace?: number }).availableDiskSpace;
  (jest.requireMock('expo-file-system') as { __resetStore?: () => void }).__resetStore?.();
});

describe('assertLocalLlmDownloadFits', () => {
  const partialFile = () => new File(Paths.document, 'gemma.litertlm.download');

  it('lets a download through that leaves the reserve free', () => {
    setAvailable(2.5 * GB + LOCAL_LLM_DOWNLOAD_RESERVE_BYTES);

    expect(() =>
      assertLocalLlmDownloadFits({
        modelName: 'Gemma 4 E2B',
        expectedSizeBytes: 2.5 * GB,
        partialFile: partialFile(),
      }),
    ).not.toThrow();
  });

  it('stops a download that would fill the phone, saying how much space it needs', () => {
    setAvailable(1.2 * GB);

    expect(() =>
      assertLocalLlmDownloadFits({
        modelName: 'Gemma 4 E2B',
        expectedSizeBytes: 2.5 * GB,
        partialFile: partialFile(),
      }),
    ).toThrow('Downloading Gemma 4 E2B needs 3.0 GB free and this phone has 1.2 GB.');
  });

  it('counts only what a resumed download still has to fetch', () => {
    const partial = partialFile();
    partial.write('x');
    (
      jest.requireMock('expo-file-system') as {
        __setFileSize?: (uri: string, size: number) => void;
      }
    ).__setFileSize?.(partial.uri, 2 * GB);
    setAvailable(0.5 * GB + LOCAL_LLM_DOWNLOAD_RESERVE_BYTES);

    expect(() =>
      assertLocalLlmDownloadFits({
        modelName: 'Gemma 4 E2B',
        expectedSizeBytes: 2.5 * GB,
        partialFile: partial,
      }),
    ).not.toThrow();
  });

  it('lets the download try when the phone cannot say how much space it has', () => {
    for (const available of [
      undefined,
      0,
      Number.NaN,
      () => {
        throw new Error('unavailable');
      },
    ]) {
      setAvailable(available as never);
      expect(() =>
        assertLocalLlmDownloadFits({
          modelName: 'Gemma 4 E2B',
          expectedSizeBytes: 2.5 * GB,
          partialFile: partialFile(),
        }),
      ).not.toThrow();
    }
  });
});
