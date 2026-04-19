import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTranslation } from '../../i18n';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { AgentRun, AgentRunPhase, AgentRunStatus } from '../../types';
import { humanizeToolName } from './ToolCallDisplay';
import {
  extractToolNameFromCheckpointTitle,
  getAgentRunDisplayPhase,
  getLatestAgentRunToolCheckpoint,
} from '../../services/agents/agentRunPresentation';
import { formatCompactElapsed } from '../../services/agents/subAgentPresentation';

interface AgentWorkflowWidgetProps {
  run: AgentRun;
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function translateOrFallback(t: TranslateFn, key: string, fallback: string) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function formatWorkflowStatusLabel(status: AgentRunStatus, t: TranslateFn): string {
  switch (status) {
    case 'completed':
      return translateOrFallback(t, 'chat.agentWorkflow.status.completed', 'Completed');
    case 'failed':
      return translateOrFallback(t, 'chat.agentWorkflow.status.failed', 'Failed');
    case 'cancelled':
      return translateOrFallback(t, 'chat.agentWorkflow.status.cancelled', 'Cancelled');
    default:
      return translateOrFallback(t, 'chat.agentWorkflow.status.running', 'Running');
  }
}

function formatWorkflowPhaseTitle(
  phase: Pick<AgentRunPhase, 'key' | 'title'>,
  t: TranslateFn,
): string {
  return translateOrFallback(t, `chat.agentWorkflow.phase.${phase.key}`, phase.title);
}

function formatWorkflowCheckpointKind(
  kind: AgentRun['checkpoints'][number]['kind'],
  t: TranslateFn,
): string {
  switch (kind) {
    case 'phase':
      return translateOrFallback(t, 'chat.agentWorkflow.checkpointKind.phase', 'Phase');
    case 'tool':
      return translateOrFallback(t, 'chat.agentWorkflow.checkpointKind.tool', 'Tool');
    case 'sub-agent':
      return translateOrFallback(t, 'chat.agentWorkflow.checkpointKind.worker', 'Worker');
    case 'note':
      return translateOrFallback(t, 'chat.agentWorkflow.checkpointKind.note', 'Note');
    default:
      return translateOrFallback(t, 'chat.agentWorkflow.checkpointKind.run', 'Run');
  }
}

function buildLocalizedAgentRunSummaryText(
  summary: AgentRun['summary'] | undefined,
  t: TranslateFn,
): string | undefined {
  if (!summary) {
    return undefined;
  }

  const parts = [
    t('chat.agentWorkflow.summary.turns', { count: summary.assistantTurns }),
    t('chat.agentWorkflow.summary.tools', {
      completed: summary.completedTools,
      started: summary.startedTools,
    }),
  ];

  if (summary.failedTools > 0) {
    parts.push(t('chat.agentWorkflow.summary.failed', { count: summary.failedTools }));
  }

  if (summary.spawnedSubAgents > 0) {
    parts.push(t('chat.agentWorkflow.summary.workers', { count: summary.spawnedSubAgents }));
  }

  if (summary.durationMs && summary.durationMs > 0) {
    parts.push(formatCompactElapsed(summary.durationMs));
  }

  return parts.join(' · ');
}

function formatPilotControlActionLabel(
  action: NonNullable<AgentRun['latestPilotEvaluation']>['controlAction'],
  t: TranslateFn,
): string {
  return translateOrFallback(
    t,
    `chat.agentWorkflow.controlAction.${action}`,
    action.charAt(0).toUpperCase() + action.slice(1),
  );
}

function formatPilotConfidenceLabel(
  confidence: NonNullable<AgentRun['latestPilotEvaluation']>['confidence'],
  t: TranslateFn,
): string {
  return translateOrFallback(
    t,
    `chat.agentWorkflow.confidence.${confidence}`,
    confidence.charAt(0).toUpperCase() + confidence.slice(1),
  );
}

function getStatusPalette(status: AgentRunStatus, colors: AppPalette) {
  if (status === 'failed') {
    return {
      badge: {
        backgroundColor: colors.dangerSoft,
        borderColor: colors.danger,
      },
      text: {
        color: colors.danger,
      },
    };
  }

  if (status === 'cancelled') {
    return {
      badge: {
        backgroundColor: colors.surfaceAlt,
        borderColor: colors.border,
      },
      text: {
        color: colors.textSecondary,
      },
    };
  }

  return {
    badge: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    text: {
      color: colors.primary,
    },
  };
}

function getPhasePalette(status: AgentRunPhase['status'], colors: AppPalette) {
  if (status === 'failed') {
    return {
      badge: {
        backgroundColor: colors.dangerSoft,
        borderColor: colors.danger,
      },
      text: {
        color: colors.danger,
      },
    };
  }

  if (status === 'active' || status === 'completed') {
    return {
      badge: {
        backgroundColor: colors.primarySoft,
        borderColor: colors.primary,
      },
      text: {
        color: colors.primary,
      },
    };
  }

  if (status === 'skipped') {
    return {
      badge: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
      },
      text: {
        color: colors.textSecondary,
      },
    };
  }

  return {
    badge: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
    },
    text: {
      color: colors.textTertiary,
    },
  };
}

function getPilotPalette(
  action: NonNullable<AgentRun['latestPilotEvaluation']>['controlAction'],
  colors: AppPalette,
) {
  if (action === 'accept') {
    return {
      badge: {
        backgroundColor: colors.primarySoft,
        borderColor: colors.success,
      },
      text: {
        color: colors.success,
      },
    };
  }

  if (action === 'block') {
    return {
      badge: {
        backgroundColor: colors.warningBackground,
        borderColor: colors.warning,
      },
      text: {
        color: colors.warning,
      },
    };
  }

  if (action === 'cancel') {
    return {
      badge: {
        backgroundColor: colors.dangerSoft,
        borderColor: colors.danger,
      },
      text: {
        color: colors.danger,
      },
    };
  }

  return {
    badge: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.info,
    },
    text: {
      color: colors.info,
    },
  };
}

export const AgentWorkflowWidget: React.FC<AgentWorkflowWidgetProps> = ({ run }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [run.id]);

  const statusPalette = useMemo(() => getStatusPalette(run.status, colors), [colors, run.status]);
  const displayPhase = useMemo(() => getAgentRunDisplayPhase(run), [run]);
  const lastToolCheckpoint = useMemo(() => getLatestAgentRunToolCheckpoint(run), [run]);
  const pilotEvaluation = run.latestPilotEvaluation;
  const pilotSummary = pilotEvaluation?.summary?.trim() || pilotEvaluation?.rationale?.trim();
  const objective = run.plan?.objective?.trim() || run.goal.trim() || pilotSummary || '';
  const headerSummary = objective || pilotSummary;
  const latestUpdate = run.latestSummary?.trim();
  const runSummaryText = useMemo(
    () => buildLocalizedAgentRunSummaryText(run.summary, t),
    [run.summary, t],
  );
  const visibleCheckpoints = useMemo(
    () => [...run.checkpoints].slice(-4).reverse(),
    [run.checkpoints],
  );
  const runStatusLabel = useMemo(() => formatWorkflowStatusLabel(run.status, t), [run.status, t]);
  const displayPhaseTitle = useMemo(() => {
    if (displayPhase) {
      return formatWorkflowPhaseTitle(displayPhase, t);
    }
    return t('chat.agentWorkflow.phase.assess');
  }, [displayPhase, t]);
  const turnLabel = t('chat.agentWorkflow.turnLabel', { count: run.summary.assistantTurns });
  const pilotActionLabel = useMemo(
    () =>
      pilotEvaluation ? formatPilotControlActionLabel(pilotEvaluation.controlAction, t) : undefined,
    [pilotEvaluation, t],
  );
  const pilotConfidenceLabel = useMemo(
    () => (pilotEvaluation ? formatPilotConfidenceLabel(pilotEvaluation.confidence, t) : undefined),
    [pilotEvaluation, t],
  );
  const pilotPalette = useMemo(
    () => (pilotEvaluation ? getPilotPalette(pilotEvaluation.controlAction, colors) : undefined),
    [colors, pilotEvaluation],
  );
  const pilotInsight = useMemo(() => {
    if (!pilotSummary || pilotSummary === latestUpdate || pilotSummary === objective) {
      return undefined;
    }
    return pilotSummary;
  }, [latestUpdate, objective, pilotSummary]);

  const lastToolLabel = useMemo(() => {
    if (!lastToolCheckpoint) {
      return t('chat.agentWorkflow.noToolsYet');
    }

    const rawToolName = extractToolNameFromCheckpointTitle(lastToolCheckpoint.title);
    if (rawToolName) {
      return humanizeToolName(rawToolName, t);
    }

    return lastToolCheckpoint.title.trim();
  }, [lastToolCheckpoint, t]);

  const pilotScoreLabel = useMemo(() => {
    if (!pilotEvaluation) {
      return undefined;
    }

    return t('chat.agentWorkflow.pilotScoreLabel', {
      score: pilotEvaluation.overallScore,
      max: pilotEvaluation.maxOverallScore,
    });
  }, [pilotEvaluation, t]);

  return (
    <View style={styles.container} testID="agent-workflow-widget">
      <TouchableOpacity
        style={styles.headerButton}
        onPress={() => setExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded
            ? t('chat.agentWorkflow.hideDetailsAccessibility')
            : t('chat.agentWorkflow.showDetailsAccessibility')
        }
        testID="agent-workflow-toggle"
      >
        <View style={styles.headerTopRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{t('chat.agentWorkflow.title')}</Text>
            <Text style={styles.summary} numberOfLines={expanded ? 3 : 2}>
              {headerSummary}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <View style={[styles.statusBadge, statusPalette.badge]} testID="agent-workflow-status">
              <Text style={[styles.statusText, statusPalette.text]}>{runStatusLabel}</Text>
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleText}>
                {expanded
                  ? t('chat.agentWorkflow.hideDetails')
                  : t('chat.agentWorkflow.showDetails')}
              </Text>
              {expanded ? (
                <ChevronDown size={14} color={colors.textSecondary} />
              ) : (
                <ChevronRight size={14} color={colors.textSecondary} />
              )}
            </View>
          </View>
        </View>

        <View style={styles.metaRow}>
          {pilotEvaluation && pilotActionLabel && pilotPalette ? (
            <View style={[styles.metaChip, pilotPalette.badge]} testID="agent-workflow-pilot-chip">
              <Text style={[styles.metaChipText, pilotPalette.text]} numberOfLines={1}>
                {t('chat.agentWorkflow.pilotChip', { action: pilotActionLabel })}
              </Text>
            </View>
          ) : null}
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText} numberOfLines={1}>
              {t('chat.agentWorkflow.stageLabel', { stage: displayPhaseTitle })}
            </Text>
          </View>
          <View style={[styles.metaChip, styles.metaChipFlexible]}>
            <Text style={styles.metaChipText} numberOfLines={1}>
              {t('chat.agentWorkflow.lastToolLabel', { tool: lastToolLabel })}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText} numberOfLines={1}>
              {turnLabel}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.details} testID="agent-workflow-details">
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('chat.agentWorkflow.objective')}</Text>
            <Text style={styles.sectionBody}>{objective}</Text>
          </View>

          {latestUpdate && latestUpdate !== objective ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('chat.agentWorkflow.latestUpdate')}</Text>
              <Text style={styles.sectionBody}>{latestUpdate}</Text>
            </View>
          ) : null}

          {pilotEvaluation &&
          pilotActionLabel &&
          pilotConfidenceLabel &&
          pilotPalette &&
          pilotScoreLabel ? (
            <View style={styles.section} testID="agent-workflow-pilot-section">
              <Text style={styles.sectionTitle}>{t('chat.agentWorkflow.pilotTitle')}</Text>
              <View style={styles.metaRow}>
                <View style={[styles.metaChip, pilotPalette.badge]}>
                  <Text style={[styles.metaChipText, pilotPalette.text]} numberOfLines={1}>
                    {t('chat.agentWorkflow.pilotActionLabel', { action: pilotActionLabel })}
                  </Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText} numberOfLines={1}>
                    {t('chat.agentWorkflow.pilotConfidenceLabel', {
                      confidence: pilotConfidenceLabel,
                    })}
                  </Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText} numberOfLines={1}>
                    {pilotScoreLabel}
                  </Text>
                </View>
              </View>
              {pilotInsight ? <Text style={styles.sectionBody}>{pilotInsight}</Text> : null}
            </View>
          ) : null}

          <View style={styles.phaseRow}>
            {run.phases.map((phase) => {
              const phasePalette = getPhasePalette(phase.status, colors);

              return (
                <View
                  key={phase.key}
                  style={[styles.phaseBadge, phasePalette.badge]}
                  testID={`agent-workflow-phase-${phase.key}`}
                >
                  <Text style={[styles.phaseText, phasePalette.text]}>
                    {formatWorkflowPhaseTitle(phase, t)}
                  </Text>
                </View>
              );
            })}
          </View>

          {runSummaryText ? <Text style={styles.summaryFooter}>{runSummaryText}</Text> : null}

          {visibleCheckpoints.length > 0 ? (
            <View style={styles.timeline} testID="agent-workflow-timeline">
              {visibleCheckpoints.map((checkpoint) => (
                <View key={checkpoint.id} style={styles.timelineItem}>
                  <View style={styles.timelineHeader}>
                    <View style={styles.timelineKindBadge}>
                      <Text style={styles.timelineKindText}>
                        {formatWorkflowCheckpointKind(checkpoint.kind, t)}
                      </Text>
                    </View>
                    <Text style={styles.timelineTitle} numberOfLines={1}>
                      {checkpoint.title}
                    </Text>
                  </View>
                  {checkpoint.detail?.trim() ? (
                    <Text style={styles.timelineDetail} numberOfLines={2}>
                      {checkpoint.detail.trim()}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {run.plan?.successCriteria?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('chat.agentWorkflow.successCriteria')}</Text>
              {run.plan.successCriteria.slice(0, 3).map((item, index) => (
                <Text
                  key={`success-${index}`}
                  style={styles.listItem}
                  numberOfLines={2}
                >{`• ${item}`}</Text>
              ))}
            </View>
          ) : null}

          {run.plan?.stopConditions?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('chat.agentWorkflow.stopConditions')}</Text>
              {run.plan.stopConditions.slice(0, 2).map((item, index) => (
                <Text
                  key={`stop-${index}`}
                  style={styles.listItem}
                  numberOfLines={2}
                >{`• ${item}`}</Text>
              ))}
            </View>
          ) : null}

          {run.plan?.workstreams?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('chat.agentWorkflow.workstreams')}</Text>
              {run.plan.workstreams.slice(0, 3).map((workstream) => (
                <Text key={workstream.id} style={styles.listItem} numberOfLines={2}>
                  {`• ${workstream.title}${workstream.goal ? ` — ${workstream.goal}` : ''}`}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      shadowColor: colors.mode === 'dark' ? '#000000' : colors.text,
      shadowOpacity: colors.mode === 'dark' ? 0.18 : 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    headerButton: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 10,
    },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerCopy: {
      flex: 1,
      gap: 4,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      color: colors.textTertiary,
    },
    summary: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    headerActions: {
      alignItems: 'flex-end',
      gap: 8,
    },
    statusBadge: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    statusText: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    toggleText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metaChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    metaChipFlexible: {
      flexShrink: 1,
    },
    metaChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.text,
    },
    details: {
      gap: 10,
      paddingHorizontal: 12,
      paddingBottom: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.subtleBorder,
    },
    section: {
      gap: 4,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      color: colors.textTertiary,
    },
    sectionBody: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
    },
    listItem: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
    },
    phaseRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    phaseBadge: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    phaseText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    summaryFooter: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    timeline: {
      gap: 8,
    },
    timelineItem: {
      gap: 4,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.subtleBorder,
    },
    timelineHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    timelineKindBadge: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
      backgroundColor: colors.surfaceAlt,
    },
    timelineKindText: {
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      color: colors.textSecondary,
    },
    timelineTitle: {
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    timelineDetail: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
