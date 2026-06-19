import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../../theme/useAppTheme';
import type { McpServerConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

const MCP_TRANSPORT_OPTIONS: Array<NonNullable<McpServerConfig['transport']>> = [
  'auto',
  'streamable-http',
  'sse',
];

type McpBasicsSectionProps = {
  draft: McpServerConfig;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  setDraft: React.Dispatch<React.SetStateAction<McpServerConfig | null>>;
  mcpTimeoutText?: string;
  setMcpTimeoutText?: (value: string) => void;
  getLocalizedMcpTransportLabel: (transport?: McpServerConfig['transport']) => string;
};

export const McpBasicsSection: React.FC<McpBasicsSectionProps> = ({
  draft,
  colors,
  styles,
  t,
  setDraft,
  mcpTimeoutText,
  setMcpTimeoutText,
  getLocalizedMcpTransportLabel,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceBasicsSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.serverName')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.name}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, name: value } : current))
        }
        placeholder={t('settings.serverNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.detailLabel}>{t('settings.serverUrl')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.url}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, url: value } : current))
        }
        placeholder={t('settings.serverUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.formHint}>{t('settings.mcpManualServerHint')}</Text>

      <Text style={styles.detailLabel}>{t('settings.serverTransport')}</Text>
      <View style={styles.optionRow}>
        {MCP_TRANSPORT_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionChip, draft.transport === option ? styles.optionChipActive : null]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, transport: option } : current))
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.transport === option ? styles.optionChipTextActive : null,
              ]}
            >
              {getLocalizedMcpTransportLabel(option)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.detailLabel}>{t('settings.serverLegacySseUrl')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.sseUrl || ''}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, sseUrl: value } : current))
        }
        placeholder={t('settings.serverLegacySseUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.formHint}>{t('settings.serverLegacySseUrlHint')}</Text>

      <Text style={styles.detailLabel}>{t('settings.serverTimeoutMs')}</Text>
      <TextInput
        style={styles.configInput}
        value={mcpTimeoutText ?? String(draft.timeoutMs ?? 30000)}
        onChangeText={(value) => {
          if (setMcpTimeoutText) {
            setMcpTimeoutText(value);
            return;
          }

          const nextTimeout = Number.parseInt(value, 10);
          setDraft((current) =>
            current
              ? {
                  ...current,
                  timeoutMs: Number.isFinite(nextTimeout) ? nextTimeout : undefined,
                }
              : current,
          );
        }}
        placeholder="30000"
        placeholderTextColor={colors.placeholder}
        keyboardType="number-pad"
      />
    </View>
  );
};
