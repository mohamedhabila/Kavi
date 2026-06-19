import type { InstalledLocalLlmModelValidationIssue } from '../../services/localLlm/modelArtifacts';
import type { LocalLlmRuntimeStatus } from '../../services/localLlm/types';

type TranslationFn = (key: string, params?: any) => string;

export function getValidationIssueMessageKey(issue: InstalledLocalLlmModelValidationIssue): string {
  switch (issue) {
    case 'unknown_model':
      return 'localModels.invalidInstallUnknown';
    case 'file_name_mismatch':
      return 'localModels.invalidInstallFileName';
    case 'source_url_mismatch':
      return 'localModels.invalidInstallSource';
    case 'repository_mismatch':
      return 'localModels.invalidInstallRepository';
    case 'revision_mismatch':
      return 'localModels.invalidInstallRevision';
    case 'missing_or_invalid_file':
      return 'localModels.invalidInstallMissingFile';
  }
}

function formatBackendLabel(value: string): string {
  return value.toUpperCase();
}

export function formatLocalModelRuntimeStatusLabel(
  status: LocalLlmRuntimeStatus,
  t: TranslationFn,
): string {
  const backend = formatBackendLabel(status.activeBackend);
  const requested = formatBackendLabel(status.requestedBackend);

  if (status.activity === 'warming') {
    return t('localModels.runtimeWarming', { backend });
  }

  if (status.backendSource === 'observed') {
    return status.fellBackFromRequestedBackend
      ? t('localModels.runtimeFallback', { backend, requested })
      : t('localModels.runtimeRunningOn', { backend });
  }

  if (status.activeBackend === 'cpu' && status.resolvedBackendReason === 'configured') {
    return t('localModels.runtimeConfiguredCpu');
  }

  return t('localModels.runtimeLikely', { backend });
}
