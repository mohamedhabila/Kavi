// ---------------------------------------------------------------------------
// Kavi — ModelSelector Component
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronDown, RefreshCw } from 'lucide-react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { LlmService } from '../../services/llm/LlmService';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { getProviderApiKey } from '../../services/storage/SecureStorage';
import { useTranslation } from '../../i18n/useTranslation';
import { getKnownProviderFallbackModels } from '../../constants/api';
import { isOnDeviceLlmProvider } from '../../services/localLlm/provider';
import { getLocalLlmModelDisplayName } from '../../services/localLlm/catalog';

interface ModelSelectorProps {
  selectedProviderId: string | null;
  selectedModel: string | null;
  onSelect: (providerId: string, model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = React.memo(
  ({ selectedProviderId, selectedModel, onSelect }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = createStyles(colors);
    const providers = useSettingsStore((s) => s.providers);
    const [visible, setVisible] = useState(false);
    const [models, setModels] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [viewProviderId, setViewProviderId] = useState<string | null>(null);
    const mountedRef = useRef(true);
    const fetchRequestIdRef = useRef(0);

    const activeProvider = providers.find((p) => p.id === selectedProviderId) || providers[0];
    const viewProvider = providers.find((p) => p.id === viewProviderId) || activeProvider;
    const getModelLabel = useCallback(
      (provider: typeof activeProvider | undefined, model: string | null | undefined) => {
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
      async (provider: typeof activeProvider) => {
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
            setLoading(true);
            setFetchError(null);
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
            });
          } else {
            const fallbackModels = getKnownProviderFallbackModels(provider);
            if (fallbackModels.length > 0) {
              commit(() => {
                setModels((prev) => ({ ...prev, [provider.id]: fallbackModels }));
              });
            } else {
              commit(() => {
                setFetchError(t('model.noModels'));
              });
            }
          }
        } catch (err: unknown) {
          const fallbackModels = getKnownProviderFallbackModels(provider);
          if (fallbackModels.length > 0) {
            commit(() => {
              setModels((prev) => ({ ...prev, [provider.id]: fallbackModels }));
            });
          } else {
            commit(() => {
              setFetchError((err instanceof Error ? err.message : '') || t('model.noModels'));
            });
          }
        } finally {
          commit(() => {
            setLoading(false);
          });
        }
      },
      [t],
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

    const providerModels = viewProvider
      ? models[viewProvider.id] || viewProvider.availableModels || []
      : [];
    const displayName = getModelLabel(activeProvider, selectedModel || activeProvider?.model);

    return (
      <>
        <TouchableOpacity
          testID="model-selector-trigger"
          style={styles.selector}
          onPress={() => setVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={t('model.selectorLabel', { name: displayName })}
        >
          <Text style={styles.selectorText} numberOfLines={1}>
            {displayName}
          </Text>
          <ChevronDown size={14} color={colors.textSecondary} />
        </TouchableOpacity>

        <Modal
          visible={visible}
          transparent
          animationType="slide"
          onRequestClose={() => setVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('model.title')}</Text>
                <TouchableOpacity
                  onPress={() => viewProvider && fetchModels(viewProvider)}
                  accessibilityRole="button"
                  accessibilityLabel={t('model.refreshModelsLabel')}
                >
                  <RefreshCw size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {/* Provider tabs */}
              {providers.length > 1 && (
                <FlatList
                  testID="model-selector-provider-tabs"
                  horizontal
                  data={providers.filter((p) => p.enabled)}
                  keyExtractor={(p) => p.id}
                  showsHorizontalScrollIndicator={false}
                  style={styles.providerTabs}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.providerTab,
                        item.id === viewProvider?.id && styles.providerTabActive,
                      ]}
                      onPress={() => {
                        setViewProviderId(item.id);
                        if (!models[item.id]) fetchModels(item);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name} provider`}
                      accessibilityState={{ selected: item.id === viewProvider?.id }}
                    >
                      <Text
                        style={[
                          styles.providerTabText,
                          item.id === activeProvider?.id && styles.providerTabTextActive,
                        ]}
                      >
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              )}

              {loading ? (
                <ActivityIndicator style={{ padding: 40 }} color={colors.primary} />
              ) : fetchError ? (
                <View style={{ padding: 20, alignItems: 'center', gap: 12 }}>
                  <Text style={[styles.emptyText, { color: colors.danger }]}>{fetchError}</Text>
                  <TouchableOpacity
                    style={[styles.providerTab, styles.providerTabActive]}
                    onPress={() => viewProvider && fetchModels(viewProvider)}
                    accessibilityRole="button"
                    accessibilityLabel={t('model.retryFetchingModels')}
                  >
                    <Text style={styles.providerTabTextActive}>{t('common.retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <FlatList
                  testID="model-selector-model-list"
                  data={providerModels}
                  keyExtractor={(item) => item}
                  style={styles.modelList}
                  renderItem={({ item }) => {
                    const isSelected = item === selectedModel;
                    return (
                      <TouchableOpacity
                        style={[styles.modelItem, isSelected && styles.modelItemSelected]}
                        onPress={() => {
                          if (viewProvider) {
                            onSelect(viewProvider.id, item);
                          }
                          setVisible(false);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('model.selectModel', { name: item })}
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[styles.modelName, isSelected && styles.modelNameSelected]}
                          numberOfLines={1}
                        >
                          {getModelLabel(viewProvider, item)}
                        </Text>
                        {isSelected && <Check size={16} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={<Text style={styles.emptyText}>{t('model.noModels')}</Text>}
                />
              )}

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t('model.closeSelector')}
              >
                <Text style={styles.closeBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  },
);

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    selector: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 16,
      alignSelf: 'flex-start',
      flexGrow: 0,
      flexShrink: 1,
      maxWidth: '100%',
      minWidth: 0,
    },
    selectorText: {
      fontSize: 13,
      color: colors.text,
      flexShrink: 1,
      minWidth: 0,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    modal: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '70%',
      paddingTop: 16,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    providerTabs: {
      flexGrow: 0,
      height: 48,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    providerTab: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      marginRight: 8,
      backgroundColor: colors.surfaceAlt,
    },
    providerTabActive: {
      backgroundColor: colors.primarySoft,
    },
    providerTabText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    providerTabTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    modelList: {
      flexShrink: 1,
      paddingHorizontal: 16,
    },
    modelItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    modelItemSelected: {
      backgroundColor: colors.primarySoft,
    },
    modelName: {
      fontSize: 14,
      color: colors.text,
      flex: 1,
    },
    modelNameSelected: {
      fontWeight: '600',
      color: colors.primary,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      padding: 40,
    },
    closeBtn: {
      padding: 16,
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    closeBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.primary,
    },
  });
