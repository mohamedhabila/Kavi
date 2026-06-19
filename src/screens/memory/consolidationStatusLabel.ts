import type { ConsolidationStatusSnapshot } from '../../services/memory/consolidationStatus';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

export function consolidationTierLabel(
  snapshot: ConsolidationStatusSnapshot,
  t: TranslationFn,
): string {
  if (snapshot.memoryDisabled) {
    return t('memory.consolidationTierDisabled');
  }
  switch (snapshot.tier) {
    case 'configured':
      return snapshot.providerName
        ? t('memory.consolidationTierConfigured', { name: snapshot.providerName })
        : t('memory.consolidationTierConfiguredGeneric');
    case 'on_device':
      return snapshot.providerName
        ? t('memory.consolidationTierOnDevice', { name: snapshot.providerName })
        : t('memory.consolidationTierOnDeviceGeneric');
    case 'chat':
      return snapshot.providerName
        ? t('memory.consolidationTierChat', { name: snapshot.providerName })
        : t('memory.consolidationTierChatGeneric');
    default:
      return t('memory.consolidationTierDeterministic');
  }
}