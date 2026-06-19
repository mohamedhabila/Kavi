import { Cpu, Globe, Key, Plus, Search, Server, Wrench } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type MainSectionMeta = {
  id: string;
  title: string;
  hint: string;
};

type SettingsOverviewSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  onLayout: (event: any) => void;
  mainSections: MainSectionMeta[];
  activeMainSection: string;
  handleJumpToMainSection: (sectionId: string) => void;
  providersCount: number;
  mcpServersCount: number;
  expoAccountsCount: number;
  expoProjectsCount: number;
  sshTargetsCount: number;
  browserProvidersCount: number;
  workspaceTargetsCount: number;
  handleEditFirstProvider: () => void | Promise<void>;
  handleNewProvider: () => void;
  handleEditFirstMcp: () => void | Promise<void>;
  handleNewMcp: () => void;
  handleEditFirstExpoAccount: () => void | Promise<void>;
  handleNewExpoAccount: () => void;
  handleEditFirstSsh: () => void | Promise<void>;
  handleNewSsh: () => void;
  handleEditFirstBrowserProvider: () => void | Promise<void>;
  handleNewBrowserProvider: () => void;
  handleEditFirstWorkspace: () => void | Promise<void>;
  handleNewWorkspace: () => void;
};

export const SettingsOverviewSection: React.FC<SettingsOverviewSectionProps> = ({
  colors,
  styles,
  t,
  onLayout,
  mainSections,
  activeMainSection,
  handleJumpToMainSection,
  providersCount,
  mcpServersCount,
  expoAccountsCount,
  expoProjectsCount,
  sshTargetsCount,
  browserProvidersCount,
  workspaceTargetsCount,
  handleEditFirstProvider,
  handleNewProvider,
  handleEditFirstMcp,
  handleNewMcp,
  handleEditFirstExpoAccount,
  handleNewExpoAccount,
  handleEditFirstSsh,
  handleNewSsh,
  handleEditFirstBrowserProvider,
  handleNewBrowserProvider,
  handleEditFirstWorkspace,
  handleNewWorkspace,
}) => {
  const expoTargetsCount = expoAccountsCount + expoProjectsCount;

  return (
    <>
      <View style={[styles.sectionCard, styles.overviewCard]} onLayout={onLayout}>
        <View style={styles.sectionCardHeader}>
          <Text style={styles.sectionCardTitle}>{t('settings.quickSetupTitle')}</Text>
          <Text style={styles.sectionCardHint}>{t('settings.quickSetupHint')}</Text>
        </View>
        <View style={styles.quickSetupGrid}>
          <TouchableOpacity
            style={[styles.quickSetupChip, providersCount > 0 && styles.quickSetupChipActive]}
            onPress={() =>
              providersCount > 0 ? void handleEditFirstProvider() : handleNewProvider()
            }
            accessibilityRole="button"
            accessibilityLabel={t('settings.quickSetupAction', {
              name: t('settings.providers'),
              count: String(providersCount),
              status: providersCount > 0 ? t('settings.configured') : t('settings.needsSetup'),
            })}
          >
            <Cpu size={16} color={providersCount > 0 ? colors.success : colors.textTertiary} />
            <Text style={[styles.quickSetupLabel, providersCount > 0 && { color: colors.text }]}>
              {t('settings.providers')} {providersCount > 0 ? `(${providersCount})` : ''}
            </Text>
            {providersCount === 0 ? <Plus size={14} color={colors.primary} /> : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickSetupChip, mcpServersCount > 0 && styles.quickSetupChipActive]}
            onPress={() => (mcpServersCount > 0 ? void handleEditFirstMcp() : handleNewMcp())}
            accessibilityRole="button"
            accessibilityLabel={t('settings.quickSetupAction', {
              name: t('settings.mcpServers'),
              count: String(mcpServersCount),
              status: mcpServersCount > 0 ? t('settings.configured') : t('settings.needsSetup'),
            })}
          >
            <Server size={16} color={mcpServersCount > 0 ? colors.success : colors.textTertiary} />
            <Text style={[styles.quickSetupLabel, mcpServersCount > 0 && { color: colors.text }]}>
              {t('settings.mcpServers')} {mcpServersCount > 0 ? `(${mcpServersCount})` : ''}
            </Text>
            {mcpServersCount === 0 ? <Plus size={14} color={colors.primary} /> : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickSetupChip, expoTargetsCount > 0 && styles.quickSetupChipActive]}
            onPress={() =>
              expoAccountsCount > 0 ? void handleEditFirstExpoAccount() : handleNewExpoAccount()
            }
            accessibilityRole="button"
            accessibilityLabel={t('settings.quickSetupAction', {
              name: t('settings.expoAccounts'),
              count: String(expoTargetsCount),
              status: expoTargetsCount > 0 ? t('settings.configured') : t('settings.needsSetup'),
            })}
          >
            <Globe size={16} color={expoTargetsCount > 0 ? colors.success : colors.textTertiary} />
            <Text style={[styles.quickSetupLabel, expoTargetsCount > 0 && { color: colors.text }]}>
              {t('settings.quickSetupExpo')} {expoTargetsCount > 0 ? `(${expoTargetsCount})` : ''}
            </Text>
            {expoTargetsCount === 0 ? <Plus size={14} color={colors.primary} /> : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickSetupChip, sshTargetsCount > 0 && styles.quickSetupChipActive]}
            onPress={() => (sshTargetsCount > 0 ? void handleEditFirstSsh() : handleNewSsh())}
            accessibilityRole="button"
            accessibilityLabel={t('settings.quickSetupAction', {
              name: t('settings.sshTargets'),
              count: String(sshTargetsCount),
              status: sshTargetsCount > 0 ? t('settings.configured') : t('settings.needsSetup'),
            })}
          >
            <Key size={16} color={sshTargetsCount > 0 ? colors.success : colors.textTertiary} />
            <Text style={[styles.quickSetupLabel, sshTargetsCount > 0 && { color: colors.text }]}>
              {t('settings.sshTargets')} {sshTargetsCount > 0 ? `(${sshTargetsCount})` : ''}
            </Text>
            {sshTargetsCount === 0 ? <Plus size={14} color={colors.primary} /> : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickSetupChip,
              browserProvidersCount > 0 && styles.quickSetupChipActive,
            ]}
            onPress={() =>
              browserProvidersCount > 0
                ? void handleEditFirstBrowserProvider()
                : handleNewBrowserProvider()
            }
            accessibilityRole="button"
            accessibilityLabel={t('settings.quickSetupAction', {
              name: t('settings.browserProviders'),
              count: String(browserProvidersCount),
              status:
                browserProvidersCount > 0 ? t('settings.configured') : t('settings.needsSetup'),
            })}
          >
            <Search
              size={16}
              color={browserProvidersCount > 0 ? colors.success : colors.textTertiary}
            />
            <Text
              style={[styles.quickSetupLabel, browserProvidersCount > 0 && { color: colors.text }]}
            >
              {t('settings.browserProviders')}{' '}
              {browserProvidersCount > 0 ? `(${browserProvidersCount})` : ''}
            </Text>
            {browserProvidersCount === 0 ? <Plus size={14} color={colors.primary} /> : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickSetupChip,
              workspaceTargetsCount > 0 && styles.quickSetupChipActive,
            ]}
            onPress={() =>
              workspaceTargetsCount > 0 ? void handleEditFirstWorkspace() : handleNewWorkspace()
            }
            accessibilityRole="button"
            accessibilityLabel={t('settings.quickSetupAction', {
              name: t('settings.workspaceTargets'),
              count: String(workspaceTargetsCount),
              status:
                workspaceTargetsCount > 0 ? t('settings.configured') : t('settings.needsSetup'),
            })}
          >
            <Wrench
              size={16}
              color={workspaceTargetsCount > 0 ? colors.success : colors.textTertiary}
            />
            <Text
              style={[styles.quickSetupLabel, workspaceTargetsCount > 0 && { color: colors.text }]}
            >
              {t('settings.workspaceTargets')}{' '}
              {workspaceTargetsCount > 0 ? `(${workspaceTargetsCount})` : ''}
            </Text>
            {workspaceTargetsCount === 0 ? <Plus size={14} color={colors.primary} /> : null}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sectionChipRow}
        style={styles.sectionChipScroller}
      >
        {mainSections.map((sectionMeta) => {
          const active = activeMainSection === sectionMeta.id;

          return (
            <TouchableOpacity
              key={sectionMeta.id}
              style={[styles.sectionChip, active ? styles.sectionChipActive : null]}
              onPress={() => handleJumpToMainSection(sectionMeta.id)}
              accessibilityRole="button"
              accessibilityLabel={sectionMeta.title}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.sectionChipText, active ? styles.sectionChipTextActive : null]}>
                {sectionMeta.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );
};
