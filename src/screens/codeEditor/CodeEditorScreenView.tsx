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
  editorMode: 'unknown' | 'codemirror' | 'fallback';
  editorModeReason: string | null;
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
  setEditorModeReason: React.Dispatch<React.SetStateAction<string | null>>;
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
  setEditorModeReason,
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
  | 'setEditorModeReason'
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
      onModeChange={(mode, reason) => {
        setEditorMode(mode);
        setEditorModeReason(reason ?? null);
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
  editorMode,
  editorModeReason,
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
  setEditorModeReason,
  setPathDraft,
  source,
  styles,
  t,
  targetId,
  targetLabel,
  toggleReadOnly,
}: CodeEditorScreenViewProps) {
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
      setEditorModeReason={setEditorModeReason}
      source={source}
      styles={styles}
      t={t}
      targetId={targetId}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={8} accessibilityLabel={t('common.back')}>
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
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityLabel={
              readOnly ? t('codeEditor.switchToEditable') : t('codeEditor.switchToReadOnly')
            }
          >
            {readOnly ? (
              <Eye size={18} color={colors.textSecondary} />
            ) : (
              <Edit3 size={18} color={colors.primary} />
            )}
          </TouchableOpacity>
          {!readOnly ? (
            <TouchableOpacity
              onPress={handleSave}
              hitSlop={8}
              style={styles.headerBtn}
              disabled={!isDirty || saving || !canPersist}
              accessibilityLabel={t('codeEditor.saveFile')}
            >
              <Save size={18} color={isDirty && canPersist ? colors.primary : colors.textTertiary} />
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
              style={[
                styles.sourceChip,
                source === entry && styles.sourceChipActive,
                disabled && styles.sourceChipDisabled,
              ]}
              onPress={() => !disabled && handleSourceChange(entry)}
              disabled={disabled}
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
                  style={[styles.targetChip, target.id === targetId && styles.targetChipActive]}
                  onPress={() => handleTargetChange(target.id)}
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

      <View style={styles.pathBar}>
        <FolderOpen size={12} color={colors.textTertiary} />
        <TextInput
          value={pathDraft}
          onChangeText={setPathDraft}
          style={styles.pathInput}
          autoCapitalize="none"
          autoCorrect={false}
          editable={(source !== 'local' || isConversationWorkspaceSource) && !readOnly}
          placeholder={t('codeEditor.untitledPath')}
          placeholderTextColor={colors.textTertiary}
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
              style={styles.contextBtn}
              onPress={() => setBrowserVisible((value) => !value)}
            >
              <FolderTree size={14} color={colors.primary} />
              <Text style={styles.contextBtnText}>{t('codeEditor.browseFiles')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.contextBtn} onPress={handleNewFile}>
            <PlusSquare size={14} color={colors.primary} />
            <Text style={styles.contextBtnText}>{t('codeEditor.newFile')}</Text>
          </TouchableOpacity>
          {(source !== 'local' || isConversationWorkspaceSource) && activePath ? (
            <TouchableOpacity style={styles.contextBtn} onPress={handleReload}>
              <RefreshCw size={14} color={colors.primary} />
              <Text style={styles.contextBtnText}>{t('codeEditor.reloadFile')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {modeBannerText ? (
        <View
          style={[
            styles.modeBanner,
            editorMode === 'fallback' ? styles.modeBannerWarning : styles.modeBannerSuccess,
          ]}
        >
          <Text style={styles.modeBannerText}>{modeBannerText}</Text>
          {editorMode === 'fallback' && editorModeReason ? (
            <Text style={styles.modeBannerSubtext} numberOfLines={1}>
              {editorModeReason}
            </Text>
          ) : null}
        </View>
      ) : null}

      {source !== 'local' && !activeTarget ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('codeEditor.noTargetTitle')}</Text>
          <Text style={styles.emptyBody}>{t('codeEditor.noTargetMessage')}</Text>
          <TouchableOpacity style={styles.primaryCta} onPress={openRemoteWork}>
            <Text style={styles.primaryCtaText}>{t('codeEditor.openRemoteWork')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {enabledWorkspaceTargets.length === 0 &&
      enabledSshTargets.length === 0 &&
      source === 'local' &&
      !isConversationWorkspaceSource &&
      !activePath &&
      !editorSeedContent ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('codeEditor.startEditingTitle')}</Text>
          <Text style={styles.emptyBody}>{t('codeEditor.startEditingMessage')}</Text>
          <TouchableOpacity style={styles.primaryCta} onPress={openRemoteWork}>
            <Text style={styles.primaryCtaText}>{t('codeEditor.openRemoteWork')}</Text>
          </TouchableOpacity>
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
    </SafeAreaView>
  );
}
