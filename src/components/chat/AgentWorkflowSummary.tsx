import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ExpandCollapseChevronIcon } from '../navigation/DirectionalIcons';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { AgentRun } from '../../types/agentRun';
import {
  buildAgentWorkflowPresentation,
  formatPlanStepStatusLabel,
} from './agentWorkflowPresentation';
import { createAgentWorkflowSummaryStyles } from './AgentWorkflowSummary.styles';
import type { AgentRunExecutionPresentation } from '../../services/agents/activeConversationExecutionState';

interface AgentWorkflowSummaryProps {
  run: AgentRun;
  executionPresentation?: AgentRunExecutionPresentation;
}

const AgentWorkflowSummaryComponent: React.FC<AgentWorkflowSummaryProps> = ({
  run,
  executionPresentation,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createAgentWorkflowSummaryStyles(colors), [colors]);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const presentation = useMemo(
    () => buildAgentWorkflowPresentation(run, t, executionPresentation),
    [executionPresentation, run, t],
  );
  // The run trace describes the engine, not the task: it is shown only to someone who
  // turned developer mode on.
  const developerModeEnabled = useSettingsStore((state) => state.developerModeEnabled);
  const { plan } = presentation;
  const completedStepCount = plan.filter((entry) => entry.status === 'completed').length;
  const isPresentedRunning =
    run.status === 'running' &&
    executionPresentation !== 'needs_attention' &&
    executionPresentation !== 'waiting_for_user';

  return (
    <View style={styles.container} testID="agent-workflow-summary">
      <View style={styles.currentRow} testID="agent-workflow-current">
        <View style={[styles.statusDot, isPresentedRunning ? null : styles.statusDotSettled]} />
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

      {plan.length > 0 ? (
        <View style={styles.section} testID="agent-plan-widget">
          <TouchableOpacity
            accessibilityLabel={t('chat.agentPlan.header', { count: plan.length })}
            accessibilityRole="button"
            accessibilityState={{ expanded: planExpanded }}
            onPress={() => setPlanExpanded((value) => !value)}
            style={styles.sectionToggle}
            testID="agent-plan-toggle"
          >
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {t('chat.agentPlan.header', { count: plan.length })}
            </Text>
            <Text style={styles.sectionMeta} numberOfLines={1}>
              {`${completedStepCount}/${plan.length}`}
            </Text>
            <ExpandCollapseChevronIcon expanded={planExpanded} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {planExpanded ? (
            <View style={styles.details} testID="agent-plan-details">
              {plan.map((entry, index) => (
                <View
                  key={`plan-step-${index}`}
                  style={styles.stepRow}
                  testID={`agent-plan-step-${index}`}
                >
                  <Text style={styles.stepTitle}>{entry.step}</Text>
                  <Text style={styles.stepMeta}>{formatPlanStepStatusLabel(entry.status, t)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {developerModeEnabled && presentation.trace.length > 0 ? (
        <View style={styles.section} testID="agent-run-trace-widget">
          <TouchableOpacity
            accessibilityLabel={t('chat.agentRunTrace.header')}
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
            <ExpandCollapseChevronIcon expanded={traceExpanded} size={16} color={colors.textSecondary} />
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
};

export const AgentWorkflowSummary = React.memo(AgentWorkflowSummaryComponent);

AgentWorkflowSummary.displayName = 'AgentWorkflowSummary';
