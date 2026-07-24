import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Edit3,
  Eye,
  FileCode,
  FolderOpen,
  FolderTree,
  PlusSquare,
  RefreshCw,
  Save,
} from 'lucide-react-native';

import { CodeEditorWebView } from '../../components/editor/CodeEditorWebView';
import { FileBrowser } from '../../components/files/FileBrowser';
import type {
  CodeEditorFileEntry,
  CodeEditorLanguage,
  CodeEditorPalette,
  CodeEditorRef,
  CodeEditorSource,
  CodeEditorStyles,
  CodeEditorTarget,
  CodeEditorTranslation,
} from './codeEditorScreenTypes';

type CodeEditorScreenViewProps = {
  activePath: string;
  activeTarget: CodeEditorTarget;
  activeTargetRoot: string;
  browserVisible: boolean;
  canPersist: boolean;
  colors: CodeEditorPalette;
  editorKey: number;
  editorRef: CodeEditorRef;
  editorSeedContent: string;
  enabledSshTargets: Array<{ id: string; name: string }>;
  enabledWorkspaceTargets: Array<{ id: string; name: string }>;
  fileName: string;
  handleBack: () => void;
  handleContent: (content: string) => Promise<void>;
  handleDirtyChange: (dirty: boolean) => void;
  handleNewFile: () => void;
  handleOpenFile: (nextPath: string) => void;
  handleReload: () => void;
  handleSave: () => void;
  handleSourceChange: (nextSource: CodeEditorSource) => void;
  handleTargetChange: (nextTargetId: string) => void;
  isConversationWorkspaceSource: boolean;
  isDirty: boolean;
  language: CodeEditorLanguage;
  listCurrentDirectory: (path: string) => Promise<CodeEditorFileEntry[]>;
  loading: boolean;
  localSourceLabel: string;
  modeBannerText: string | null;
  openRemoteWork: () => void;
  pathDraft: string;
  readOnly: boolean;
  saving: boolean;
  setBrowserVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setEditorMode: React.Dispatch<React.SetStateAction<'unknown' | 'codemirror' | 'fallback'>>;
  setPathDraft: React.Dispatch<React.SetStateAction<string>>;
  source: CodeEditorSource;
  styles: CodeEditorStyles;
  t: CodeEditorTranslation;
  targetId?: string;
  targetLabel: string;
  toggleReadOnly: () => void;
};

function EditorCanvas({
  colors,
  editorKey,
  editorRef,
  editorSeedContent,
  handleContent,
  handleDirtyChange,
  language,
  loading,
  readOnly,
  setEditorMode,
  source,
  styles,
  t,
  targetId,
}: Pick<
  CodeEditorScreenViewProps,
  | 'colors'
  | 'editorKey'
  | 'editorRef'
  | 'editorSeedContent'
  | 'handleContent'
  | 'handleDirtyChange'
  | 'language'
  | 'loading'
  | 'readOnly'
  | 'setEditorMode'
  | 'source'
  | 'styles'
  | 't'
  | 'targetId'
>) {
  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>{t('codeEditor.loadingFile')}</Text>
      </View>
    );
  }

  return (
    <CodeEditorWebView
      key={`${editorKey}-${source}-${targetId ?? 'none'}`}
      ref={editorRef}
      initialContent={editorSeedContent}
      language={language}
      readOnly={readOnly}
      onDirtyChange={handleDirtyChange}
      onContent={handleContent}
      onModeChange={(mode) => {
        setEditorMode(mode);
      }}
      style={styles.flex}
    />
  );
}

export function CodeEditorScreenView({
  activePath,
  activeTarget,
  activeTargetRoot,
  browserVisible,
  canPersist,
  colors,
  editorKey,
  editorRef,
  editorSeedContent,
  enabledSshTargets,
  enabledWorkspaceTargets,
  fileName,
  handleBack,
  handleContent,
  handleDirtyChange,
  handleNewFile,
  handleOpenFile,
  handleReload,
  handleSave,
  handleSourceChange,
  handleTargetChange,
  isConversationWorkspaceSource,
  isDirty,
  language,
  listCurrentDirectory,
  loading,
  localSourceLabel,
  modeBannerText,
  openRemoteWork,
  pathDraft,
  readOnly,
  saving,
  setBrowserVisible,
  setEditorMode,
  setPathDraft,
  source,
  styles,
  t,
  targetId,
  targetLabel,
  toggleReadOnly,
}: CodeEditorScreenViewProps) {
  const showMissingTargetState = source !== 'local' && !activeTarget;
  const showScratchSetupGuide =
    enabledWorkspaceTargets.length === 0 &&
    enabledSshTargets.length === 0 &&
    source === 'local' &&
    !isConversationWorkspaceSource &&
    !activePath &&
    !editorSeedContent;
  const showTemporaryScratchNotice =
    source === 'local' && !isConversationWorkspaceSource && !showScratchSetupGuide;
  const editorCanvas = (
    <EditorCanvas
      colors={colors}
      editorKey={editorKey}
      editorRef={editorRef}
      editorSeedContent={editorSeedContent}
      handleContent={handleContent}
      handleDirtyChange={handleDirtyChange}
      language={language}
      loading={loading}
      readOnly={readOnly}
      setEditorMode={setEditorMode}
      source={source}
      styles={styles}
      t={t}
      targetId={targetId}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          onPress={handleBack}
          style={styles.headerBtn}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <FileCode size={16} color={colors.textSecondary} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName || t('codeEditor.title')}
          </Text>
          {isDirty ? <View style={styles.dirtyDot} /> : null}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={toggleReadOnly}
            style={styles.headerBtn}
            accessibilityLabel={
              readOnly ? t('codeEditor.switchToEditable') : t('codeEditor.switchToReadOnly')
            }
            accessibilityRole="button"
          >
            {readOnly ? (
              <Eye size={18} color={colors.textSecondary} />
            ) : (
              <Edit3 size={18} color={colors.primary} />
            )}
          </TouchableOpacity>
          {!readOnly && canPersist ? (
            <TouchableOpacity
              onPress={handleSave}
              style={styles.headerBtn}
              disabled={!isDirty || saving}
              accessibilityLabel={t('codeEditor.saveFile')}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isDirty || saving }}
            >
              <Save size={18} color={isDirty ? colors.primary : colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.sourceBar}>
        {(['workspace', 'ssh', 'local'] as CodeEditorSource[]).map((entry) => {
          const disabled =
            (entry === 'workspace' && enabledWorkspaceTargets.length === 0) ||
            (entry === 'ssh' && enabledSshTargets.length === 0);
          const label =
            entry === 'workspace'
              ? t('codeEditor.workspaceLabel')
              : entry === 'ssh'
                ? t('codeEditor.sshLabel')
                : localSourceLabel;
          return (
            <TouchableOpacity
              key={entry}
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ disabled, selected: source === entry }}
              style={[
                styles.sourceChip,
                source === entry && styles.sourceChipActive,
                disabled && styles.sourceChipDisabled,
              ]}
              onPress={() => !disabled && handleSourceChange(entry)}
              disabled={disabled}
              testID={`code-editor-source-${entry}`}
            >
              <Text
                style={[
                  styles.sourceChipText,
                  source === entry && styles.sourceChipTextActive,
                  disabled && styles.sourceChipTextDisabled,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {source !== 'local' ? (
        <View style={styles.targetBar}>
          <Text style={styles.sectionLabel}>{t('codeEditor.targetLabel')}</Text>
          <View style={styles.targetChipsWrap}>
            {(source === 'workspace' ? enabledWorkspaceTargets : enabledSshTargets).map(
              (target) => (
                <TouchableOpacity
                  key={target.id}
                  accessibilityLabel={target.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: target.id === targetId }}
                  style={[styles.targetChip, target.id === targetId && styles.targetChipActive]}
                  onPress={() => handleTargetChange(target.id)}
                  testID={`code-editor-target-${target.id}`}
                >
                  <Text
                    style={[
                      styles.targetChipText,
                      target.id === targetId && styles.targetChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {target.name}
                  </Text>
                </TouchableOpacity>
              ),
            )}
          </View>
        </View>
      ) : null}

      {showScratchSetupGuide ? (
        <View style={styles.emptyState} testID="code-editor-setup-guide">
          <Text style={styles.emptyTitle}>{t('codeEditor.startEditingTitle')}</Text>
          <Text style={styles.emptyBody}>{t('codeEditor.startEditingMessage')}</Text>
          <View style={styles.emptyActions}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={handleNewFile}
              style={styles.primaryCta}
              testID="code-editor-start-scratch"
            >
              <Text style={styles.primaryCtaText}>{t('codeEditor.startScratch')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={openRemoteWork}
              style={styles.secondaryCta}
            >
              <Text style={styles.secondaryCtaText}>{t('codeEditor.openRemoteWork')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : showMissingTargetState ? (
        <View style={styles.emptyState} testID="code-editor-missing-target">
          <Text style={styles.emptyTitle}>{t('codeEditor.noTargetTitle')}</Text>
          <Text style={styles.emptyBody}>{t('codeEditor.noTargetMessage')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={openRemoteWork}
            style={styles.primaryCta}
          >
            <Text style={styles.primaryCtaText}>{t('codeEditor.openRemoteWork')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.pathBar}>
            <FolderOpen size={12} color={colors.textTertiary} />
            <TextInput
              accessibilityLabel={t('codeEditor.filePathLabel')}
              autoCapitalize="none"
              autoCorrect={false}
              editable={(source !== 'local' || isConversationWorkspaceSource) && !readOnly}
              onChangeText={setPathDraft}
              placeholder={t('codeEditor.untitledPath')}
              placeholderTextColor={colors.textTertiary}
              style={styles.pathInput}
              value={pathDraft}
            />
            {language ? (
              <View style={styles.langBadge}>
                <Text style={styles.langBadgeText}>{language}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.contextBar}>
            <Text style={styles.contextText} numberOfLines={1}>
              {targetLabel}
            </Text>
            <View style={styles.contextActions}>
              {source !== 'local' ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setBrowserVisible((value) => !value)}
                  style={styles.contextBtn}
                >
                  <FolderTree size={14} color={colors.primary} />
                  <Text style={styles.contextBtnText}>{t('codeEditor.browseFiles')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                onPress={handleNewFile}
                style={styles.contextBtn}
              >
                <PlusSquare size={14} color={colors.primary} />
                <Text style={styles.contextBtnText}>{t('codeEditor.newFile')}</Text>
              </TouchableOpacity>
              {(source !== 'local' || isConversationWorkspaceSource) && activePath ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={handleReload}
                  style={styles.contextBtn}
                >
                  <RefreshCw size={14} color={colors.primary} />
                  <Text style={styles.contextBtnText}>{t('codeEditor.reloadFile')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {showTemporaryScratchNotice ? (
            <View style={styles.scratchNotice} testID="code-editor-scratch-notice">
              <Text style={styles.scratchNoticeText}>{t('codeEditor.scratchModeMessage')}</Text>
            </View>
          ) : null}

          {modeBannerText ? (
            <View style={[styles.modeBanner, styles.modeBannerWarning]}>
              <Text style={styles.modeBannerText}>{modeBannerText}</Text>
            </View>
          ) : null}

          {browserVisible && source !== 'local' && activeTarget ? (
            <View style={styles.browserPanel}>
              <Text style={styles.sectionLabel}>{t('codeEditor.fileBrowserTitle')}</Text>
              <FileBrowser
                rootPath={activeTargetRoot}
                listDirectory={listCurrentDirectory}
                onFileSelect={(nextPath) => handleOpenFile(nextPath)}
                maxHeight={260}
              />
            </View>
          ) : null}

          {Platform.OS === 'ios' ? (
            <KeyboardAvoidingView style={styles.flex} behavior="padding">
              {editorCanvas}
            </KeyboardAvoidingView>
          ) : (
            <View style={styles.flex}>{editorCanvas}</View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}
