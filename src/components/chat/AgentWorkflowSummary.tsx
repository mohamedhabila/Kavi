import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AgentRun } from '../../types/agentRun';
import {
  buildAgentWorkflowPresentation,
  formatGoalStatusLabel,
} from './agentWorkflowPresentation';
import { createAgentWorkflowSummaryStyles } from './AgentWorkflowSummary.styles';

interface AgentWorkflowSummaryProps {
  run: AgentRun;
}

export const AgentWorkflowSummary: React.FC<AgentWorkflowSummaryProps> = React.memo(({ run }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createAgentWorkflowSummaryStyles(colors), [colors]);
  const [goalsExpanded, setGoalsExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const presentation = useMemo(() => buildAgentWorkflowPresentation(run, t), [run, t]);
  const hasGoals = presentation.goals.length > 0;
  const showBootstrapGoals = !hasGoals && run.status === 'running';

  return (
    <View style={styles.container} testID="agent-workflow-summary">
      <View style={styles.currentRow} testID="agent-workflow-current">
        <View style={[styles.statusDot, run.status === 'running' ? null : styles.statusDotSettled]} />
        <View style={styles.currentCopy}>
          <Text style={styles.eyebrow}>{t('chat.agentWorkflow.currentWork')}</Text>
          <Text style={styles.currentTitle} numberOfLines={2}>
            {presentation.title}
          </Text>
          {presentation.detail ? (
            <Text style={styles.currentDetail} numberOfLines={2}>
              {presentation.detail}
            </Text>
          ) : null}
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>{presentation.statusLabel}</Text>
        </View>
      </View>

      {hasGoals ? (
        <View style={styles.section} testID="agent-goals-widget">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: goalsExpanded }}
            onPress={() => setGoalsExpanded((value) => !value)}
            style={styles.sectionToggle}
            testID="agent-goals-toggle"
          >
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {t('chat.agentGoals.header', { count: presentation.goals.length })}
            </Text>
            <Text style={styles.sectionMeta} numberOfLines={1}>
              {presentation.activeGoal
                ? formatGoalStatusLabel(presentation.activeGoal.status, t)
                : presentation.statusLabel}
            </Text>
            {goalsExpanded ? (
              <ChevronDown size={16} color={colors.textSecondary} />
            ) : (
              <ChevronRight size={16} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
          {goalsExpanded ? (
            <View style={styles.details} testID="agent-goals-details">
              {presentation.goals.map((goal) => (
                <View key={goal.id} style={styles.goalRow} testID={`agent-goals-item-${goal.id}`}>
                  <Text style={styles.goalTitle}>{goal.title}</Text>
                  <Text style={styles.goalMeta}>
                    {formatGoalStatusLabel(goal.status, t)}
                    {goal.evidence.length > 0
                      ? ` · ${t('chat.agentGoals.evidenceCount', {
                          count: goal.evidence.length,
                        })}`
                      : ''}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : showBootstrapGoals ? (
        <View style={styles.section} testID="agent-goals-widget">
          <View style={styles.sectionToggle}>
            <Text style={styles.sectionTitle}>{t('chat.agentGoals.bootstrapPending')}</Text>
          </View>
        </View>
      ) : null}

      {presentation.trace.length > 0 ? (
        <View style={styles.section} testID="agent-run-trace-widget">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: traceExpanded }}
            onPress={() => setTraceExpanded((value) => !value)}
            style={styles.sectionToggle}
            testID="agent-run-trace-toggle"
          >
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {t('chat.agentRunTrace.header')}
            </Text>
            <Text style={styles.sectionMeta} numberOfLines={1}>
              {t('chat.agentRunTrace.preview', {
                iteration: presentation.trace[presentation.trace.length - 1].iteration,
                count: presentation.traceEventCount,
              })}
            </Text>
            {traceExpanded ? (
              <ChevronDown size={16} color={colors.textSecondary} />
            ) : (
              <ChevronRight size={16} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
          {traceExpanded ? (
            <View style={styles.details} testID="agent-run-trace-details">
              {presentation.trace.map((entry) => (
                <View
                  key={`trace-iteration-${entry.iteration}`}
                  style={styles.traceIteration}
                  testID={`agent-run-trace-iteration-${entry.iteration}`}
                >
                  <Text style={styles.traceIterationTitle}>
                    {t('chat.agentRunTrace.iteration', { iteration: entry.iteration })}
                  </Text>
                  {entry.events.map((event, index) => (
                    <View
                      key={`${entry.iteration}-${event.type}-${event.timestamp}-${index}`}
                      style={styles.traceEventRow}
                    >
                      <Text style={styles.traceEventType}>{event.type}</Text>
                      {event.detail ? (
                        <Text style={styles.traceEventDetail}>{event.detail}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

AgentWorkflowSummary.displayName = 'AgentWorkflowSummary';
