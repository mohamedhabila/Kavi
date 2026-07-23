import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  correctMemoryFactForManagement,
  forgetMemoryFactForManagement,
  setMemoryFactPinnedForManagement,
  type MemoryFactCorrectionResult,
} from '../../services/memory/memoryTools';
import type { MemoryFactRow, MemoryScreenTranslation } from './memoryScreenTypes';

type UseMemoryFactManagementOptions = {
  onChanged: () => void;
  t: MemoryScreenTranslation;
};

function correctionMessage(
  result: Exclude<MemoryFactCorrectionResult, { ok: true }>,
  t: MemoryScreenTranslation,
): string {
  if (result.code === 'conflict' || result.code === 'not_found') {
    return t('memory.correctionChanged');
  }
  if (result.code === 'memory_disabled') return t('memory.correctionMemoryDisabled');
  if (result.code === 'restricted') return t('memory.correctionRestricted');
  if (result.code === 'invalid_args') return t('memory.correctionInvalid');
  return t('memory.correctionFailed');
}

export function useMemoryFactManagement({ onChanged, t }: UseMemoryFactManagementOptions) {
  const [correctionFact, setCorrectionFact] = useState<MemoryFactRow | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const handleFactTogglePin = useCallback(
    (fact: MemoryFactRow) => {
      try {
        const result = setMemoryFactPinnedForManagement({ factId: fact.id }, !fact.pinned);
        if ('ok' in result && result.ok) {
          onChanged();
          return;
        }
      } catch {
        // The generic recovery alert below must not contain storage details.
      }
      Alert.alert(t('memory.factPinFailedTitle'), t('memory.factPinFailedMessage'));
    },
    [onChanged, t],
  );

  const handleFactForget = useCallback(
    (fact: MemoryFactRow) => {
      Alert.alert(t('memory.factForgetTitle'), t('memory.factForgetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('memory.factForget'),
          style: 'destructive',
          onPress: () => {
            try {
              const result = forgetMemoryFactForManagement({ factId: fact.id });
              if ('ok' in result && result.ok) {
                onChanged();
                return;
              }
            } catch {
              // The user-facing alert below is deliberately content-free.
            }
            Alert.alert(t('memory.factForgetFailedTitle'), t('memory.factForgetFailedMessage'));
          },
        },
      ]);
    },
    [onChanged, t],
  );

  const handleFactCorrect = useCallback((fact: MemoryFactRow) => {
    setCorrectionError(null);
    setCorrectionFact(fact);
  }, []);

  const cancelCorrection = useCallback(() => {
    setCorrectionError(null);
    setCorrectionFact(null);
  }, []);

  const clearCorrectionError = useCallback(() => {
    setCorrectionError(null);
  }, []);

  const saveCorrection = useCallback(
    (value: string) => {
      if (!correctionFact) return;
      try {
        const result = correctMemoryFactForManagement({ factId: correctionFact.id, value });
        if (result.ok) {
          setCorrectionError(null);
          setCorrectionFact(null);
          onChanged();
          return;
        }
        setCorrectionError(correctionMessage(result, t));
      } catch {
        setCorrectionError(t('memory.correctionFailed'));
      }
    },
    [correctionFact, onChanged, t],
  );

  return {
    cancelCorrection,
    clearCorrectionError,
    correctionError,
    correctionFact,
    handleFactCorrect,
    handleFactForget,
    handleFactTogglePin,
    saveCorrection,
  };
}

export type MemoryFactManagementController = ReturnType<typeof useMemoryFactManagement>;
