import { Bell, CloudSun, Search, Wrench } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import {
  SERVICE_SETUP_FIELDS,
  orderToolsByGroup,
  type ServiceSetupField,
} from '../../services/setup/catalog';
import { deleteSecure, getSecure, saveSecure } from '../../services/storage/SecureStorage';

type TranslationFn = (key: string, params?: any) => string;
type PermissionRecord = { toolName: string; allowed: boolean };

const SERVICE_SETUP_I18N_KEYS: Record<string, string> = {
  BRAVE_API_KEY: 'onboarding.services.brave',
  GOOGLE_API_KEY: 'onboarding.services.gemini',
  PERPLEXITY_API_KEY: 'onboarding.services.perplexity',
  XAI_API_KEY: 'onboarding.services.grok',
  KIMI_API_KEY: 'onboarding.services.kimi',
  FIRECRAWL_API_KEY: 'onboarding.services.firecrawl',
  OPENWEATHER_API_KEY: 'onboarding.services.weather',
  GITHUB_TOKEN: 'onboarding.services.github',
  ALPHA_VANTAGE_API_KEY: 'onboarding.services.finance',
};

const WEB_SEARCH_PROVIDER_VALUES = [
  'auto',
  'brave',
  'gemini',
  'perplexity',
  'grok',
  'kimi',
] as const;

export function useSettingsToolsFlow({
  t,
  permissions,
}: {
  t: TranslationFn;
  permissions: PermissionRecord[];
}) {
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toolGroups = useMemo(() => orderToolsByGroup(TOOL_DEFINITIONS), []);

  const translateWithFallback = useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) => {
      const translated = t(key, params);
      return translated === key ? fallback : translated;
    },
    [t],
  );

  const webSearchProviderOptions = useMemo(
    () =>
      WEB_SEARCH_PROVIDER_VALUES.map((value) => ({
        value,
        label: translateWithFallback(`onboarding.webProviders.${value}.title`, value),
        detail: translateWithFallback(`onboarding.webProviders.${value}.detail`, ''),
      })),
    [translateWithFallback],
  );

  const builtInToolSections = useMemo(
    () => [
      {
        id: 'research',
        icon: Search,
        title: t('settings.builtInGroups.research.title'),
        description: t('settings.builtInGroups.research.description'),
      },
      {
        id: 'device',
        icon: Bell,
        title: t('settings.builtInGroups.device.title'),
        description: t('settings.builtInGroups.device.description'),
      },
      {
        id: 'services',
        icon: CloudSun,
        title: t('settings.builtInGroups.services.title'),
        description: t('settings.builtInGroups.services.description'),
      },
      {
        id: 'catalog',
        icon: Wrench,
        title: t('settings.builtInGroups.catalog.title'),
        description: t('settings.builtInGroups.catalog.description'),
      },
    ],
    [t],
  );

  const getServiceFieldCopy = useCallback(
    (field: ServiceSetupField) => {
      const prefix = SERVICE_SETUP_I18N_KEYS[field.storageKey];
      if (!prefix) return field;

      return {
        ...field,
        label: translateWithFallback(`${prefix}.title`, field.label),
        hint: translateWithFallback(`${prefix}.hint`, field.hint),
        category: translateWithFallback(`${prefix}.category`, field.category),
        unlocks: translateWithFallback(`${prefix}.unlocks`, field.unlocks),
        setup: translateWithFallback(`${prefix}.setup`, field.setup),
        freeAccess: translateWithFallback(`${prefix}.freeAccess`, field.freeAccess),
      };
    },
    [translateWithFallback],
  );

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        SERVICE_SETUP_FIELDS.map(
          async (field) => [field.storageKey, (await getSecure(field.storageKey)) || ''] as const,
        ),
      );

      if (!cancelled) {
        setServiceKeys(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persistServiceKey = useCallback(
    async (storageKey: string, value: string) => {
      try {
        const trimmed = value.trim();
        if (trimmed) {
          await saveSecure(storageKey, trimmed);
        } else {
          await deleteSecure(storageKey);
        }
      } catch {
        Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      }
    },
    [t],
  );

  const handleOpenUrl = useCallback(
    async (url?: string) => {
      if (!url) return;
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(t('common.error'), t('settings.invalidUrlFormat'));
      }
    },
    [t],
  );

  const permissionStateByTool = useMemo(() => {
    return new Map(permissions.map((permission) => [permission.toolName, permission]));
  }, [permissions]);

  return {
    serviceSetupFields: SERVICE_SETUP_FIELDS,
    toolGroups,
    serviceKeys,
    setServiceKeys,
    expandedGroups,
    toggleGroup,
    webSearchProviderOptions,
    builtInToolSections,
    getServiceFieldCopy,
    persistServiceKey,
    handleOpenUrl,
    permissionStateByTool,
  };
}
