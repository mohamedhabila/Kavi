import { useCallback, useEffect, useState } from 'react';
import type { LlmProviderConfig } from '../types/provider';
import { getLocalLlmAvailability } from '../services/localLlm/availability';
import { installLocalLlmModel } from '../services/localLlm/install';
import type {
  LocalLlmAvailability,
  LocalLlmModelInstallProgress,
} from '../services/localLlm/types';

type DownloadStatus = 'idle' | 'validating' | 'blocked' | 'downloading' | 'ready' | 'failed';
type DownloadSource = 'existing' | 'downloaded' | null;

interface DownloadState {
  modelId: string | null;
  status: DownloadStatus;
  source: DownloadSource;
  progress: LocalLlmModelInstallProgress | null;
  errorMessage: string | null;
  availability: LocalLlmAvailability | null;
}

const INITIAL_STATE: DownloadState = {
  modelId: null,
  status: 'idle',
  source: null,
  progress: null,
  errorMessage: null,
  availability: null,
};

export function useLocalLlmModelDownload(selectedModelId?: string, isSelectedInstalled = false) {
  const [state, setState] = useState<DownloadState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    setState((current) => {
      if (!selectedModelId) {
        return current.status === 'downloading' ? current : INITIAL_STATE;
      }

      if (current.modelId === selectedModelId && current.status === 'downloading') {
        return current;
      }

      if (current.modelId === selectedModelId && current.status === 'ready') {
        return current;
      }

      if (current.modelId === selectedModelId && current.status === 'failed') {
        return current;
      }

      if (isSelectedInstalled) {
        return {
          modelId: selectedModelId,
          status: 'ready',
          source: 'existing',
          progress: null,
          errorMessage: null,
          availability: null,
        };
      }

      return {
        modelId: selectedModelId,
        status: 'validating',
        source: null,
        progress: null,
        errorMessage: null,
        availability: null,
      };
    });

    if (!selectedModelId || isSelectedInstalled) {
      return () => {
        cancelled = true;
      };
    }

    void getLocalLlmAvailability(selectedModelId)
      .then((availability) => {
        if (cancelled) {
          return;
        }

        setState((current) => {
          if (
            current.modelId !== selectedModelId ||
            current.status === 'downloading' ||
            isSelectedInstalled
          ) {
            return current;
          }

          if (availability.available) {
            if (current.status === 'ready' || current.status === 'failed') {
              return current;
            }

            return {
              modelId: selectedModelId,
              status: 'idle',
              source: null,
              progress: null,
              errorMessage: availability.warningReason || null,
              availability,
            };
          }

          return {
            modelId: selectedModelId,
            status: 'blocked',
            source: null,
            progress: null,
            errorMessage: availability.reason || null,
            availability,
          };
        });
      })
      .catch(() => {
        // Ignore availability lookup failures and let the explicit download attempt surface the error.
      });

    return () => {
      cancelled = true;
    };
  }, [isSelectedInstalled, selectedModelId]);

  const downloadModel = useCallback(
    async (
      provider: LlmProviderConfig,
      modelId: string,
      totalBytesHint?: number,
    ): Promise<LlmProviderConfig | null> => {
      const availability = await getLocalLlmAvailability(modelId);
      if (!availability.available) {
        setState({
          modelId,
          status: 'blocked',
          source: null,
          progress: null,
          errorMessage: availability.reason || null,
          availability,
        });
        return null;
      }

      setState({
        modelId,
        status: 'downloading',
        source: null,
        progress: {
          modelId,
          bytesWritten: 0,
          totalBytes: typeof totalBytesHint === 'number' ? totalBytesHint : null,
          fraction: 0,
        },
        errorMessage: null,
        availability,
      });

      try {
        const updatedProvider = await installLocalLlmModel(provider, modelId, {
          onProgress: (progress) => {
            setState((current) => {
              if (current.modelId !== modelId) {
                return current;
              }
              return {
                modelId,
                status: 'downloading',
                source: null,
                progress,
                errorMessage: null,
                availability: current.availability,
              };
            });
          },
        });

        setState({
          modelId,
          status: 'ready',
          source: 'downloaded',
          progress:
            typeof totalBytesHint === 'number'
              ? {
                  modelId,
                  bytesWritten: totalBytesHint,
                  totalBytes: totalBytesHint,
                  fraction: 1,
                }
              : null,
          errorMessage: null,
          availability,
        });

        return updatedProvider;
      } catch (error) {
        setState({
          modelId,
          status: 'failed',
          source: null,
          progress: null,
          errorMessage:
            error instanceof Error
              ? error.message
              : 'The model could not be downloaded. Check your connection and try again.',
          availability,
        });
        return null;
      }
    },
    [],
  );

  return {
    downloadModel,
    downloadState: state,
    isDownloading: state.status === 'downloading',
    isReady: state.status === 'ready',
    isBlocked: state.status === 'blocked',
    hasError: state.status === 'failed',
    errorMessage: state.errorMessage,
    wasJustDownloaded: state.status === 'ready' && state.source === 'downloaded',
  } as const;
}
