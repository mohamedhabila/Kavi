// ---------------------------------------------------------------------------
// Kavi — Onboarding Wizard
// ---------------------------------------------------------------------------
// First-run experience: Welcome → Model setup → Tool setup → Summary.

import React, { useState, useMemo, useCallback } from 'react';
import { Linking, Text, View } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppTheme } from '../../theme/useAppTheme';
import { createOnboardingWizardStyles as createStyles } from './onboardingWizardStyles';
import { useTranslation } from '../../i18n/useTranslation';
import {
  buildProviderFromPreset,
  finalizeProviderConfig,
  isOnDeviceProviderPreset,
} from '../../constants/api';
import { generateId } from '../../utils/id';
import { saveProviderApiKey, saveSecure } from '../../services/storage/SecureStorage';
import { LlmProviderConfig } from '../../types/provider';
import { WebSearchProvider } from '../../types/tool';
import { getLocalLlmCatalogEntriesForProvider } from '../../services/localLlm/catalog';
import { isLocalLlmModelInstalled } from '../../services/localLlm/modelArtifacts';
import { useLocalLlmModelDownload } from '../../hooks/useLocalLlmModelDownload';
import {
  buildProviderGuides,
  buildServiceGuides,
  buildWebProviderOptions,
  type ProviderGuide,
  type ServiceGuide,
  type Step,
} from './onboardingGuides';
import { OnboardingWizardProvider } from './OnboardingWizardContext';
import { DoneStep } from './steps/DoneStep';
import { FeaturesStep } from './steps/FeaturesStep';
import { ProviderKeyStep } from './steps/ProviderKeyStep';
import { ProviderStep } from './steps/ProviderStep';
import { ToolsStep } from './steps/ToolsStep';
import { WelcomeStep } from './steps/WelcomeStep';

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

  const contextValue = {
    additionalServices,
    apiKey,
    canSaveProvider,
    colors,
    configuredProviderName,
    configuredServiceCount,
    currentProgressIndex,
    customBaseUrl,
    customModel,
    customName,
    handleDownloadSelectedOnDeviceModel,
    handleFinish,
    handleOpenUrl,
    handleSaveProvider,
    handleSaveTools,
    handleSelectGuide,
    handleSkipProvider,
    localCatalog,
    onComplete,
    onDeviceDownloadInProgress,
    onDeviceDownloadState,
    onDeviceModelWasJustDownloaded,
    primaryServices,
    progress,
    progressHeader,
    providerGuides,
    saveError,
    saving,
    selectedGuide,
    selectedGuideIsOnDevice,
    selectedOnDeviceCatalogEntry,
    selectedOnDeviceModelInstalled,
    serviceKeys,
    setApiKey,
    setCustomBaseUrl,
    setCustomModel,
    setCustomName,
    setServiceKeys,
    setShowMoreServices,
    setStep,
    setWebSearchProviderState,
    showMoreServices,
    styles,
    t,
    webProviderOptions,
    webSearchProvider,
  };

  const renderStep = () => {
    switch (step) {
      case 'welcome':
        return <WelcomeStep />;
      case 'provider':
        return <ProviderStep />;
      case 'providerKey':
        return <ProviderKeyStep />;
      case 'tools':
        return <ToolsStep />;
      case 'features':
        return <FeaturesStep />;
      case 'done':
      default:
        return <DoneStep />;
    }
  };

  return <OnboardingWizardProvider value={contextValue}>{renderStep()}</OnboardingWizardProvider>;
};
