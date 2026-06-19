import React from 'react';
import { ActivityIndicator, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Download, Puzzle, Trash2, Wrench } from 'lucide-react-native';

import { getSkillCompatibility, getSkillRequiredSecrets, getSkillSurfaceLabel } from '../../services/skills/manifest';
import { resolveSkillExecutionPlan } from '../../services/skills/routing';
import type { SkillEntry } from '../../services/skills/types';
import type { ClawHubSkill } from '../../types/clawhub';
import type {
  BrowserProviderConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import type {
  SkillEligibilityContext,
  SkillsScreenPalette,
  SkillsScreenStyles,
  SkillsScreenTranslation,
} from './skillsScreenTypes';

type SecretStatusMap = Record<string, string[]>;

function formatSkillSourceLabel(
  source: SkillEntry['source'] | undefined,
  builtInLabel: string,
): string {
  switch (source?.source) {
    case 'clawhub':
      return 'ClawHub';
    case 'url':
      return 'URL';
    case 'manual':
      return 'Manual';
    case 'bundled':
      return builtInLabel;
    default:
      return builtInLabel;
  }
}

type InstalledSkillCardProps = {
  browserProviders: BrowserProviderConfig[];
  colors: SkillsScreenPalette;
  eligibilityContext: SkillEligibilityContext;
  getCompatibilityPillLabel: (status: ReturnType<typeof getSkillCompatibility>['status']) => string;
  item: SkillEntry;
  mcpServers: McpServerConfig[];
  onDelete: (entry: SkillEntry) => void;
  onOpenSetup: (entry: SkillEntry) => void;
  secretStatus: SecretStatusMap;
  sshTargets: SshTargetConfig[];
  styles: SkillsScreenStyles;
  t: SkillsScreenTranslation;
  toggleEntry: (id: string) => void;
  workspaceTargets: WorkspaceTargetConfig[];
};

export function InstalledSkillCard({
  browserProviders,
  colors,
  eligibilityContext,
  getCompatibilityPillLabel,
  item,
  mcpServers,
  onDelete,
  onOpenSetup,
  secretStatus,
  sshTargets,
  styles,
  t,
  toggleEntry,
  workspaceTargets,
}: InstalledSkillCardProps) {
  const requiredSecrets = getSkillRequiredSecrets(item.metadata);
  const configuredSecrets = secretStatus[item.id] || [];
  const compatibility = getSkillCompatibility(item.metadata, {
    ...eligibilityContext,
    hasSecret: (secretName) => configuredSecrets.includes(secretName),
  });
  const executionPlan = resolveSkillExecutionPlan(item.metadata, {
    mcpServers,
    sshTargets,
    workspaceTargets,
    browserProviders,
  });
  const configuredCount = configuredSecrets.length;
  const needsSetup = requiredSecrets.length > 0;
  const setupComplete = needsSetup && configuredCount >= requiredSecrets.length;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Puzzle size={18} color={item.enabled ? colors.primary : colors.textTertiary} />
        <View style={styles.cardTitleSection}>
          <Text style={styles.cardTitle}>{item.metadata.name}</Text>
          {item.metadata.version ? (
            <Text style={styles.version}>
              {t('common.versionShort', { version: item.metadata.version })}
            </Text>
          ) : null}
        </View>
        <Switch
          value={item.enabled}
          onValueChange={() => toggleEntry(item.id)}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {item.metadata.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {item.metadata.description}
        </Text>
      ) : null}

      <View style={styles.statusPill}>
        <Text style={styles.statusPillText}>{getCompatibilityPillLabel(compatibility.status)}</Text>
      </View>

      {compatibility.suggestedSurfaces.length > 0 ? (
        <View style={styles.surfaceRow}>
          <Text style={styles.surfaceLabel}>{t('skills.bestRoute')}</Text>
          <View style={styles.surfaceChips}>
            {compatibility.suggestedSurfaces.map((surface) => (
              <View key={`${item.id}-${surface}`} style={styles.surfaceChip}>
                <Text style={styles.surfaceChipText}>{getSkillSurfaceLabel(surface)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {executionPlan.selectedRoute ? (
        <Text style={styles.helperText}>
          {`${getSkillSurfaceLabel(executionPlan.selectedRoute.surface)} -> ${
            executionPlan.selectedRoute.targetName || executionPlan.selectedRoute.detail
          }`}
        </Text>
      ) : null}

      {needsSetup ? (
        <View style={styles.setupRow}>
          <Text style={styles.setupText}>
            {setupComplete
              ? t('skills.setupComplete')
              : t('skills.setupStatus', {
                  configured: String(configuredCount),
                  total: String(requiredSecrets.length),
                })}
          </Text>
          <TouchableOpacity
            style={styles.setupButton}
            onPress={() => onOpenSetup(item)}
            accessibilityRole="button"
            accessibilityLabel={t('skills.configure')}
          >
            <Text style={styles.setupButtonText}>{t('skills.configure')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {compatibility.reason ? <Text style={styles.helperText}>{compatibility.reason}</Text> : null}

      {item.metadata.tools && item.metadata.tools.length > 0 ? (
        <View style={styles.toolsRow}>
          <Wrench size={12} color={colors.textTertiary} />
          <Text style={styles.toolsText}>
            {item.metadata.tools.length === 1
              ? t('skills.toolCountOne')
              : t('skills.toolCount', { count: String(item.metadata.tools.length) })}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.source}>
          {formatSkillSourceLabel(item.source, t('skills.builtIn'))}
        </Text>
        <TouchableOpacity
          onPress={() => onDelete(item)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete skill ${item.metadata?.name || item.id}`}
        >
          <Trash2 size={16} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

type BrowseSkillCardProps = {
  colors: SkillsScreenPalette;
  entries: SkillEntry[];
  installingId: string | null;
  onInstallFromHub: (skill: ClawHubSkill) => Promise<void>;
  skill: ClawHubSkill;
  styles: SkillsScreenStyles;
  t: SkillsScreenTranslation;
};

export function BrowseSkillCard({
  colors,
  entries,
  installingId,
  onInstallFromHub,
  skill,
  styles,
  t,
}: BrowseSkillCardProps) {
  const isInstalled = entries.some((entry) => entry.source?.id === skill.id);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Puzzle size={18} color={colors.primary} />
        <View style={styles.cardTitleSection}>
          <Text style={styles.cardTitle}>{skill.name}</Text>
          {skill.author ? (
            <Text style={styles.version}>{t('skills.byAuthor', { author: skill.author })}</Text>
          ) : null}
        </View>
        {isInstalled ? (
          <Text style={[styles.version, { color: colors.success || colors.primary }]}>
            {t('skills.installed')}
          </Text>
        ) : (
          <TouchableOpacity
            onPress={() => void onInstallFromHub(skill)}
            disabled={installingId === skill.id}
            accessibilityRole="button"
            accessibilityLabel={t('skills.install')}
          >
            {installingId === skill.id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Download size={20} color={colors.primary} />
            )}
          </TouchableOpacity>
        )}
      </View>
      {skill.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {skill.description}
        </Text>
      ) : null}
      <View style={styles.browseMetaRow}>
        <Text style={styles.metaText}>{t('skills.downloads', { count: String(skill.downloads) })}</Text>
        {skill.version ? (
          <Text style={styles.metaText}>
            {t('common.versionShort', { version: skill.version })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
