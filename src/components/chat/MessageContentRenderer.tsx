import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import {
  buildContentRenderPlan,
  buildStreamingPreview,
  createSafeMarkdownTokenizer,
  splitContentSegments,
  trimRenderableContent,
  type MarkdownTokenizer,
} from './messageContent';
import { createMessageMarkdownRenderer } from './messageMarkdownRenderer';

interface MessageContentRendererProps {
  content: string;
  isUser: boolean;
  messageId: string;
  streaming?: boolean;
}

type MarkdownTheme = NonNullable<Parameters<typeof useMarkdown>[1]>['theme'];

const EXPANDED_CODE_BLOCK_MAX_HEIGHT = 320;
const MARKDOWN_CONTAINER_STYLE = {
  minWidth: 0,
  alignSelf: 'stretch',
  flexGrow: 0,
  flexShrink: 1,
} as const;

const StaticMarkdown: React.FC<{
  value: string;
  theme?: MarkdownTheme;
  styles?: MarkedStyles;
  colorScheme: 'light' | 'dark';
  tokenizer?: MarkdownTokenizer;
  renderer?: NonNullable<Parameters<typeof useMarkdown>[1]>['renderer'];
}> = React.memo(({ value, theme, styles, colorScheme, tokenizer, renderer }) => {
  const markdownElements = useMarkdown(value, {
    theme,
    styles,
    colorScheme,
    tokenizer,
    renderer,
  });
  const children = useMemo(() => React.Children.toArray(markdownElements), [markdownElements]);

  return <View style={MARKDOWN_CONTAINER_STYLE}>{children}</View>;
});

StaticMarkdown.displayName = 'StaticMarkdown';

const CollapsibleCodeBlock: React.FC<{
  code: string;
  language?: string;
  colors: AppPalette;
  isUser: boolean;
}> = ({ code, language, colors, isUser }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.collapsibleCodeContainer}>
      <TouchableOpacity
        style={styles.codeToggle}
        onPress={() => setExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('chat.hideCode') : t('chat.showCode')}
      >
        <View style={styles.codeToggleLabelRow}>
          <Text style={[styles.codeToggleLabel, isUser ? styles.codeToggleLabelUser : null]}>
            {language
              ? `${language.toUpperCase()} ${t('chat.codeLabel').toLowerCase()}`
              : t('chat.codeLabel')}
          </Text>
          <Text style={[styles.codeToggleHint, isUser ? styles.codeToggleHintUser : null]}>
            {expanded ? t('chat.hideCode') : t('chat.showCode')}
          </Text>
        </View>
        {expanded ? (
          <ChevronDown size={14} color={isUser ? colors.onPrimary : colors.textSecondary} />
        ) : (
          <ChevronRight size={14} color={isUser ? colors.onPrimary : colors.textSecondary} />
        )}
      </TouchableOpacity>
      {expanded ? (
        <ScrollView
          style={[styles.codeBlockScroll, isUser ? styles.userCodeBlock : null]}
          contentContainerStyle={styles.codeBlockScrollContent}
          nestedScrollEnabled
          bounces={false}
          testID="message-code-expanded-scroll"
        >
          <Text style={[styles.codeText, isUser ? styles.userCodeText : null]} selectable>
            {code}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
};

export const MessageContentRenderer: React.FC<MessageContentRendererProps> = React.memo(
  ({ content, isUser, messageId, streaming }) => {
    const { colors } = useAppTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const markdownTokenizer = useMemo<MarkdownTokenizer>(createSafeMarkdownTokenizer, []);
    const markdownRenderer = useMemo(
      () => createMessageMarkdownRenderer(colors, isUser),
      [colors, isUser],
    );
    const markdownStyles = useMemo<MarkedStyles>(
      () => ({
        text: { color: isUser ? colors.onPrimary : colors.text, fontSize: 15, lineHeight: 22 },
        paragraph: {
          marginTop: 0,
          marginBottom: 0,
        },
        codespan: {
          backgroundColor: isUser ? 'rgba(255,255,255,0.15)' : colors.codeBackground,
          color: isUser ? colors.onPrimary : colors.text,
          paddingHorizontal: 4,
          paddingVertical: 1,
          borderRadius: 3,
          fontFamily: 'monospace',
          fontSize: 13,
        },
        link: { color: isUser ? (colors.onPrimaryLink ?? colors.onPrimary) : colors.link },
        h1: { color: isUser ? colors.onPrimary : colors.text, fontSize: 20, fontWeight: '700' },
        h2: { color: isUser ? colors.onPrimary : colors.text, fontSize: 18, fontWeight: '600' },
        h3: { color: isUser ? colors.onPrimary : colors.text, fontSize: 16, fontWeight: '600' },
        blockquote: {
          borderLeftWidth: 3,
          borderLeftColor: isUser ? 'rgba(255,255,255,0.3)' : colors.subtleBorder,
          paddingLeft: 10,
          marginLeft: 0,
        },
        li: { color: isUser ? colors.onPrimary : colors.text },
        list: {
          marginTop: 0,
          marginBottom: 0,
        },
        code: {
          backgroundColor: isUser ? 'rgba(255,255,255,0.08)' : colors.codeBackground,
        },
        table: {
          borderWidth: 1,
          borderColor: isUser ? 'rgba(255,255,255,0.18)' : colors.subtleBorder,
        },
        tableRow: {
          flexDirection: 'row',
        },
        tableCell: {
          paddingHorizontal: 10,
          paddingVertical: 8,
          minWidth: 0,
        },
      }),
      [colors, isUser],
    );
    const markdownTheme = useMemo<MarkdownTheme>(
      () => ({
        colors: {
          text: isUser ? colors.onPrimary : colors.text,
          link: isUser ? (colors.onPrimaryLink ?? colors.onPrimary) : colors.link,
          code: isUser ? 'rgba(255,255,255,0.08)' : colors.codeBackground,
          border: isUser ? 'rgba(255,255,255,0.18)' : colors.subtleBorder,
          background: 'transparent',
        },
      }),
      [colors, isUser],
    );
    const markdownColorScheme = colors.mode === 'dark' ? 'dark' : 'light';
    const renderableContent = trimRenderableContent(content);

    if (!renderableContent) {
      return null;
    }

    if (streaming) {
      return (
        <Text style={styles.streamingText} testID="message-streaming-text">
          {buildStreamingPreview(renderableContent)}
        </Text>
      );
    }

    const plan = buildContentRenderPlan(renderableContent);
    if (!plan) {
      return null;
    }

    if (plan.mode === 'plain') {
      return (
        <Text style={styles.plainTextContent} selectable testID="assistant-plain-full">
          {plan.text}
        </Text>
      );
    }

    if (isUser) {
      return (
        <View style={styles.contentStack}>
          <StaticMarkdown
            value={plan.text}
            theme={markdownTheme}
            styles={markdownStyles}
            colorScheme={markdownColorScheme}
            tokenizer={markdownTokenizer}
            renderer={markdownRenderer}
          />
        </View>
      );
    }

    const segments = splitContentSegments(plan.text, markdownTokenizer);
    return (
      <View style={styles.contentStack}>
        {segments.map((segment, index) => {
          if (segment.type === 'code') {
            return (
              <CollapsibleCodeBlock
                key={`code-${messageId}-${index}`}
                code={segment.content}
                language={segment.language}
                colors={colors}
                isUser={isUser}
              />
            );
          }

          if (!segment.content.trim()) {
            return null;
          }

          return (
            <StaticMarkdown
              key={`markdown-${messageId}-${index}`}
              value={segment.content}
              theme={markdownTheme}
              styles={markdownStyles}
              colorScheme={markdownColorScheme}
              tokenizer={markdownTokenizer}
              renderer={markdownRenderer}
            />
          );
        })}
      </View>
    );
  },
);

MessageContentRenderer.displayName = 'MessageContentRenderer';

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    contentStack: {
      gap: 10,
      minWidth: 0,
      alignSelf: 'stretch',
    },
    streamingText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      minWidth: 0,
      flexShrink: 1,
    },
    plainTextContent: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      minWidth: 0,
      flexShrink: 1,
    },
    collapsibleCodeContainer: {
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.codeBackground,
      minWidth: 0,
      alignSelf: 'stretch',
    },
    codeToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    codeToggleLabelRow: {
      flex: 1,
      gap: 2,
    },
    codeToggleLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      textTransform: 'uppercase',
    },
    codeToggleHint: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    codeToggleLabelUser: {
      color: colors.onPrimary,
    },
    codeToggleHintUser: {
      color: colors.onPrimary,
      opacity: 0.8,
    },
    codeBlockScroll: {
      backgroundColor: colors.codeBackground,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      maxHeight: EXPANDED_CODE_BLOCK_MAX_HEIGHT,
    },
    codeBlockScrollContent: {
      padding: 10,
    },
    codeText: {
      fontSize: 12,
      fontFamily: 'monospace',
      color: colors.textSecondary,
      lineHeight: 17,
      flexShrink: 1,
    },
    userCodeBlock: {
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderTopColor: 'rgba(255,255,255,0.14)',
    },
    userCodeText: {
      color: colors.onPrimary,
    },
  });
