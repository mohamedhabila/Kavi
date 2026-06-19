import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';

import type { McpHubEntry, McpHubInputSpec } from '../../services/mcp/registryClient';
import type { McpStatusPalette, McpStatusStyles, McpStatusTranslation } from './mcpStatusTypes';

type McpInstallModalProps = {
  colors: McpStatusPalette;
  completeInstall: (
    entry: McpHubEntry,
    remoteId?: string | null,
    values?: Record<string, string>,
  ) => Promise<void>;
  getBrowseChips: (entry: McpHubEntry) => string[];
  installEntry: McpHubEntry | null;
  installFields: McpHubInputSpec[];
  installValues: Record<string, string>;
  onClose: () => void;
  onRemoteChange: (remote: McpHubEntry['remotes'][number]) => void;
  selectedRemoteId: string | null;
  setInstallValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  styles: McpStatusStyles;
  t: McpStatusTranslation;
};

export function McpInstallModal({
  colors,
  completeInstall,
  getBrowseChips,
  installEntry,
  installFields,
  installValues,
  onClose,
  onRemoteChange,
  selectedRemoteId,
  setInstallValues,
  styles,
  t,
}: McpInstallModalProps) {
  return (
    <Modal visible={!!installEntry} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('mcpStatus.installServer')}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {installEntry ? (
            <>
              <Text style={styles.modalHelp}>{installEntry.name}</Text>
              <Text style={styles.modalCaption}>{t('mcpStatus.installHint')}</Text>
              <View style={styles.metaChipRow}>
                {getBrowseChips(installEntry).map((chip) => (
                  <View key={`modal-${installEntry.id}-${chip}`} style={styles.metaChip}>
                    <Text style={styles.metaChipText}>{chip}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.metadataText}>
                {t('mcpStatus.registryName', {
                  name: installEntry.trust?.registryName || installEntry.registryName,
                })}
              </Text>
              {installEntry.websiteUrl ? (
                <Text style={styles.metadataText}>
                  {t('mcpStatus.website', { url: installEntry.websiteUrl })}
                </Text>
              ) : null}

              {installEntry.remotes.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>{t('mcpStatus.endpoint')}</Text>
                  <View style={styles.remotePickerRow}>
                    {installEntry.remotes.map((remote) => (
                      <TouchableOpacity
                        key={remote.id}
                        style={[
                          styles.remotePickerChip,
                          selectedRemoteId === remote.id && styles.remotePickerChipActive,
                        ]}
                        onPress={() => onRemoteChange(remote)}
                      >
                        <Text
                          style={[
                            styles.remotePickerChipText,
                            selectedRemoteId === remote.id && styles.remotePickerChipTextActive,
                          ]}
                        >
                          {remote.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}

              {installFields.map((field) => (
                <View key={`${field.kind}:${field.key}`} style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </Text>
                  {field.description ? (
                    <Text style={styles.fieldHint}>{field.description}</Text>
                  ) : null}
                  <TextInput
                    style={styles.searchInput}
                    value={installValues[field.key] || ''}
                    onChangeText={(text) =>
                      setInstallValues((current) => ({ ...current, [field.key]: text }))
                    }
                    placeholder={field.defaultValue || field.label}
                    placeholderTextColor={colors.placeholder}
                    secureTextEntry={field.secret}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}

              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={() => {
                  void completeInstall(installEntry, selectedRemoteId, installValues);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('mcpStatus.install')}
              >
                <Text style={styles.primaryActionText}>{t('mcpStatus.install')}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
