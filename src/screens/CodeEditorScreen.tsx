// ---------------------------------------------------------------------------
// Kavi — Code Editor Screen
// ---------------------------------------------------------------------------
// Full syntax-highlighted code editor (CodeMirror 6 in WebView) with remote
// file integration for SSH and workspace targets.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAppTheme } from '../theme/useAppTheme';
import { createCodeEditorScreenStyles as createStyles } from './codeEditor/codeEditorScreenStyles';
import { CodeEditorScreenView } from './codeEditor/CodeEditorScreenView';
import { useCodeEditorFileWorkflow } from './codeEditor/useCodeEditorFileWorkflow';
import { useTranslation } from '../i18n/useTranslation';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  type CodeEditorWebViewRef,
  detectEditorLanguage,
  type EditorLanguage,
} from '../components/editor/CodeEditorWebView';
import { useBackToChat } from '../navigation/useBackToChat';
import {
  getConversationFilesBrowseState,
  type ConversationFileFilter,
  type ConversationFileSort,
} from '../components/files/conversationFilesPresentation';

type EditorRouteParams = {
  CodeEditor: {
    filePath?: string;
    content?: string;
    language?: EditorLanguage;
    readOnly?: boolean;
    title?: string;
    /** 'workspace' or 'ssh' — determines save integration */
    source?: 'workspace' | 'ssh' | 'local';
    targetId?: string;
    conversationId?: string;
    returnToConversationFiles?: {
      conversationId?: string;
      initialFilePath?: string;
      initialDirectoryPath?: string;
      initialScrollOffset?: number;
      initialSearchQuery?: string;
      initialFileFilter?: ConversationFileFilter;
      initialFileSort?: ConversationFileSort;
    };
  };
};

export const CodeEditorScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const route = useRoute<RouteProp<EditorRouteParams, 'CodeEditor'>>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const untitledFileLabel = t('codeEditor.untitledFile');
  const untitledPathLabel = t('codeEditor.untitledPath');
  const newFileNameLabel = t('codeEditor.newFileName');
  const openFailedTitle = t('codeEditor.openFailedTitle');
  const openFailedMessage = t('codeEditor.openFailedMessage');
  const styles = useMemo(() => createStyles(colors), [colors]);
  const editorRef = useRef<CodeEditorWebViewRef>(null);
  const sshTargets = useSettingsStore((state) => state.sshTargets ?? []);
  const workspaceTargets = useSettingsStore((state) => state.workspaceTargets ?? []);

  const params = route.params ?? {};
  const conversationFilesTarget = useMemo(() => {
    const target = params.returnToConversationFiles;
    if (!target || typeof target !== 'object') {
      return null;
    }

    const conversationId =
      typeof target.conversationId === 'string' && target.conversationId.trim()
        ? target.conversationId.trim()
        : undefined;
    if (!conversationId) {
      return null;
    }

    const browseState = getConversationFilesBrowseState({
      directoryPath: target.initialDirectoryPath,
      scrollOffset: target.initialScrollOffset,
      searchQuery: target.initialSearchQuery,
      fileFilter: target.initialFileFilter,
      fileSort: target.initialFileSort,
    });

    return {
      conversationId,
      initialFilePath:
        typeof target.initialFilePath === 'string' ? target.initialFilePath : undefined,
      initialDirectoryPath:
        typeof target.initialDirectoryPath === 'string' ? browseState.directoryPath : undefined,
      initialScrollOffset:
        typeof target.initialScrollOffset === 'number' ? browseState.scrollOffset : undefined,
      initialSearchQuery:
        typeof target.initialSearchQuery === 'string' ? browseState.searchQuery : undefined,
      initialFileFilter:
        typeof target.initialFileFilter === 'string' ? browseState.fileFilter : undefined,
      initialFileSort:
        typeof target.initialFileSort === 'string' ? browseState.fileSort : undefined,
    };
  }, [params.returnToConversationFiles]);
  const conversationWorkspaceId =
    typeof params.conversationId === 'string' && params.conversationId.trim()
      ? params.conversationId.trim()
      : undefined;
  const initialHandledRouteRequestKey =
    typeof params.content === 'string'
      ? JSON.stringify({
          conversationWorkspaceId: conversationWorkspaceId ?? null,
          content: params.content,
          filePath: params.filePath ?? null,
          language: params.language ?? null,
          source: params.source ?? null,
          targetId: params.targetId ?? null,
        })
      : null;
  const handledRouteRequestRef = useRef<string | null>(initialHandledRouteRequestKey);
  const enabledSshTargets = useMemo(
    () => sshTargets.filter((target) => target.enabled),
    [sshTargets],
  );
  const enabledWorkspaceTargets = useMemo(
    () => workspaceTargets.filter((target) => target.enabled),
    [workspaceTargets],
  );
  const initialSource =
    params.source ??
    (conversationWorkspaceId
      ? 'local'
      : enabledWorkspaceTargets.length > 0
        ? 'workspace'
        : enabledSshTargets.length > 0
          ? 'ssh'
          : 'local');
  const initialTargetId =
    params.targetId ??
    (initialSource === 'workspace'
      ? enabledWorkspaceTargets[0]?.id
      : initialSource === 'ssh'
        ? enabledSshTargets[0]?.id
        : undefined);
  const initialPath = params.filePath ?? '';
  const initialContent = params.content ?? '';
  const initialFileName = initialPath.split('/').pop() || untitledFileLabel;
  const initialLanguage = params.language ?? detectEditorLanguage(initialFileName);

  const [isDirty, setIsDirty] = useState(false);
  const [readOnly, setReadOnly] = useState(params.readOnly ?? false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [source, setSource] =
    useState<NonNullable<EditorRouteParams['CodeEditor']['source']>>(initialSource);
  const [targetId, setTargetId] = useState<string | undefined>(initialTargetId);
  const [activePath, setActivePath] = useState(initialPath);
  const [pathDraft, setPathDraft] = useState(initialPath || untitledPathLabel);
  const [language, setLanguage] = useState<EditorLanguage>(initialLanguage);
  const [editorSeedContent, setEditorSeedContent] = useState(initialContent);
  const [editorKey, setEditorKey] = useState(0);
  const [browserVisible, setBrowserVisible] = useState(!initialPath && initialSource !== 'local');
  const [editorMode, setEditorMode] = useState<'unknown' | 'codemirror' | 'fallback'>('unknown');

  const activeSshTarget = useMemo(
    () => enabledSshTargets.find((target) => target.id === targetId) ?? null,
    [enabledSshTargets, targetId],
  );
  const activeWorkspaceTarget = useMemo(
    () => enabledWorkspaceTargets.find((target) => target.id === targetId) ?? null,
    [enabledWorkspaceTargets, targetId],
  );
  const activeTarget =
    source === 'ssh' ? activeSshTarget : source === 'workspace' ? activeWorkspaceTarget : null;
  const isConversationWorkspaceSource = source === 'local' && Boolean(conversationWorkspaceId);
  const activeTargetRoot = useMemo(() => {
    if (source === 'ssh') {
      return activeSshTarget?.remoteRoot?.trim() || '.';
    }
    if (source === 'workspace') {
      return activeWorkspaceTarget?.rootPath?.trim() || '/';
    }
    return '/';
  }, [activeSshTarget, activeWorkspaceTarget, source]);
  const fileName = activePath.split('/').pop() || untitledFileLabel;
  const canPersist =
    source === 'local'
      ? isConversationWorkspaceSource && Boolean(pathDraft.trim())
      : Boolean(targetId) && Boolean(pathDraft.trim());
  const localSourceLabel = conversationWorkspaceId
    ? t('common.files')
    : t('codeEditor.scratchLabel');

  const confirmDiscardIfNeeded = useCallback(
    (action: () => void) => {
      if (!isDirty) {
        action();
        return;
      }

      Alert.alert(t('codeEditor.discardChangesTitle'), t('codeEditor.discardChangesMessage'), [
        { text: t('codeEditor.cancelAction'), style: 'cancel' },
        { text: t('codeEditor.discardAction'), style: 'destructive', onPress: action },
      ]);
    },
    [isDirty, t],
  );

  const fileWorkflow = useCodeEditorFileWorkflow({
    editorRef,
    source,
    targetId,
    activeSshTarget,
    activeWorkspaceTarget,
    enabledSshTargets,
    enabledWorkspaceTargets,
    conversationWorkspaceId,
    pathDraft,
    activeTargetRoot,
    localSourceLabel,
    saving,
    t,
    openFailedTitle,
    openFailedMessage,
    newFileNameLabel,
    untitledPathLabel,
    confirmDiscardIfNeeded,
    setLoading,
    setSaving,
    setActivePath,
    setPathDraft,
    setLanguage,
    setEditorSeedContent,
    setEditorKey,
    setIsDirty,
    setSource,
    setTargetId,
    setBrowserVisible,
    setReadOnly,
  });
  const { cancelPendingFileOpen, resetEditorDocument, openPersistedFile } = fileWorkflow;

  useEffect(() => {
    setReadOnly(params.readOnly ?? false);
  }, [params.readOnly]);

  useEffect(() => {
    const routeRequestKey = JSON.stringify({
      conversationWorkspaceId: conversationWorkspaceId ?? null,
      content: typeof params.content === 'string' ? params.content : null,
      filePath: params.filePath ?? null,
      language: params.language ?? null,
      source: params.source ?? null,
      targetId: params.targetId ?? null,
    });

    if (handledRouteRequestRef.current === routeRequestKey) {
      return;
    }

    if (typeof params.content === 'string') {
      handledRouteRequestRef.current = routeRequestKey;
      cancelPendingFileOpen();
      const nextPath = params.filePath ?? '';
      resetEditorDocument(
        params.content,
        nextPath,
        params.language ?? detectEditorLanguage(nextPath.split('/').pop() || nextPath),
      );
      setSource(params.source ?? (conversationWorkspaceId ? 'local' : initialSource));
      setTargetId(
        params.source === 'workspace' || params.source === 'ssh' ? params.targetId : undefined,
      );
      setBrowserVisible(false);
      return;
    }

    if (!params.filePath) {
      return;
    }

    handledRouteRequestRef.current = routeRequestKey;

    if (params.source === 'ssh' && params.targetId) {
      void openPersistedFile({ source: 'ssh', targetId: params.targetId, path: params.filePath });
      return;
    }

    if (params.source === 'workspace' && params.targetId) {
      void openPersistedFile({
        source: 'workspace',
        targetId: params.targetId,
        path: params.filePath,
      });
      return;
    }

    if (conversationWorkspaceId) {
      void openPersistedFile({
        source: 'local',
        conversationId: conversationWorkspaceId,
        path: params.filePath,
      });
    }
  }, [
    cancelPendingFileOpen,
    conversationWorkspaceId,
    initialSource,
    openPersistedFile,
    params.content,
    params.filePath,
    params.language,
    params.source,
    params.targetId,
    resetEditorDocument,
  ]);

  useEffect(() => {
    if (source === 'workspace' && !activeWorkspaceTarget) {
      setTargetId(enabledWorkspaceTargets[0]?.id);
    } else if (source === 'ssh' && !activeSshTarget) {
      setTargetId(enabledSshTargets[0]?.id);
    }
  }, [activeSshTarget, activeWorkspaceTarget, enabledSshTargets, enabledWorkspaceTargets, source]);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  const handleSave = useCallback(() => {
    if (readOnly) return;
    editorRef.current?.getContent();
    // Content will arrive via onContent callback
  }, [readOnly]);

  const { handleContent } = fileWorkflow;

  const toggleReadOnly = useCallback(() => {
    const next = !readOnly;
    setReadOnly(next);
    editorRef.current?.setReadOnly(next);
  }, [readOnly]);

  const handleBack = useBackToChat({
    targetRoute: conversationFilesTarget
      ? { name: 'ConversationFiles', params: conversationFilesTarget }
      : null,
    beforeNavigate: (continueNavigation) => confirmDiscardIfNeeded(continueNavigation),
  });

  const handleOpenFile = useCallback(
    (nextPath: string) => {
      if (!targetId || (source !== 'ssh' && source !== 'workspace')) {
        return;
      }
      confirmDiscardIfNeeded(() => {
        void openPersistedFile({ source, targetId, path: nextPath });
      });
    },
    [confirmDiscardIfNeeded, openPersistedFile, source, targetId],
  );

  const handleSourceChange = useCallback(
    (nextSource: 'local' | 'workspace' | 'ssh') => {
      if (nextSource === source) {
        return;
      }
      confirmDiscardIfNeeded(() => {
        cancelPendingFileOpen();
        setSource(nextSource);
        if (nextSource === 'workspace') {
          setTargetId(enabledWorkspaceTargets[0]?.id);
          setBrowserVisible(true);
        } else if (nextSource === 'ssh') {
          setTargetId(enabledSshTargets[0]?.id);
          setBrowserVisible(true);
        } else {
          setTargetId(undefined);
          setBrowserVisible(false);
          resetEditorDocument('', '', null);
        }
      });
    },
    [
      cancelPendingFileOpen,
      confirmDiscardIfNeeded,
      enabledSshTargets,
      enabledWorkspaceTargets,
      resetEditorDocument,
      source,
    ],
  );

  const handleTargetChange = useCallback(
    (nextTargetId: string) => {
      if (nextTargetId === targetId) {
        return;
      }
      confirmDiscardIfNeeded(() => {
        cancelPendingFileOpen();
        setTargetId(nextTargetId);
        setBrowserVisible(true);
        resetEditorDocument('', '', null);
      });
    },
    [cancelPendingFileOpen, confirmDiscardIfNeeded, resetEditorDocument, targetId],
  );

  const handleReload = useCallback(
    () => fileWorkflow.handleReload(activePath),
    [activePath, fileWorkflow],
  );
  const { handleNewFile, listCurrentDirectory, targetLabel } = fileWorkflow;

  const modeBannerText = editorMode === 'fallback' ? t('codeEditor.fallbackModeMessage') : null;

  const openRemoteWork = useCallback(() => {
    navigation.navigate('RemoteWork');
  }, [navigation]);

  return (
    <CodeEditorScreenView
      activePath={activePath}
      activeTarget={activeTarget}
      activeTargetRoot={activeTargetRoot}
      browserVisible={browserVisible}
      canPersist={canPersist}
      colors={colors}
      editorKey={editorKey}
      editorRef={editorRef}
      editorSeedContent={editorSeedContent}
      enabledSshTargets={enabledSshTargets}
      enabledWorkspaceTargets={enabledWorkspaceTargets}
      fileName={fileName}
      handleBack={handleBack}
      handleContent={handleContent}
      handleDirtyChange={handleDirtyChange}
      handleNewFile={handleNewFile}
      handleOpenFile={handleOpenFile}
      handleReload={handleReload}
      handleSave={handleSave}
      handleSourceChange={handleSourceChange}
      handleTargetChange={handleTargetChange}
      isConversationWorkspaceSource={isConversationWorkspaceSource}
      isDirty={isDirty}
      language={language}
      listCurrentDirectory={listCurrentDirectory}
      loading={loading}
      localSourceLabel={localSourceLabel}
      modeBannerText={modeBannerText}
      openRemoteWork={openRemoteWork}
      pathDraft={pathDraft}
      readOnly={readOnly}
      saving={saving}
      setBrowserVisible={setBrowserVisible}
      setEditorMode={setEditorMode}
      setPathDraft={setPathDraft}
      source={source}
      styles={styles}
      t={t}
      targetId={targetId}
      targetLabel={targetLabel}
      toggleReadOnly={toggleReadOnly}
    />
  );
};
