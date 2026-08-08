// ---------------------------------------------------------------------------
// Kavi — ModelSelector Component
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronDown, RefreshCw, Search, X } from 'lucide-react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { LlmService } from '../../services/llm/LlmService';
import { useAppTheme } from '../../theme/useAppTheme';
import { getProviderApiKey } from '../../services/storage/SecureStorage';
import { useTranslation } from '../../i18n/useTranslation';
import { getKnownProviderFallbackModels, inferModelCapabilities } from '../../constants/api';
import { isOnDeviceLlmProvider } from '../../services/localLlm/provider';
import { getLocalLlmModelDisplayName } from '../../services/localLlm/catalog';
import type { LlmProviderConfig } from '../../types/provider';
import type { ModelCapabilities } from '../../types/tool';
import { createModelSelectorStyles } from './ModelSelector.styles';

interface ModelSelectorProps {
  disabled?: boolean;
  selectedProviderId: string | null;
  selectedModel: string | null;
  onSelect: (providerId: string, model: string) => void;
  variant?: 'compact' | 'full';
}

function uniqueModels(models: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      models.map((model) => model?.trim()).filter((model): model is string => Boolean(model)),
    ),
  );
}

function getCapabilityLabels(
  capabilities: ModelCapabilities,
  t: (key: string, params?: Record<string, string | number>) => string,
): string[] {
  return [
    capabilities.vision ? t('model.vision') : null,
    capabilities.tools ? t('model.tools') : null,
    capabilities.fileInput ? t('model.fileInput') : null,
  ].filter((label): label is string => Boolean(label));
}

export const ModelSelector: React.FC<ModelSelectorProps> = React.memo(
  ({ disabled = false, selectedProviderId, selectedModel, onSelect, variant = 'compact' }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createModelSelectorStyles(colors), [colors]);
    const providers = useSettingsStore((s) => s.providers);
    const lastUsedModel = useSettingsStore((s) => s.lastUsedModel);
    const updateProvider = useSettingsStore((s) => s.updateProvider);
    const [visible, setVisible] = useState(false);
    const [models, setModels] = useState<Record<string, string[]>>({});
    const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
    const [fetchErrors, setFetchErrors] = useState<Record<string, string | null>>({});
    const [viewProviderId, setViewProviderId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const mountedRef = useRef(true);
    const fetchRequestIdRef = useRef(0);

    const enabledProviders = useMemo(
      () => providers.filter((provider) => provider.enabled),
      [providers],
    );
    const selectedProvider =
      providers.find((provider) => provider.id === selectedProviderId) ||
      enabledProviders[0] ||
      providers[0];
    const selectableProvider = selectedProvider?.enabled ? selectedProvider : enabledProviders[0];
    const viewProvider =
      enabledProviders.find((provider) => provider.id === viewProviderId) || selectableProvider;
    const resolvedSelectedModel = selectedModel || selectedProvider?.model || null;
    const getModelLabel = useCallback(
      (provider: LlmProviderConfig | undefined, model: string | null | undefined) => {
        if (!model) {
          return t('model.title');
        }

        if (provider && isOnDeviceLlmProvider(provider)) {
          return getLocalLlmModelDisplayName(model);
        }

        return model;
      },
      [t],
    );

    const fetchModels = useCallback(
      async (provider: LlmProviderConfig | undefined) => {
        if (!provider) return;
        const requestId = ++fetchRequestIdRef.current;
        const commit = (update: () => void): boolean => {
          if (!mountedRef.current || fetchRequestIdRef.current !== requestId) {
            return false;
          }

          update();
          return true;
        };

        if (
          !commit(() => {
            setLoadingProviderId(provider.id);
            setFetchErrors((current) => ({ ...current, [provider.id]: null }));
          })
        ) {
          return;
        }

        try {
          const apiKey = isOnDeviceLlmProvider(provider)
            ? provider.apiKey
            : (await getProviderApiKey(provider.id)) || provider.apiKey;
          const llm = new LlmService({ ...provider, apiKey });
          const result = await llm.fetchModels();
          if (result.models.length > 0) {
            commit(() => {
              setModels((prev) => ({ ...prev, [provider.id]: result.models }));
              updateProvider({
                ...provider,
                availableModels: result.models,
                modelCapabilities: {
                  ...(provider.modelCapabilities ?? {}),
                  ...result.capabilities,
                },
                // Persisted so the window survives a relaunch: discovery only runs when
                // this picker is opened, and getContextWindow otherwise falls back to a
                // static table that defaults unlisted models to 128k.
                modelContextWindows: {
                  ...(provider.modelContextWindows ?? {}),
                  ...result.contextWindows,
                },
              });
            });
          } else {
            const fallbackModels = getKnownProviderFallbackModels(provider);
            if (fallbackModels.length > 0) {
              commit(() => {
                setModels((prev) => ({ ...prev, [provider.id]: fallbackModels }));
              });
            } else {
              commit(() => {
                setFetchErrors((current) => ({
                  ...current,
                  [provider.id]: t('model.noModels'),
                }));
              });
            }
          }
        } catch {
          const fallbackModels = getKnownProviderFallbackModels(provider);
          if (fallbackModels.length > 0) {
            commit(() => {
              setModels((prev) => ({ ...prev, [provider.id]: fallbackModels }));
            });
          } else {
            commit(() => {
              setFetchErrors((current) => ({
                ...current,
                [provider.id]: t('model.fetchFailed'),
              }));
            });
          }
        } finally {
          commit(() => {
            setLoadingProviderId(null);
          });
        }
      },
      [t, updateProvider],
    );

    useEffect(() => {
      mountedRef.current = true;

      return () => {
        mountedRef.current = false;
        fetchRequestIdRef.current += 1;
      };
    }, []);

    useEffect(() => {
      if (visible && viewProvider && !models[viewProvider.id]) {
        void fetchModels(viewProvider);
      }
    }, [fetchModels, models, viewProvider, visible]);

    const providerModels = useMemo(() => {
      if (!viewProvider) return [];

      const currentModel =
        viewProvider.id === selectedProvider?.id ? resolvedSelectedModel : undefined;
      const recentModel =
        lastUsedModel?.providerId === viewProvider.id ? lastUsedModel.model : undefined;
      const hiddenModels = new Set(viewProvider.hiddenModels || []);
      const discoveredModels = models[viewProvider.id] || viewProvider.availableModels || [];

      return uniqueModels([
        currentModel,
        recentModel,
        viewProvider.model,
        ...discoveredModels,
      ]).filter((model) => model === currentModel || !hiddenModels.has(model));
    }, [lastUsedModel, models, resolvedSelectedModel, selectedProvider?.id, viewProvider]);
    const filteredModels = useMemo(() => {
      const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
      if (!normalizedQuery) return providerModels;

      return providerModels.filter((model) => {
        const label = getModelLabel(viewProvider, model);
        return (
          model.toLocaleLowerCase().includes(normalizedQuery) ||
          label.toLocaleLowerCase().includes(normalizedQuery)
        );
      });
    }, [getModelLabel, providerModels, searchQuery, viewProvider]);
    const loading = Boolean(viewProvider && loadingProviderId === viewProvider.id);
    const fetchError = viewProvider ? fetchErrors[viewProvider.id] : null;
    const displayName = getModelLabel(selectedProvider, resolvedSelectedModel);

    const openSelector = useCallback(() => {
      const initialProvider = selectedProvider?.enabled ? selectedProvider : enabledProviders[0];
      setViewProviderId(initialProvider?.id || null);
      setSearchQuery('');
      setVisible(true);
    }, [enabledProviders, selectedProvider]);

    const closeSelector = useCallback(() => {
      setSearchQuery('');
      setVisible(false);
    }, []);

    const viewProviderModels = useCallback((provider: LlmProviderConfig) => {
      fetchRequestIdRef.current += 1;
      setLoadingProviderId(null);
      setViewProviderId(provider.id);
      setSearchQuery('');
    }, []);

    return (
      <>
        <TouchableOpacity
          testID="model-selector-trigger"
          style={[
            styles.selector,
            variant === 'full' ? styles.selectorFull : null,
            disabled ? styles.selectorDisabled : null,
          ]}
          onPress={openSelector}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('model.selectorLabel', { name: displayName })}
          accessibilityState={{ disabled }}
        >
          <Text
            style={[styles.selectorText, variant === 'full' ? styles.selectorTextFull : null]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <ChevronDown size={14} color={colors.textSecondary} />
        </TouchableOpacity>

        <Modal visible={visible} transparent animationType="slide" onRequestClose={closeSelector}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              accessible={false}
              onPress={closeSelector}
              style={styles.backdropDismiss}
              testID="model-selector-backdrop"
            />
            <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.modal}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('model.title')}</Text>
                <TouchableOpacity
                  disabled={loading || !viewProvider}
                  onPress={() => viewProvider && fetchModels(viewProvider)}
                  accessibilityRole="button"
                  accessibilityLabel={t('model.refreshModelsLabel')}
                  accessibilityState={{ busy: loading, disabled: loading || !viewProvider }}
                  style={styles.headerAction}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <RefreshCw size={19} color={colors.primary} />
                  )}
                </TouchableOpacity>
              </View>

              {enabledProviders.length > 1 ? (
                <FlatList
                  testID="model-selector-provider-tabs"
                  horizontal
                  data={enabledProviders}
                  keyExtractor={(provider) => provider.id}
                  showsHorizontalScrollIndicator={false}
                  style={styles.providerTabs}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.providerTab,
                        item.id === viewProvider?.id && styles.providerTabActive,
                      ]}
                      onPress={() => viewProviderModels(item)}
                      accessibilityRole="button"
                      accessibilityLabel={t('model.providerLabel', { name: item.name })}
                      accessibilityState={{ selected: item.id === viewProvider?.id }}
                    >
                      <Text
                        style={[
                          styles.providerTabText,
                          item.id === viewProvider?.id && styles.providerTabTextActive,
                        ]}
                      >
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              ) : null}

              <View style={styles.searchRow}>
                <Search color={colors.textSecondary} size={18} />
                <TextInput
                  accessibilityLabel={t('model.searchModels')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setSearchQuery}
                  placeholder={t('model.searchModelsPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  returnKeyType="search"
                  style={styles.searchInput}
                  value={searchQuery}
                />
                {searchQuery ? (
                  <TouchableOpacity
                    accessibilityLabel={t('model.clearModelSearch')}
                    accessibilityRole="button"
                    onPress={() => setSearchQuery('')}
                    style={styles.searchClear}
                  >
                    <X color={colors.textSecondary} size={18} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {loading ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingText}>{t('model.loadingModels')}</Text>
                </View>
              ) : fetchError ? (
                <View style={styles.errorState}>
                  <Text style={[styles.emptyText, { color: colors.danger }]}>{fetchError}</Text>
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={() => viewProvider && fetchModels(viewProvider)}
                    accessibilityRole="button"
                    accessibilityLabel={t('model.retryFetchingModels')}
                  >
                    <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <FlatList
                  testID="model-selector-model-list"
                  data={filteredModels}
                  initialNumToRender={12}
                  keyExtractor={(item) => item}
                  keyboardShouldPersistTaps="handled"
                  maxToRenderPerBatch={12}
                  style={styles.modelList}
                  windowSize={7}
                  renderItem={({ item }) => {
                    const isSelected =
                      viewProvider?.id === selectedProvider?.id && item === resolvedSelectedModel;
                    const isRecent =
                      !isSelected &&
                      lastUsedModel?.providerId === viewProvider?.id &&
                      lastUsedModel.model === item;
                    const modelLabel = getModelLabel(viewProvider, item);
                    const capabilities =
                      viewProvider?.modelCapabilities?.[item] || inferModelCapabilities(item);
                    const capabilityLabels = getCapabilityLabels(capabilities, t);
                    return (
                      <TouchableOpacity
                        style={[styles.modelItem, isSelected && styles.modelItemSelected]}
                        onPress={() => {
                          if (viewProvider) {
                            onSelect(viewProvider.id, item);
                          }
                          closeSelector();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('model.selectModel', { name: modelLabel })}
                        accessibilityHint={capabilityLabels.join(', ') || undefined}
                        accessibilityState={{ selected: isSelected }}
                      >
                        <View style={styles.modelCopy}>
                          <View style={styles.modelTitleRow}>
                            <Text
                              style={[styles.modelName, isSelected && styles.modelNameSelected]}
                              numberOfLines={1}
                            >
                              {modelLabel}
                            </Text>
                            {isSelected || isRecent ? (
                              <View style={styles.statusBadge}>
                                <Text style={styles.statusBadgeText}>
                                  {isSelected ? t('model.current') : t('model.recent')}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {capabilityLabels.length > 0 ? (
                            <View style={styles.capabilityRow}>
                              {capabilityLabels.map((label) => (
                                <View key={label} style={styles.capabilityBadge}>
                                  <Text style={styles.capabilityBadgeText}>{label}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        {isSelected && <Check size={16} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>
                      {searchQuery.trim() ? t('model.noSearchResults') : t('model.noModels')}
                    </Text>
                  }
                />
              )}

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeSelector}
                accessibilityRole="button"
                accessibilityLabel={t('model.closeSelector')}
              >
                <Text style={styles.closeBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </SafeAreaView>
          </View>
        </Modal>
      </>
    );
  },
);
