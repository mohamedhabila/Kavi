import React from 'react';
import { Text, View } from 'react-native';
import type { ToolCall } from '../../types/message';
import type { ToolCallDisplayStyles } from './ToolCallDisplay.styles';
import type { TranslateFn } from './toolCallPresentation';

interface ToolCallBodyProps {
  toolCall: ToolCall;
  parsedArgs: string;
  styles: ToolCallDisplayStyles;
  dangerColor: string;
  t: TranslateFn;
}

export const ToolCallBody: React.FC<ToolCallBodyProps> = ({
  toolCall,
  parsedArgs,
  styles,
  dangerColor,
  t,
}) => (
  <View style={styles.body}>
    <Text style={styles.sectionLabel}>{t('toolCall.sections.arguments')}</Text>
    <View style={styles.codeBlock}>
      <Text style={styles.codeText} selectable>
        {parsedArgs}
      </Text>
    </View>
    {toolCall.result && (
      <>
        <Text style={styles.sectionLabel}>{t('toolCall.sections.result')}</Text>
        <View style={styles.codeBlock}>
          <Text style={styles.codeText} selectable numberOfLines={20}>
            {toolCall.result}
          </Text>
        </View>
      </>
    )}
    {toolCall.error && (
      <>
        <Text style={[styles.sectionLabel, { color: dangerColor }]}>
          {t('toolCall.sections.error')}
        </Text>
        <Text style={[styles.codeText, { color: dangerColor }]} selectable>
          {toolCall.error}
        </Text>
      </>
    )}
  </View>
);
