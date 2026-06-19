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
import { useTranslation } from '../i18n/useTranslation';
import { useSettingsStore } from '../store/useSettingsStore';
import type { FileEntry } from '../components/files/FileBrowser';
import {
  type CodeEditorWebViewRef,
  detectEditorLanguage,
  type EditorLanguage,
} from '../components/editor/CodeEditorWebView';
import {
  getSshTargetLabel,
  listSshDirectory,
  readSshTextFile,
  writeSshTextFile,
} from '../services/ssh/connector';
import { getWorkspaceProviderLabel } from '../services/workspaces/connector';
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '../services/workspaces/files';
import {
  readConversationWorkspaceTextFile,
  writeConversationWorkspaceTextFile,
} from '../services/conversationWorkspace/files';
import { useBackToChat } from '../navigation/useBackToChat';
import type { SshTargetConfig, WorkspaceTargetConfig } from '../types/remote';

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
  const isMountedRef = useRef(true);
  const remoteOpenRequestIdRef = useRef(0);
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

    return {
      conversationId,
      initialFilePath:
        typeof target.initialFilePath === 'string' ? target.initialFilePath : undefined,
      initialDirectoryPath:
        typeof target.initialDirectoryPath === 'string' ? target.initialDirectoryPath : undefined,
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
  const [editorModeReason, setEditorModeReason] = useState<string | null>(null);

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

  const cancelPendingFileOpen = useCallback(() => {
    remoteOpenRequestIdRef.current += 1;
    if (isMountedRef.current) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      remoteOpenRequestIdRef.current += 1;
    };
  }, []);

  const resetEditorDocument = useCallback(
    (nextContent: string, nextPath: string, nextLanguage: EditorLanguage) => {
      setEditorSeedContent(nextContent);
      setEditorKey((value) => value + 1);
      setActivePath(nextPath);
      setPathDraft(nextPath || untitledPathLabel);
      setLanguage(nextLanguage);
      setIsDirty(false);
    },
    [untitledPathLabel],
  );

  const openPersistedFile = useCallback(
    async (
      request:
        | { source: 'workspace'; targetId: string; path: string }
        | { source: 'ssh'; targetId: string; path: string }
        | { source: 'local'; conversationId: string; path: string },
    ) => {
      const requestId = remoteOpenRequestIdRef.current + 1;
      remoteOpenRequestIdRef.current = requestId;
      setLoading(true);
      try {
        let nextDocument: {
          content: string;
          path: string;
          language: EditorLanguage;
        } | null = null;

        if (request.source === 'ssh') {
          const target = enabledSshTargets.find((entry) => entry.id === request.targetId);
          if (!target) {
            throw new Error('SSH target not found');
          }
          const content = await readSshTextFile(target, request.path);
          nextDocument = {
            content,
            path: request.path,
            language: detectEditorLanguage(request.path.split('/').pop() || request.path),
          };
        } else if (request.source === 'workspace') {
          const target = enabledWorkspaceTargets.find((entry) => entry.id === request.targetId);
          if (!target) {
            throw new Error('Workspace target not found');
          }
          const result = await readWorkspaceFile(target, request.path);
          nextDocument = {
            content: result.content,
            path: result.path,
            language: detectEditorLanguage(result.path.split('/').pop() || result.path),
          };
        } else {
          const result = await readConversationWorkspaceTextFile(
            request.conversationId,
            request.path,
          );
          nextDocument = {
            content: result.content,
            path: result.path,
            language: detectEditorLanguage(result.path.split('/').pop() || result.path),
          };
        }

        if (
          !nextDocument ||
          requestId !== remoteOpenRequestIdRef.current ||
          !isMountedRef.current
        ) {
          return;
        }

        resetEditorDocument(nextDocument.content, nextDocument.path, nextDocument.language);
        setSource(request.source);
        setTargetId(request.source === 'local' ? undefined : request.targetId);
        setBrowserVisible(false);
      } catch (err: unknown) {
        if (requestId !== remoteOpenRequestIdRef.current || !isMountedRef.current) {
          return;
        }
        Alert.alert(
          openFailedTitle,
          (err instanceof Error ? err.message : '') || openFailedMessage,
        );
      } finally {
        if (requestId === remoteOpenRequestIdRef.current && isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [
      enabledSshTargets,
      enabledWorkspaceTargets,
      openFailedMessage,
      openFailedTitle,
      resetEditorDocument,
    ],
  );

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

  const handleContent = useCallback(
    async (content: string) => {
      if (saving) return;
      setSaving(true);

      try {
        // Save via the appropriate backend
        const nextPath = pathDraft.trim();
        if (source === 'ssh' && activeSshTarget) {
          await writeSshTextFile(activeSshTarget, nextPath, content);
          setActivePath(nextPath);
          setLanguage(detectEditorLanguage(nextPath.split('/').pop() || nextPath));
        } else if (source === 'workspace' && activeWorkspaceTarget) {
          await writeWorkspaceFile(activeWorkspaceTarget, nextPath, content);
          setActivePath(nextPath);
          setLanguage(detectEditorLanguage(nextPath.split('/').pop() || nextPath));
        } else if (source === 'local' && conversationWorkspaceId) {
          const result = await writeConversationWorkspaceTextFile(
            conversationWorkspaceId,
            nextPath,
            content,
          );
          setActivePath(result.path);
          setPathDraft(result.path);
          setLanguage(detectEditorLanguage(result.path.split('/').pop() || result.path));
        } else if (source === 'local') {
          throw new Error(t('codeEditor.scratchSaveHint'));
        } else {
          throw new Error(t('codeEditor.targetRequired'));
        }
        // Mark clean after successful save
        editorRef.current?.markClean();
      } catch (err: unknown) {
        Alert.alert(
          t('codeEditor.saveFailedTitle'),
          (err instanceof Error ? err.message : '') || t('codeEditor.saveFailedMessage'),
        );
      } finally {
        setSaving(false);
      }
    },
    [activeSshTarget, activeWorkspaceTarget, conversationWorkspaceId, pathDraft, saving, source, t],
  );

  const toggleReadOnly = useCallback(() => {
    const next = !readOnly;
    setReadOnly(next);
    editorRef.current?.setReadOnly(next);
  }, [readOnly]);

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

  const handleReload = useCallback(() => {
    if (!activePath) {
      return;
    }
    confirmDiscardIfNeeded(() => {
      if (source === 'local' && conversationWorkspaceId) {
        void openPersistedFile({
          source: 'local',
          conversationId: conversationWorkspaceId,
          path: activePath,
        });
        return;
      }

      if (!targetId || (source !== 'ssh' && source !== 'workspace')) {
        return;
      }

      void openPersistedFile({ source, targetId, path: activePath });
    });
  }, [
    activePath,
    confirmDiscardIfNeeded,
    conversationWorkspaceId,
    openPersistedFile,
    source,
    targetId,
  ]);

  const handleNewFile = useCallback(() => {
    confirmDiscardIfNeeded(() => {
      cancelPendingFileOpen();
      const root = activeTargetRoot === '/' ? '' : activeTargetRoot.replace(/\/+$/g, '');
      const nextPath =
        source === 'local'
          ? conversationWorkspaceId
            ? newFileNameLabel
            : untitledPathLabel
          : `${root}/${newFileNameLabel}`.replace(/\/\//g, '/');
      resetEditorDocument(
        '',
        nextPath,
        detectEditorLanguage(nextPath.split('/').pop() || nextPath),
      );
      setBrowserVisible(false);
      setReadOnly(false);
    });
  }, [
    activeTargetRoot,
    cancelPendingFileOpen,
    confirmDiscardIfNeeded,
    conversationWorkspaceId,
    newFileNameLabel,
    resetEditorDocument,
    source,
    untitledPathLabel,
  ]);

  const listCurrentDirectory = useCallback(
    async (path: string): Promise<FileEntry[]> => {
      if (source === 'ssh' && activeSshTarget) {
        const entries = await listSshDirectory(activeSshTarget, path);
        return entries.map((entry) => ({
          name: entry.filename,
          isDirectory: entry.isDirectory,
          size: entry.fileSize,
          modifiedAt: entry.modificationDate,
        }));
      }
      if (source === 'workspace' && activeWorkspaceTarget) {
        const result = await listWorkspaceDirectory(activeWorkspaceTarget, path);
        return result.entries;
      }
      return [];
    },
    [activeSshTarget, activeWorkspaceTarget, source],
  );

  const targetLabel = useMemo(() => {
    if (source === 'ssh' && activeSshTarget) {
      return getSshTargetLabel(activeSshTarget as SshTargetConfig);
    }
    if (source === 'workspace' && activeWorkspaceTarget) {
      return `${activeWorkspaceTarget.name} · ${getWorkspaceProviderLabel(activeWorkspaceTarget.provider as WorkspaceTargetConfig['provider'])}`;
    }
    return localSourceLabel;
  }, [activeSshTarget, activeWorkspaceTarget, localSourceLabel, source]);

  const modeBannerText =
    editorMode === 'fallback'
      ? t('codeEditor.fallbackModeMessage')
      : editorMode === 'codemirror'
        ? t('codeEditor.fullEditorModeMessage')
        : null;

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
      editorMode={editorMode}
      editorModeReason={editorModeReason}
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
      setEditorModeReason={setEditorModeReason}
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
