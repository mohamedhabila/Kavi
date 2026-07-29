import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react-native';
import type { ToolCall } from '../../types/message';
import {
  formatRedactedToolDetail,
  limitRedactedToolDetail,
} from '../../services/security/toolDetailRedaction';
import type { ToolCallDisplayStyles } from './ToolCallDisplay.styles';
import type { TranslateFn } from './toolCallPresentation';
import { getToolCallFailurePresentation } from './toolCallOutcomePresentation';

interface ToolCallBodyProps {
  toolCall: ToolCall;
  styles: ToolCallDisplayStyles;
  iconColor: string;
  t: TranslateFn;
}

export const ToolCallBody: React.FC<ToolCallBodyProps> = ({ toolCall, styles, iconColor, t }) => {
  const [technicalExpanded, setTechnicalExpanded] = useState(false);
  const argumentsDetail = useMemo(
    () => (technicalExpanded ? formatRedactedToolDetail(toolCall.arguments) : null),
    [technicalExpanded, toolCall.arguments],
  );
  const resultDetail = useMemo(
    () =>
      toolCall.status !== 'failed' || technicalExpanded
        ? formatRedactedToolDetail(toolCall.result)
        : null,
    [technicalExpanded, toolCall.result, toolCall.status],
  );
  const errorDetail = useMemo(
    () => (technicalExpanded ? formatRedactedToolDetail(toolCall.error) : null),
    [technicalExpanded, toolCall.error],
  );
  const resultPreview = useMemo(() => limitRedactedToolDetail(resultDetail, 900), [resultDetail]);
  const failurePresentation = getToolCallFailurePresentation(toolCall);

  return (
    <View style={styles.body}>
      {failurePresentation ? (
        <View
          style={[
            styles.outcomeCard,
            failurePresentation.tone === 'warning'
              ? styles.outcomeCardWarning
              : styles.outcomeCardDanger,
          ]}
          accessibilityRole="summary"
        >
          <Text style={styles.outcomeTitle}>{t(failurePresentation.titleKey)}</Text>
          <Text style={styles.outcomeDetail}>{t(failurePresentation.detailKey)}</Text>
        </View>
      ) : resultPreview ? (
        <View style={styles.resultSection}>
          <Text style={styles.sectionLabel}>{t('toolCall.sections.result')}</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {resultPreview.text}
            </Text>
          </View>
          {resultPreview.truncated ? (
            <Text style={styles.detailNotice}>{t('toolCall.previewShortened')}</Text>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.technicalDisclosure}
        onPress={() => setTechnicalExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={t('toolCall.technicalDetails')}
        accessibilityHint={
          technicalExpanded
            ? t('toolCall.hideTechnicalDetailsHint')
            : t('toolCall.showTechnicalDetailsHint')
        }
        accessibilityState={{ expanded: technicalExpanded }}
        testID={`tool-call-technical-disclosure-${toolCall.id}`}
      >
        <ShieldCheck size={17} color={iconColor} />
        <Text style={styles.technicalTitle}>{t('toolCall.technicalDetails')}</Text>
        {technicalExpanded ? (
          <ChevronDown size={18} color={iconColor} />
        ) : (
          <ChevronRight size={18} color={iconColor} />
        )}
      </TouchableOpacity>

      {technicalExpanded ? (
        <View style={styles.technicalDetails}>
          <Text style={styles.privacyNotice}>{t('toolCall.redactedNotice')}</Text>

          {argumentsDetail ? (
            <View style={styles.detailSection}>
              <Text style={styles.sectionLabel}>{t('toolCall.sections.arguments')}</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} selectable>
                  {argumentsDetail.text}
                </Text>
              </View>
              {argumentsDetail.truncated ? (
                <Text style={styles.detailNotice}>{t('toolCall.detailsShortened')}</Text>
              ) : null}
            </View>
          ) : null}

          {resultDetail ? (
            <View style={styles.detailSection}>
              <Text style={styles.sectionLabel}>{t('toolCall.sections.result')}</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} selectable>
                  {resultDetail.text}
                </Text>
              </View>
              {resultDetail.truncated ? (
                <Text style={styles.detailNotice}>{t('toolCall.detailsShortened')}</Text>
              ) : null}
            </View>
          ) : null}

          {errorDetail ? (
            <View style={styles.detailSection}>
              <Text style={styles.sectionLabel}>{t('toolCall.sections.error')}</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} selectable>
                  {errorDetail.text}
                </Text>
              </View>
              {errorDetail.truncated ? (
                <Text style={styles.detailNotice}>{t('toolCall.detailsShortened')}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};
