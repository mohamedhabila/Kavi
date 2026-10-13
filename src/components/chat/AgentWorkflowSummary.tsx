import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ExpandCollapseChevronIcon } from '../navigation/DirectionalIcons';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
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
  const presentation = useMemo(
    () => buildAgentWorkflowPresentation(run, t, executionPresentation),
    [executionPresentation, run, t],
  );
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
    </View>
  );
};

export const AgentWorkflowSummary = React.memo(AgentWorkflowSummaryComponent);

AgentWorkflowSummary.displayName = 'AgentWorkflowSummary';
