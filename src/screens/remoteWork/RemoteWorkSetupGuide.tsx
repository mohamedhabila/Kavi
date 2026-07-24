import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, Cloud, Globe2, Server } from 'lucide-react-native';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

type RemoteWorkSetupGuideProps = {
  onCreateBrowser: () => void;
  onCreateSsh: () => void;
  onCreateWorkspace: () => void;
};

export const RemoteWorkSetupGuide = React.memo(function RemoteWorkSetupGuide(
  props: RemoteWorkSetupGuideProps,
) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const choices = [
    {
      id: 'workspace',
      title: t('remoteWork.setupWorkspaceTitle'),
      hint: t('remoteWork.setupWorkspaceHint'),
      icon: Cloud,
      onPress: props.onCreateWorkspace,
    },
    {
      id: 'ssh',
      title: t('remoteWork.setupSshTitle'),
      hint: t('remoteWork.setupSshHint'),
      icon: Server,
      onPress: props.onCreateSsh,
    },
    {
      id: 'browser',
      title: t('remoteWork.setupBrowserTitle'),
      hint: t('remoteWork.setupBrowserHint'),
      icon: Globe2,
      onPress: props.onCreateBrowser,
    },
  ];

  return (
    <View style={styles.card} testID="remote-work-setup-guide">
      <View style={styles.heading}>
        <Text style={styles.title}>{t('remoteWork.setupGuideTitle')}</Text>
        <Text style={styles.hint}>{t('remoteWork.setupGuideHint')}</Text>
      </View>

      <View style={styles.choices}>
        {choices.map((choice, index) => {
          const Icon = choice.icon;
          return (
            <TouchableOpacity
              accessibilityHint={choice.hint}
              accessibilityLabel={choice.title}
              accessibilityRole="button"
              key={choice.id}
              onPress={choice.onPress}
              style={[styles.choice, index < choices.length - 1 ? styles.choiceBorder : null]}
              testID={`remote-work-setup-${choice.id}`}
            >
              <View style={styles.iconWrap}>
                <Icon color={colors.primary} size={21} />
              </View>
              <View style={styles.choiceCopy}>
                <Text style={styles.choiceTitle}>{choice.title}</Text>
                <Text style={styles.choiceHint}>{choice.hint}</Text>
              </View>
              <ChevronRight color={colors.textTertiary} size={19} />
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.footnote}>{t('remoteWork.setupGuideFootnote')}</Text>
    </View>
  );
});

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 18,
      padding: 18,
    },
    heading: {
      gap: 7,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
      lineHeight: 28,
    },
    hint: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
    },
    choices: {
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    choice: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: 76,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    choiceBorder: {
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    iconWrap: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 12,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    choiceCopy: {
      flex: 1,
      minWidth: 0,
    },
    choiceTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      lineHeight: 21,
    },
    choiceHint: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    footnote: {
      color: colors.textTertiary,
      fontSize: 13,
      lineHeight: 18,
    },
  });
