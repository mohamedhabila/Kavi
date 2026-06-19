function normalizeCategoryToken(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : undefined;
}

const LEGACY_WEB_CATEGORY_ALIAS = ['web', 'research'].join('_');

export function normalizeToolPlannerCategoryAlias(
  value: string | undefined,
): string | undefined {
  const normalized = normalizeCategoryToken(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'expo_eas' || normalized === 'eas' || normalized === 'expo') {
    return 'expo';
  }
  if (normalized === 'github' || normalized === 'git_hub' || normalized === 'git') {
    return 'github';
  }
  if (normalized === 'workspace_search' || normalized === 'workspace' || normalized === 'files') {
    return 'workspace_files';
  }
  if (normalized === 'web' || normalized === LEGACY_WEB_CATEGORY_ALIAS) {
    return 'web';
  }
  if (normalized === 'memory') {
    return 'memory_search';
  }
  if (normalized === 'native') {
    return 'device';
  }
  if (normalized === 'interaction') {
    return 'communication';
  }
  if (normalized === 'automation') {
    return 'cron';
  }

  return normalized;
}

export function normalizeToolCategoryFamily(value: string | undefined): string | undefined {
  const normalized = normalizeToolPlannerCategoryAlias(value);
  if (!normalized) {
    return undefined;
  }

  return normalized === 'expo_manual_actions' ? 'expo' : normalized;
}
