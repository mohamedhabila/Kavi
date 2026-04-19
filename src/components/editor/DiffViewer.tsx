// ---------------------------------------------------------------------------
// Kavi — Diff Viewer Component
// ---------------------------------------------------------------------------
// Renders a unified diff between two text strings.
// Uses the 'diff' npm package (battle-tested, 60M+ weekly downloads)
// for computing structured diffs, then renders them as styled React Native views.

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { createTwoFilesPatch, type Change } from 'diff';
import * as Diff from 'diff';
import { useTranslation } from '../../i18n';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';

// ── Types ────────────────────────────────────────────────────────────────

export interface DiffViewerProps {
  /** Original file content */
  oldText: string;
  /** New file content */
  newText: string;
  /** Original file name (for header display) */
  oldFileName?: string;
  /** New file name (for header display) */
  newFileName?: string;
  /** Number of context lines (default: 3) */
  contextLines?: number;
  /** Maximum height, scrolls if exceeded */
  maxHeight?: number;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// ── Component ────────────────────────────────────────────────────────────

export const DiffViewer: React.FC<DiffViewerProps> = ({
  oldText,
  newText,
  oldFileName = 'original',
  newFileName = 'modified',
  contextLines = 3,
  maxHeight,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const diffLines = useMemo((): DiffLine[] => {
    const patch = createTwoFilesPatch(
      oldFileName,
      newFileName,
      oldText,
      newText,
      undefined,
      undefined,
      { context: contextLines },
    );

    const lines: DiffLine[] = [];
    const patchLines = patch.split('\n');
    let oldLine = 0;
    let newLine = 0;

    for (const line of patchLines) {
      if (
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('Index:') ||
        line.startsWith('===')
      ) {
        continue;
      }
      if (line.startsWith('@@')) {
        // Parse hunk header for line numbers
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
          lines.push({ type: 'header', content: line });
        }
        continue;
      }
      if (line.startsWith('+')) {
        lines.push({ type: 'added', content: line.slice(1), newLineNumber: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        lines.push({ type: 'removed', content: line.slice(1), oldLineNumber: oldLine });
        oldLine++;
      } else if (line.startsWith(' ')) {
        lines.push({
          type: 'context',
          content: line.slice(1),
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        });
        oldLine++;
        newLine++;
      } else if (line === '\\ No newline at end of file') {
        lines.push({ type: 'context', content: line });
      }
    }

    return lines;
  }, [oldText, newText, oldFileName, newFileName, contextLines]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diffLines) {
      if (line.type === 'added') added++;
      if (line.type === 'removed') removed++;
    }
    return { added, removed };
  }, [diffLines]);

  if (oldText === newText) {
    return (
      <View style={styles.container}>
        <Text style={styles.noChanges}>{t('common.noChanges')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* File header */}
      <View style={styles.fileHeader}>
        <Text style={styles.fileName}>{newFileName}</Text>
        <View style={styles.statsRow}>
          <Text style={styles.statAdded}>+{stats.added}</Text>
          <Text style={styles.statRemoved}>-{stats.removed}</Text>
        </View>
      </View>

      {/* Diff lines */}
      <ScrollView
        style={[styles.diffScroll, maxHeight ? { maxHeight } : undefined]}
        horizontal={false}
        showsVerticalScrollIndicator
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.diffBody}>
            {diffLines.map((line, idx) => {
              if (line.type === 'header') {
                return (
                  <View key={idx} style={styles.hunkHeader}>
                    <Text style={styles.hunkHeaderText}>{line.content}</Text>
                  </View>
                );
              }

              const lineStyle =
                line.type === 'added'
                  ? styles.lineAdded
                  : line.type === 'removed'
                    ? styles.lineRemoved
                    : styles.lineContext;

              const textStyle =
                line.type === 'added'
                  ? styles.textAdded
                  : line.type === 'removed'
                    ? styles.textRemoved
                    : styles.textContext;

              const lineNum =
                line.type === 'removed'
                  ? line.oldLineNumber
                  : line.type === 'added'
                    ? line.newLineNumber
                    : line.oldLineNumber;

              const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

              return (
                <View key={idx} style={[styles.diffLine, lineStyle]}>
                  <Text style={styles.lineNumber}>
                    {lineNum != null ? String(lineNum).padStart(4, ' ') : '    '}
                  </Text>
                  <Text style={styles.linePrefix}>{prefix}</Text>
                  <Text style={[styles.lineContent, textStyle]}>{line.content}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
};

// ── Inline diff for word-level highlighting ──────────────────────────────

export interface InlineDiffProps {
  oldText: string;
  newText: string;
}

export const InlineDiff: React.FC<InlineDiffProps> = ({ oldText, newText }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const changes = useMemo((): Change[] => {
    return Diff.diffWords(oldText, newText);
  }, [oldText, newText]);

  return (
    <Text style={styles.inlineContainer}>
      {changes.map((change, idx) => (
        <Text
          key={idx}
          style={[change.added && styles.inlineAdded, change.removed && styles.inlineRemoved]}
        >
          {change.value}
        </Text>
      ))}
    </Text>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    fileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    fileName: { fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: 'monospace' },
    statsRow: { flexDirection: 'row', gap: 8 },
    statAdded: { fontSize: 12, fontWeight: '600', color: '#22c55e' },
    statRemoved: { fontSize: 12, fontWeight: '600', color: '#ef4444' },
    noChanges: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      padding: 16,
    },
    diffScroll: { flexGrow: 0 },
    diffBody: { minWidth: '100%' },
    hunkHeader: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      backgroundColor: colors.border,
    },
    hunkHeaderText: {
      fontSize: 11,
      fontFamily: 'monospace',
      color: colors.textSecondary,
    },
    diffLine: {
      flexDirection: 'row',
      paddingHorizontal: 4,
      minHeight: 20,
      alignItems: 'flex-start',
    },
    lineContext: { backgroundColor: 'transparent' },
    lineAdded: { backgroundColor: 'rgba(34, 197, 94, 0.12)' },
    lineRemoved: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
    lineNumber: {
      width: 40,
      fontSize: 11,
      fontFamily: 'monospace',
      color: colors.textTertiary,
      textAlign: 'right',
      paddingRight: 4,
      lineHeight: 18,
    },
    linePrefix: {
      width: 14,
      fontSize: 12,
      fontFamily: 'monospace',
      color: colors.textSecondary,
      lineHeight: 18,
    },
    lineContent: {
      flex: 1,
      fontSize: 12,
      fontFamily: 'monospace',
      lineHeight: 18,
    },
    textContext: { color: colors.text },
    textAdded: { color: '#22c55e' },
    textRemoved: { color: '#ef4444' },
    inlineContainer: { fontSize: 13, lineHeight: 18 },
    inlineAdded: {
      backgroundColor: 'rgba(34, 197, 94, 0.2)',
      color: '#22c55e',
    },
    inlineRemoved: {
      backgroundColor: 'rgba(239, 68, 68, 0.2)',
      color: '#ef4444',
      textDecorationLine: 'line-through',
    },
  });
