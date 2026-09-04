// ---------------------------------------------------------------------------
// Kavi — On-device model disclosure sentence
// ---------------------------------------------------------------------------
// Builds a short, localized disclosure sentence for an on-device model tier
// during onboarding. The sentence is composed entirely from structured
// catalog fields (capabilities, size, memory requirement) — never from the
// model's display name — so it stays accurate for any future catalog entry
// without needing per-model copy.

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

export interface LocalModelDisclosureInput {
  minDeviceMemoryGb?: number;
  sizeBytes: number;
  /** Pre-formatted size label from the catalog (e.g. "2.41 GB"), reused when available. */
  sizeLabel?: string;
  supportsTools: boolean;
  supportsVision: boolean;
}

function formatSizeBytesLabel(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = value >= 10 || unitIndex === 0 ? 0 : 2;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)} ${units[unitIndex]}`;
}

/**
 * Builds a short multi-sentence disclosure describing what an on-device
 * model tier can and cannot do, built only from structured catalog fields.
 */
export function buildLocalModelDisclosureSentence(
  entry: LocalModelDisclosureInput,
  t: TranslationFn,
): string {
  const sentences: string[] = [t('onboarding.localModelDisclosure.offline')];

  if (entry.supportsTools && entry.supportsVision) {
    sentences.push(t('onboarding.localModelDisclosure.capabilitiesBoth'));
  } else if (entry.supportsTools) {
    sentences.push(t('onboarding.localModelDisclosure.capabilitiesToolsOnly'));
  } else if (entry.supportsVision) {
    sentences.push(t('onboarding.localModelDisclosure.capabilitiesVisionOnly'));
  } else {
    sentences.push(t('onboarding.localModelDisclosure.capabilitiesNeither'));
  }

  if (typeof entry.minDeviceMemoryGb === 'number' && entry.minDeviceMemoryGb > 0) {
    sentences.push(
      t('onboarding.localModelDisclosure.sizeAndMemory', {
        size: entry.sizeLabel || formatSizeBytesLabel(entry.sizeBytes),
        memory: entry.minDeviceMemoryGb,
      }),
    );
  }

  sentences.push(t('onboarding.localModelDisclosure.simplerAnswers'));

  return sentences.join(' ');
}
