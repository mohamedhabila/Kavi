// ---------------------------------------------------------------------------
// Kavi — Onboarding Wizard
// ---------------------------------------------------------------------------
// First-run experience: Welcome → Model setup → Tool setup → Summary.

import React, { useState, useMemo, useCallback } from 'react';
import {
  Dimensions,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CloudSun,
  ExternalLink,
  FolderOpen,
  Globe,
  Key,
  Monitor,
  Search,
  Server,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import {
  buildProviderFromPreset,
  finalizeProviderConfig,
  isOnDeviceProviderPreset,
  KNOWN_PROVIDERS,
} from '../../constants/api';
import { generateId } from '../../utils/id';
import { saveProviderApiKey, saveSecure } from '../../services/storage/SecureStorage';
import { LlmProviderConfig, WebSearchProvider } from '../../types';
import {
  GEMMA_LOCAL_PROVIDER_NAME,
  getLocalLlmCatalogEntriesForProvider,
} from '../../services/localLlm/catalog';
import { isLocalLlmModelInstalled } from '../../services/localLlm/runtime';
import { useLocalLlmModelDownload } from '../../hooks/useLocalLlmModelDownload';
import { LocalModelDownloadPanel } from '../localLlm/LocalModelDownloadPanel';

type ProviderPreset = (typeof KNOWN_PROVIDERS)[number];
type Step = 'welcome' | 'provider' | 'providerKey' | 'tools' | 'features' | 'done';

interface ProviderGuide {
  id: string;
  title: string;
  summary: string;
  setup: string;
  freeAccess: string;
  docsUrl?: string;
  requiresKey: boolean;
  preset?: ProviderPreset;
}

interface ServiceGuide {
  storageKey: string;
  title: string;
  category: string;
  unlocks: string;
  setup: string;
  freeAccess: string;
  placeholder: string;
  docsUrl?: string;
  /** Which web search provider selection makes this service essential */
  webProvider?: WebSearchProvider;
  /** Always show in the primary (non-collapsed) list */
  essential?: boolean;
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const ONBOARDING_BRAND_ICON = require('../../../assets/icon.png');

const buildProviderGuides = (t: TranslateFn): ProviderGuide[] => [
  {
    id: 'openai',
    title: t('onboarding.providers.openai.title'),
    summary: t('onboarding.providers.openai.summary'),
    setup: t('onboarding.providers.openai.setup'),
    freeAccess: t('onboarding.providers.openai.freeAccess'),
    docsUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'OpenAI'),
  },
  {
    id: 'anthropic',
    title: t('onboarding.providers.anthropic.title'),
    summary: t('onboarding.providers.anthropic.summary'),
    setup: t('onboarding.providers.anthropic.setup'),
    freeAccess: t('onboarding.providers.anthropic.freeAccess'),
    docsUrl: 'https://platform.claude.com/settings/keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'Anthropic'),
  },
  {
    id: 'gemini',
    title: t('onboarding.providers.gemini.title'),
    summary: t('onboarding.providers.gemini.summary'),
    setup: t('onboarding.providers.gemini.setup'),
    freeAccess: t('onboarding.providers.gemini.freeAccess'),
    docsUrl: 'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'Gemini'),
  },
  {
    id: 'openrouter',
    title: t('onboarding.providers.openrouter.title'),
    summary: t('onboarding.providers.openrouter.summary'),
    setup: t('onboarding.providers.openrouter.setup'),
    freeAccess: t('onboarding.providers.openrouter.freeAccess'),
    docsUrl: 'https://openrouter.ai/settings/keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'OpenRouter'),
  },
  {
    id: 'ollama',
    title: t('onboarding.providers.ollama.title'),
    summary: t('onboarding.providers.ollama.summary'),
    setup: t('onboarding.providers.ollama.setup'),
    freeAccess: t('onboarding.providers.ollama.freeAccess'),
    docsUrl: 'https://ollama.com/',
    requiresKey: false,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'Ollama (local)'),
  },
  {
    id: 'gemma-local',
    title: t('onboarding.providers.gemmaLocal.title'),
    summary: t('onboarding.providers.gemmaLocal.summary'),
    setup: t('onboarding.providers.gemmaLocal.setup'),
    freeAccess: t('onboarding.providers.gemmaLocal.freeAccess'),
    docsUrl: 'https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference',
    requiresKey: false,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === GEMMA_LOCAL_PROVIDER_NAME),
  },
  {
    id: 'custom',
    title: t('onboarding.providers.custom.title'),
    summary: t('onboarding.providers.custom.summary'),
    setup: t('onboarding.providers.custom.setup'),
    freeAccess: t('onboarding.providers.custom.freeAccess'),
    requiresKey: true,
  },
];

const buildWebProviderOptions = (
  t: TranslateFn,
): Array<{ value: WebSearchProvider; title: string; detail: string }> => [
  {
    value: 'auto',
    title: t('onboarding.webProviders.auto.title'),
    detail: t('onboarding.webProviders.auto.detail'),
  },
  {
    value: 'brave',
    title: t('onboarding.webProviders.brave.title'),
    detail: t('onboarding.webProviders.brave.detail'),
  },
  {
    value: 'perplexity',
    title: t('onboarding.webProviders.perplexity.title'),
    detail: t('onboarding.webProviders.perplexity.detail'),
  },
  {
    value: 'grok',
    title: t('onboarding.webProviders.grok.title'),
    detail: t('onboarding.webProviders.grok.detail'),
  },
  {
    value: 'kimi',
    title: t('onboarding.webProviders.kimi.title'),
    detail: t('onboarding.webProviders.kimi.detail'),
  },
  {
    value: 'gemini',
    title: t('onboarding.webProviders.gemini.title'),
    detail: t('onboarding.webProviders.gemini.detail'),
  },
];

const buildServiceGuides = (t: TranslateFn): ServiceGuide[] => [
  {
    storageKey: 'BRAVE_API_KEY',
    title: t('onboarding.services.brave.title'),
    category: t('onboarding.services.brave.category'),
    unlocks: t('onboarding.services.brave.unlocks'),
    setup: t('onboarding.services.brave.setup'),
    freeAccess: t('onboarding.services.brave.freeAccess'),
    placeholder: 'BSA...',
    docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
    webProvider: 'brave',
  },
  {
    storageKey: 'PERPLEXITY_API_KEY',
    title: t('onboarding.services.perplexity.title'),
    category: t('onboarding.services.perplexity.category'),
    unlocks: t('onboarding.services.perplexity.unlocks'),
    setup: t('onboarding.services.perplexity.setup'),
    freeAccess: t('onboarding.services.perplexity.freeAccess'),
    placeholder: 'pplx-...',
    docsUrl: 'https://docs.perplexity.ai/guides/getting-started',
    webProvider: 'perplexity',
  },
  {
    storageKey: 'XAI_API_KEY',
    title: t('onboarding.services.xai.title'),
    category: t('onboarding.services.xai.category'),
    unlocks: t('onboarding.services.xai.unlocks'),
    setup: t('onboarding.services.xai.setup'),
    freeAccess: t('onboarding.services.xai.freeAccess'),
    placeholder: 'xai-...',
    docsUrl: 'https://docs.x.ai/developers/quickstart',
    webProvider: 'grok',
  },
  {
    storageKey: 'KIMI_API_KEY',
    title: t('onboarding.services.kimi.title'),
    category: t('onboarding.services.kimi.category'),
    unlocks: t('onboarding.services.kimi.unlocks'),
    setup: t('onboarding.services.kimi.setup'),
    freeAccess: t('onboarding.services.kimi.freeAccess'),
    placeholder: 'sk-...',
    docsUrl: 'https://platform.moonshot.ai/',
    webProvider: 'kimi',
  },
  {
    storageKey: 'GOOGLE_API_KEY',
    title: t('onboarding.services.gemini.title'),
    category: t('onboarding.services.gemini.category'),
    unlocks: t('onboarding.services.gemini.unlocks'),
    setup: t('onboarding.services.gemini.setup'),
    freeAccess: t('onboarding.services.gemini.freeAccess'),
    placeholder: 'AIza...',
    docsUrl: 'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys',
    webProvider: 'gemini',
  },
  {
    storageKey: 'FIRECRAWL_API_KEY',
    title: t('onboarding.services.firecrawl.title'),
    category: t('onboarding.services.firecrawl.category'),
    unlocks: t('onboarding.services.firecrawl.unlocks'),
    setup: t('onboarding.services.firecrawl.setup'),
    freeAccess: t('onboarding.services.firecrawl.freeAccess'),
    placeholder: 'fc-...',
    docsUrl: 'https://www.firecrawl.dev/pricing',
  },
  {
    storageKey: 'OPENWEATHER_API_KEY',
    title: t('onboarding.services.openweather.title'),
    category: t('onboarding.services.openweather.category'),
    unlocks: t('onboarding.services.openweather.unlocks'),
    setup: t('onboarding.services.openweather.setup'),
    freeAccess: t('onboarding.services.openweather.freeAccess'),
    placeholder: 'weather-key',
    docsUrl: 'https://openweathermap.org/price',
    essential: true,
  },
  {
    storageKey: 'GITHUB_TOKEN',
    title: t('onboarding.services.github.title'),
    category: t('onboarding.services.github.category'),
    unlocks: t('onboarding.services.github.unlocks'),
    setup: t('onboarding.services.github.setup'),
    freeAccess: t('onboarding.services.github.freeAccess'),
    placeholder: 'github_pat_...',
    docsUrl:
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    essential: true,
  },
  {
    storageKey: 'ALPHA_VANTAGE_API_KEY',
    title: t('onboarding.services.alphaVantage.title'),
    category: t('onboarding.services.alphaVantage.category'),
    unlocks: t('onboarding.services.alphaVantage.unlocks'),
    setup: t('onboarding.services.alphaVantage.setup'),
    freeAccess: t('onboarding.services.alphaVantage.freeAccess'),
    placeholder: 'alpha-vantage-key',
    docsUrl: 'https://www.alphavantage.co/support/#api-key',
  },
];

interface OnboardingWizardProps {
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const storedWebSearchProvider = useSettingsStore((s) => s.webSearchProvider);
  const setWebSearchProvider = useSettingsStore((s) => s.setWebSearchProvider);

  const [step, setStep] = useState<Step>('welcome');
  const [selectedGuide, setSelectedGuide] = useState<ProviderGuide | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [pendingProviderId, setPendingProviderId] = useState(() => generateId());
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [downloadedOnDeviceProvider, setDownloadedOnDeviceProvider] =
    useState<LlmProviderConfig | null>(null);
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({});
  const [webSearchProvider, setWebSearchProviderState] =
    useState<WebSearchProvider>(storedWebSearchProvider);
  const [configuredProviderName, setConfiguredProviderName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showMoreServices, setShowMoreServices] = useState(false);
  const providerGuides = useMemo(() => buildProviderGuides(t), [t]);
  const webProviderOptions = useMemo(() => buildWebProviderOptions(t), [t]);
  const serviceGuides = useMemo(() => buildServiceGuides(t), [t]);
  const selectedGuideIsOnDevice = Boolean(
    selectedGuide?.preset && isOnDeviceProviderPreset(selectedGuide.preset),
  );
  const selectedOnDevicePreset = useMemo(
    () =>
      selectedGuide?.preset && isOnDeviceProviderPreset(selectedGuide.preset)
        ? selectedGuide.preset
        : null,
    [selectedGuide],
  );
  const localCatalog = useMemo(
    () =>
      selectedOnDevicePreset
        ? getLocalLlmCatalogEntriesForProvider({
            local: { catalogModelIds: selectedOnDevicePreset.availableModels },
          } as LlmProviderConfig)
        : [],
    [selectedOnDevicePreset],
  );
  const buildSelectedProviderDraft = useCallback((): LlmProviderConfig | null => {
    if (!selectedGuide) {
      return null;
    }

    if (selectedGuide.preset) {
      if (selectedGuideIsOnDevice && downloadedOnDeviceProvider?.id === pendingProviderId) {
        return finalizeProviderConfig({
          ...downloadedOnDeviceProvider,
          model: customModel.trim() || downloadedOnDeviceProvider.model,
          enabled: true,
        });
      }

      return buildProviderFromPreset(selectedGuide.preset, {
        id: pendingProviderId,
        ...(selectedGuideIsOnDevice ? {} : { baseUrl: customBaseUrl.trim() }),
        model: customModel.trim(),
        enabled: true,
      });
    }

    return finalizeProviderConfig({
      id: pendingProviderId,
      name: customName.trim(),
      baseUrl: customBaseUrl.trim(),
      apiKey: '',
      model: customModel.trim(),
      enabled: true,
    });
  }, [
    customBaseUrl,
    customModel,
    customName,
    downloadedOnDeviceProvider,
    pendingProviderId,
    selectedGuide,
    selectedGuideIsOnDevice,
  ]);
  const currentProviderDraft = useMemo(
    () => buildSelectedProviderDraft(),
    [buildSelectedProviderDraft],
  );
  const selectedOnDeviceCatalogEntry = useMemo(
    () =>
      selectedGuideIsOnDevice
        ? localCatalog.find((entry) => entry.id === customModel.trim()) || localCatalog[0] || null
        : null,
    [customModel, localCatalog, selectedGuideIsOnDevice],
  );
  const selectedOnDeviceModelInstalled = Boolean(
    selectedGuideIsOnDevice &&
    currentProviderDraft &&
    isLocalLlmModelInstalled(currentProviderDraft, currentProviderDraft.model),
  );
  const {
    downloadModel: downloadOnDeviceModel,
    downloadState: onDeviceDownloadState,
    isDownloading: onDeviceDownloadInProgress,
    wasJustDownloaded: onDeviceModelWasJustDownloaded,
  } = useLocalLlmModelDownload(
    selectedGuideIsOnDevice ? customModel.trim() : undefined,
    selectedOnDeviceModelInstalled,
  );

  // Split services into primary (relevant to selected web provider + essential)
  // and additional (everything else) so the tools step isn't overwhelming.
  const { primaryServices, additionalServices } = useMemo(() => {
    const primary: ServiceGuide[] = [];
    const additional: ServiceGuide[] = [];
    for (const guide of serviceGuides) {
      const isRelevant =
        guide.essential ||
        (guide.webProvider &&
          (webSearchProvider === 'auto' || webSearchProvider === guide.webProvider));
      if (isRelevant) {
        primary.push(guide);
      } else {
        additional.push(guide);
      }
    }
    return { primaryServices: primary, additionalServices: additional };
  }, [serviceGuides, webSearchProvider]);

  const handleOpenUrl = useCallback(
    async (url?: string) => {
      if (!url) return;
      try {
        await Linking.openURL(url);
      } catch {
        setSaveError(t('onboarding.saveFailed'));
      }
    },
    [t],
  );

  const handleSelectGuide = useCallback((guide: ProviderGuide) => {
    setSaveError(null);
    setPendingProviderId(generateId());
    setDownloadedOnDeviceProvider(null);
    setSelectedGuide(guide);
    setApiKey('');
    if (guide.preset) {
      setCustomName(guide.preset.name);
      setCustomBaseUrl(guide.preset.baseUrl);
      setCustomModel(guide.preset.defaultModel);
    } else {
      setCustomName(guide.title);
      setCustomBaseUrl('');
      setCustomModel('');
    }
    setStep('providerKey');
  }, []);

  const handleDownloadSelectedOnDeviceModel = useCallback(async () => {
    if (!selectedGuideIsOnDevice || !selectedOnDeviceCatalogEntry || !currentProviderDraft) {
      return;
    }

    setSaveError(null);
    const updatedProvider = await downloadOnDeviceModel(
      currentProviderDraft,
      selectedOnDeviceCatalogEntry.id,
      selectedOnDeviceCatalogEntry.sizeBytes,
    );

    if (updatedProvider) {
      setDownloadedOnDeviceProvider(updatedProvider);
      return;
    }
  }, [
    currentProviderDraft,
    downloadOnDeviceModel,
    selectedGuideIsOnDevice,
    selectedOnDeviceCatalogEntry,
  ]);

  const handleSaveProvider = useCallback(async () => {
    if (!selectedGuide) return;
    const requiresKey = selectedGuide.requiresKey;
    const onDeviceGuide = Boolean(
      selectedGuide.preset && isOnDeviceProviderPreset(selectedGuide.preset),
    );
    if ((!onDeviceGuide && !customBaseUrl.trim()) || !customModel.trim()) return;
    if (!selectedGuide.preset && !customName.trim()) return;
    if (requiresKey && !apiKey.trim()) return;

    setSaving(true);
    setSaveError(null);

    try {
      const finalizedProvider = buildSelectedProviderDraft();
      if (!finalizedProvider) {
        return;
      }
      if (onDeviceGuide && !isLocalLlmModelInstalled(finalizedProvider, finalizedProvider.model)) {
        return;
      }

      if (requiresKey) {
        await saveProviderApiKey(finalizedProvider.id, apiKey.trim());
      }
      addProvider(finalizedProvider);
      setConfiguredProviderName(finalizedProvider.name);
      setStep('tools');
    } catch {
      setSaveError(t('onboarding.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [
    addProvider,
    apiKey,
    buildSelectedProviderDraft,
    customBaseUrl,
    customModel,
    customName,
    selectedGuide,
    t,
  ]);

  const handleSkipProvider = useCallback(() => {
    setSaveError(null);
    setStep('tools');
  }, []);

  const handleSaveTools = useCallback(async () => {
    setSaving(true);
    setSaveError(null);

    try {
      await Promise.all(
        serviceGuides.map(async (guide) => {
          const value = (serviceKeys[guide.storageKey] || '').trim();
          if (value) {
            await saveSecure(guide.storageKey, value);
          }
        }),
      );
      setWebSearchProvider(webSearchProvider);
      setStep('features');
    } catch {
      setSaveError(t('onboarding.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [serviceGuides, serviceKeys, setWebSearchProvider, t, webSearchProvider]);

  const handleFinish = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const configuredServiceCount = useMemo(
    () => Object.values(serviceKeys).filter((value) => value.trim().length > 0).length,
    [serviceKeys],
  );

  const canSaveProvider = Boolean(
    selectedGuide &&
    customModel.trim() &&
    (selectedGuide.preset || customName.trim()) &&
    (selectedGuideIsOnDevice || customBaseUrl.trim()) &&
    (!selectedGuide.requiresKey || apiKey.trim()) &&
    (!selectedGuideIsOnDevice || (selectedOnDeviceModelInstalled && !onDeviceDownloadInProgress)),
  );

  const progress = [
    t('onboarding.progressModel'),
    t('onboarding.progressTools'),
    'Features',
    t('onboarding.progressFinish'),
  ];

  const currentProgressIndex =
    step === 'provider' || step === 'providerKey'
      ? 0
      : step === 'tools'
        ? 1
        : step === 'features'
          ? 2
          : step === 'done'
            ? 3
            : -1;

  // ── Step: Welcome ────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <View style={styles.logoBadge}>
            <Image
              source={ONBOARDING_BRAND_ICON}
              style={styles.logoImage}
              resizeMode="cover"
              accessibilityLabel={t('onboarding.appIconAccessibility')}
            />
          </View>
          <Text style={styles.title}>{t('onboarding.welcome')}</Text>
          <Text style={styles.subtitle}>{t('onboarding.welcomeHint')}</Text>

          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>{t('onboarding.heroTitle')}</Text>
            <Text style={styles.heroText}>{t('onboarding.heroStep1')}</Text>
            <Text style={styles.heroText}>{t('onboarding.heroStep2')}</Text>
            <Text style={styles.heroText}>{t('onboarding.heroStep3')}</Text>
          </View>

          <View style={styles.featureList}>
            {[
              t('onboarding.featureChat'),
              t('onboarding.featureWebSearch'),
              t('onboarding.featureMemory'),
              t('onboarding.featureMcp'),
              t('onboarding.featureCalendar'),
              t('onboarding.featureAutomation'),
              t('onboarding.featureSkills'),
            ].map((feature, idx) => (
              <View key={idx} style={styles.featureItem}>
                <Check size={16} color={colors.success} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setStep('provider')}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.getStarted')}
          >
            <Text style={styles.primaryBtnText}>{t('onboarding.getStarted')}</Text>
            <ChevronRight size={18} color={colors.onPrimary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={onComplete}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.skip')}
          >
            <Text style={styles.skipBtnText}>{t('onboarding.skip')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const progressHeader =
    currentProgressIndex >= 0 ? (
      <View style={styles.progressRow}>
        {progress.map((label, index) => (
          <View
            key={label}
            style={[
              styles.progressPill,
              index <= currentProgressIndex && styles.progressPillActive,
            ]}
          >
            <Text
              style={[
                styles.progressPillText,
                index <= currentProgressIndex && styles.progressPillTextActive,
              ]}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    ) : null;

  // ── Step: Provider Selection ─────────────────────────────────────────
  if (step === 'provider') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {progressHeader}
          <Text style={styles.stepTitle}>{t('onboarding.chooseMainProviderTitle')}</Text>
          <Text style={styles.stepSubtitle}>{t('onboarding.chooseMainProviderHint')}</Text>

          <View style={styles.providerGrid}>
            {providerGuides.map((guide) => (
              <TouchableOpacity
                key={guide.id}
                style={styles.providerCard}
                onPress={() => handleSelectGuide(guide)}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.selectProvider', { name: guide.title })}
              >
                {guide.id === 'gemma-local' ? (
                  <Monitor size={24} color={colors.primary} />
                ) : (
                  <Globe size={24} color={colors.primary} />
                )}
                <Text style={styles.providerName}>{guide.title}</Text>
                <Text style={styles.providerBadge}>
                  {guide.id === 'gemma-local'
                    ? t('onboarding.providerBadgeOnDevice')
                    : guide.requiresKey
                      ? t('onboarding.providerBadgeKey')
                      : t('onboarding.providerBadgeLocal')}
                </Text>
                <Text style={styles.providerSummary}>{guide.summary}</Text>
                <View style={styles.guideFooter}>
                  <Text style={styles.providerModel}>{guide.freeAccess}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={onComplete}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.skip')}
          >
            <Text style={styles.skipBtnText}>{t('onboarding.skip')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: Provider Setup ─────────────────────────────────────────────
  if (step === 'providerKey' && selectedGuide) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {progressHeader}
          <Key size={40} color={colors.primary} style={styles.stepIcon} />
          <Text style={styles.stepTitle}>{selectedGuide.title}</Text>
          <Text style={styles.stepSubtitle}>{selectedGuide.summary}</Text>

          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>{t('onboarding.accessTitle')}</Text>
            <Text style={styles.guideText}>{selectedGuide.setup}</Text>
            <Text style={styles.guideFree}>{selectedGuide.freeAccess}</Text>
            {selectedGuide.docsUrl ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => void handleOpenUrl(selectedGuide.docsUrl)}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.openProviderGuide', {
                  name: selectedGuide.title,
                })}
              >
                <ExternalLink size={16} color={colors.primary} />
                <Text style={styles.secondaryBtnText}>{t('onboarding.openOfficialGuide')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {!selectedGuide.preset && (
            <TextInput
              style={styles.input}
              value={customName}
              onChangeText={setCustomName}
              placeholder={t('onboarding.providerNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          {!selectedGuideIsOnDevice && (
            <TextInput
              style={styles.input}
              value={customBaseUrl}
              onChangeText={setCustomBaseUrl}
              placeholder={t('onboarding.baseUrlPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          )}

          {selectedGuideIsOnDevice ? (
            <View style={styles.optionWrap}>
              {localCatalog.map((entry) => {
                const active = customModel === entry.id;
                return (
                  <TouchableOpacity
                    key={entry.id}
                    style={[styles.optionCard, active && styles.optionCardActive]}
                    onPress={() => setCustomModel(entry.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding.selectModel', { name: entry.name })}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={styles.optionTitle}>{entry.name}</Text>
                    <Text
                      style={styles.optionText}
                    >{`${entry.sizeLabel} · ${entry.summary || ''}`}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <TextInput
              style={styles.input}
              value={customModel}
              onChangeText={setCustomModel}
              placeholder={t('onboarding.modelPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          {selectedGuide.requiresKey ? (
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={t('onboarding.apiKeyPlaceholder')}
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : (
            <View style={styles.infoCard}>
              <Server size={18} color={colors.primary} />
              <View style={styles.infoCardBody}>
                <Text style={styles.infoCardTitle}>
                  {selectedGuideIsOnDevice
                    ? t('onboarding.onDeviceNoteTitle')
                    : t('onboarding.localNoteTitle')}
                </Text>
                <Text style={styles.infoCardText}>
                  {selectedGuideIsOnDevice
                    ? t('onboarding.onDeviceNoteBody')
                    : t('onboarding.localNoteBody')}
                </Text>
              </View>
            </View>
          )}

          {selectedGuideIsOnDevice && selectedOnDeviceCatalogEntry ? (
            <LocalModelDownloadPanel
              entry={selectedOnDeviceCatalogEntry}
              status={onDeviceDownloadState.status}
              progress={onDeviceDownloadState.progress}
              message={onDeviceDownloadState.errorMessage}
              alreadyInstalled={selectedOnDeviceModelInstalled}
              wasJustDownloaded={onDeviceModelWasJustDownloaded}
              onDownload={() => void handleDownloadSelectedOnDeviceModel()}
            />
          ) : null}

          {saveError ? (
            <Text style={[styles.skipBtnText, { color: colors.danger, marginBottom: 12 }]}>
              {saveError}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, !canSaveProvider && styles.disabledBtn]}
            onPress={() => void handleSaveProvider()}
            disabled={!canSaveProvider || saving}
            accessibilityRole="button"
            accessibilityLabel={saving ? t('onboarding.saving') : t('onboarding.saveProvider')}
          >
            <Text style={styles.primaryBtnText}>
              {saving ? t('onboarding.saving') : t('onboarding.saveProvider')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleSkipProvider}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.skipProvider')}
          >
            <ChevronRight size={16} color={colors.primary} />
            <Text style={styles.secondaryBtnText}>{t('onboarding.skipProvider')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => setStep('provider')}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={styles.skipBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: Tools ───────────────────────────────────────────────────────
  if (step === 'tools') {
    const renderServiceCard = (guide: ServiceGuide) => (
      <View key={guide.storageKey} style={styles.serviceCard}>
        <View style={styles.serviceHeader}>
          <View style={styles.serviceHeaderBody}>
            <Text style={styles.serviceTitle}>{guide.title}</Text>
            <Text style={styles.serviceCategory}>{guide.category}</Text>
          </View>
          {guide.docsUrl ? (
            <TouchableOpacity
              style={styles.serviceGuideButton}
              onPress={() => void handleOpenUrl(guide.docsUrl)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.openServiceGuide', { name: guide.title })}
            >
              <ExternalLink size={14} color={colors.primary} />
              <Text style={styles.serviceGuideText}>{t('onboarding.guideCta')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.serviceUnlocks}>{guide.unlocks}</Text>
        <TextInput
          style={styles.input}
          value={serviceKeys[guide.storageKey] || ''}
          onChangeText={(value) =>
            setServiceKeys((current) => ({ ...current, [guide.storageKey]: value }))
          }
          placeholder={guide.placeholder}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </View>
    );

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {progressHeader}
          <Wrench size={40} color={colors.primary} style={styles.stepIcon} />
          <Text style={styles.stepTitle}>{t('onboarding.toolsTitle')}</Text>
          <Text style={styles.stepSubtitle}>{t('onboarding.toolsHint')}</Text>

          <View style={styles.guideCard}>
            <Search size={18} color={colors.primary} />
            <View style={styles.infoCardBody}>
              <Text style={styles.infoCardTitle}>{t('onboarding.preferredWebSearchTitle')}</Text>
              <Text style={styles.infoCardText}>{t('onboarding.preferredWebSearchText')}</Text>
            </View>
          </View>

          <View style={styles.optionWrap}>
            {webProviderOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionCard,
                  webSearchProvider === option.value && styles.optionCardActive,
                ]}
                onPress={() => setWebSearchProviderState(option.value)}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.chooseWebProvider', { name: option.title })}
              >
                <Text style={styles.optionTitle}>{option.title}</Text>
                <Text style={styles.optionText}>{option.detail}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {primaryServices.length > 0 && (
            <>
              <View style={styles.sectionIntro}>
                <CloudSun size={18} color={colors.primary} />
                <Text style={styles.sectionIntroText}>{t('onboarding.recommendedKeysIntro')}</Text>
              </View>
              {primaryServices.map(renderServiceCard)}
            </>
          )}

          {additionalServices.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.moreServicesToggle}
                onPress={() => setShowMoreServices((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.moreServicesToggle')}
              >
                <Text style={styles.moreServicesText}>
                  {t('onboarding.moreServicesLabel', { count: additionalServices.length })}
                </Text>
                <ChevronDown
                  size={16}
                  color={colors.primary}
                  style={{ transform: [{ rotate: showMoreServices ? '180deg' : '0deg' }] }}
                />
              </TouchableOpacity>
              {showMoreServices && additionalServices.map(renderServiceCard)}
            </>
          )}

          {saveError ? (
            <Text style={[styles.skipBtnText, { color: colors.danger, marginBottom: 12 }]}>
              {saveError}
            </Text>
          ) : null}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => void handleSaveTools()}
            accessibilityRole="button"
            accessibilityLabel={saving ? t('onboarding.saving') : t('onboarding.next')}
          >
            <Text style={styles.primaryBtnText}>
              {saving ? t('onboarding.saving') : t('onboarding.finishSetup')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => setStep('providerKey')}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={styles.skipBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: Features Discovery ─────────────────────────────────────────
  if (step === 'features') {
    const features = [
      {
        icon: <Terminal size={20} color={colors.primary} />,
        title: t('onboarding.featureJavaScriptTerminalTitle'),
        desc: t('onboarding.featureJavaScriptTerminalDescription'),
      },
      {
        icon: <FolderOpen size={20} color={colors.primary} />,
        title: t('onboarding.featureFileWorkspaceTitle'),
        desc: t('onboarding.featureFileWorkspaceDescription'),
      },
      {
        icon: <Monitor size={20} color={colors.primary} />,
        title: t('onboarding.featureRemoteWorkTitle'),
        desc: t('onboarding.featureRemoteWorkDescription'),
      },
      {
        icon: <Server size={20} color={colors.primary} />,
        title: t('onboarding.featureMcpServersTitle'),
        desc: t('onboarding.featureMcpServersDescription'),
      },
      {
        icon: <Wrench size={20} color={colors.primary} />,
        title: t('onboarding.featureBuiltInToolsTitle'),
        desc: t('onboarding.featureBuiltInToolsDescription'),
      },
      {
        icon: <Globe size={20} color={colors.primary} />,
        title: t('onboarding.featurePersonasTitle'),
        desc: t('onboarding.featurePersonasDescription'),
      },
    ];

    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.progressRow, { paddingHorizontal: 24, paddingTop: 16 }]}>
          {progress.map((label, i) => (
            <View
              key={label}
              style={[styles.progressPill, i <= currentProgressIndex && styles.progressPillActive]}
            >
              <Text
                style={[
                  styles.progressPillText,
                  i <= currentProgressIndex && styles.progressPillTextActive,
                ]}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.stepTitle}>{t('onboarding.exploreTitle')}</Text>
          <Text style={[styles.subtitle, { textAlign: 'left', marginBottom: 16 }]}>
            {t('onboarding.exploreHint')}
          </Text>

          {features.map((feature, i) => (
            <View key={i} style={styles.featureDiscoveryCard}>
              <View style={styles.featureDiscoveryIcon}>{feature.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureDiscoveryTitle}>{feature.title}</Text>
                <Text style={styles.featureDiscoveryDesc}>{feature.desc}</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 24 }]}
            onPress={() => setStep('done')}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.continueToFinish')}
          >
            <Text style={styles.primaryBtnText}>{t('onboarding.next')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => setStep('tools')}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={styles.skipBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: Done ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        <Zap size={48} color={colors.success} />
        <Text style={styles.title}>{t('onboarding.step4Title')}</Text>
        <Text style={styles.subtitle}>
          {configuredProviderName
            ? configuredServiceCount > 0
              ? t('onboarding.doneConfiguredWithServices', {
                  provider: configuredProviderName,
                  count: configuredServiceCount,
                  label:
                    configuredServiceCount === 1
                      ? t('onboarding.serviceKeySingular')
                      : t('onboarding.serviceKeyPlural'),
                })
              : t('onboarding.doneConfiguredNoServices', { provider: configuredProviderName })
            : t('onboarding.doneSkippedProvider')}
        </Text>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Globe size={18} color={colors.primary} />
            <Text style={styles.summaryTitle}>{t('onboarding.summaryChatProvider')}</Text>
            <Text style={styles.summaryText}>
              {configuredProviderName || t('onboarding.notConfiguredYet')}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Search size={18} color={colors.primary} />
            <Text style={styles.summaryTitle}>{t('onboarding.summaryWebSearch')}</Text>
            <Text style={styles.summaryText}>
              {webProviderOptions.find((option) => option.value === webSearchProvider)?.title ||
                t('onboarding.webProviders.auto.title')}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Wrench size={18} color={colors.primary} />
            <Text style={styles.summaryTitle}>{t('onboarding.summaryExtraServiceKeys')}</Text>
            <Text style={styles.summaryText}>{configuredServiceCount}</Text>
          </View>
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>{t('onboarding.quickTips')}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipSlashCommands')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipLongPress')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipModelSelector')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.tipMcpServers')}`}</Text>
          <Text style={styles.tipText}>{`\u2022 ${t('onboarding.settingsKeysTip')}`}</Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleFinish}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.startChatting')}
        >
          <Text style={styles.primaryBtnText}>{t('onboarding.startChatting')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 64) / 2;

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    scrollContent: {
      padding: 24,
      paddingTop: 60,
    },
    logoBadge: {
      width: 112,
      height: 112,
      borderRadius: 28,
      overflow: 'hidden',
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.18,
      shadowRadius: 20,
      elevation: 10,
    },
    logoImage: {
      width: '100%',
      height: '100%',
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 24,
      maxWidth: 340,
    },
    heroCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      marginBottom: 24,
      gap: 8,
    },
    heroTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    heroText: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    stepTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
      marginTop: 16,
    },
    stepSubtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 24,
      maxWidth: 340,
      alignSelf: 'center',
    },
    stepIcon: {
      alignSelf: 'center',
      marginTop: 6,
      marginBottom: 8,
    },
    progressRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 18,
    },
    progressPill: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    progressPillActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    progressPillText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    progressPillTextActive: {
      color: colors.text,
    },
    featureList: {
      alignSelf: 'flex-start',
      marginLeft: 20,
      marginBottom: 32,
    },
    featureItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10,
    },
    featureText: {
      fontSize: 15,
      color: colors.text,
    },
    providerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      justifyContent: 'center',
      marginBottom: 24,
    },
    providerCard: {
      width: CARD_WIDTH,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 20,
      alignItems: 'flex-start',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 220,
    },
    providerName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    providerBadge: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    providerSummary: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 19,
      flex: 1,
    },
    guideFooter: {
      marginTop: 'auto',
    },
    providerModel: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 18,
    },
    input: {
      width: '100%',
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
      marginBottom: 20,
    },
    guideCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 18,
      marginBottom: 18,
      gap: 10,
    },
    guideTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    guideText: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    guideFree: {
      fontSize: 13,
      color: colors.primary,
      lineHeight: 18,
      fontWeight: '600',
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 28,
      borderRadius: 12,
      width: '100%',
      marginBottom: 12,
    },
    primaryBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.onPrimary,
    },
    disabledBtn: {
      opacity: 0.5,
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      width: '100%',
      marginBottom: 12,
    },
    secondaryBtnText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    skipBtn: {
      paddingVertical: 10,
    },
    skipBtnText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    infoCard: {
      width: '100%',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 18,
    },
    infoCardBody: {
      flex: 1,
      gap: 4,
    },
    infoCardTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    infoCardText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    optionWrap: {
      gap: 12,
      marginBottom: 18,
    },
    optionCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      gap: 6,
    },
    optionCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    optionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    optionText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    sectionIntro: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 14,
      alignItems: 'flex-start',
    },
    sectionIntroText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    moreServicesToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      marginBottom: 8,
    },
    moreServicesText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    serviceCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 14,
    },
    serviceHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 8,
    },
    serviceHeaderBody: {
      flex: 1,
    },
    serviceTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    serviceCategory: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
      marginTop: 2,
    },
    serviceGuideButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
    },
    serviceGuideText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    serviceUnlocks: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 6,
      lineHeight: 18,
    },
    serviceBody: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 6,
    },
    serviceFree: {
      fontSize: 12,
      color: colors.primary,
      lineHeight: 18,
      marginBottom: 12,
    },
    summaryGrid: {
      width: '100%',
      gap: 12,
      marginBottom: 20,
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 6,
    },
    summaryTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    summaryText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    tipBox: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tipTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
    },
    tipText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    featureDiscoveryCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    featureDiscoveryIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: colors.primarySoft,
      justifyContent: 'center',
      alignItems: 'center',
    },
    featureDiscoveryTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    featureDiscoveryDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
  });
