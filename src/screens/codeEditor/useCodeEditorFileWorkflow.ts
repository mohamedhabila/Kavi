// ---------------------------------------------------------------------------
// Kavi — Code Editor File Workflow
// ---------------------------------------------------------------------------
// Open/save/reload/new-file logic for CodeEditorScreen, plus the plain-
// language error handling around it. Extracted from CodeEditorScreen.tsx to
// keep that file under the repository's maintainability line limit; the
// screen still owns the document's UI-visible state (path, content, dirty
// flag, source/target selection) and passes it in, since that state is also
// read and written by handlers this hook does not own (source/target
// switching, discard confirmation).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import { detectEditorLanguage } from '../../components/editor/CodeEditorWebView';
import type { FileEntry } from '../../components/files/FileBrowser';
import {
  getSshTargetLabel,
  listSshDirectory,
  readSshTextFile,
  writeSshTextFile,
} from '../../services/ssh/connector';
import { getWorkspaceProviderLabel } from '../../services/workspaces/connector';
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '../../services/workspaces/files';
import {
  readConversationWorkspaceTextFile,
  writeConversationWorkspaceTextFile,
} from '../../services/conversationWorkspace/files';
import { showLocalizedErrorAlert } from '../../utils/errorAlert';
import type { SshTargetConfig, WorkspaceTargetConfig } from '../../types/remote';
import type {
  CodeEditorLanguage,
  CodeEditorRef,
  CodeEditorSource,
  CodeEditorTranslation,
} from './codeEditorScreenTypes';

/**
 * Marks a thrown error whose message is already deliberate, localized,
 * user-facing guidance (e.g. "choose a save target") rather than a raw
 * technical failure. The save handler shows this message directly instead
 * of routing it through the generic error alert.
 */
export class CodeEditorSaveGuidanceError extends Error {}

export type OpenPersistedFileRequest =
  | { source: 'workspace'; targetId: string; path: string }
  | { source: 'ssh'; targetId: string; path: string }
  | { source: 'local'; conversationId: string; path: string };

export interface UseCodeEditorFileWorkflowParams {
  editorRef: CodeEditorRef;
  source: CodeEditorSource;
  targetId: string | undefined;
  activeSshTarget: SshTargetConfig | null;
  activeWorkspaceTarget: WorkspaceTargetConfig | null;
  enabledSshTargets: SshTargetConfig[];
  enabledWorkspaceTargets: WorkspaceTargetConfig[];
  conversationWorkspaceId: string | undefined;
  pathDraft: string;
  activeTargetRoot: string;
  localSourceLabel: string;
  saving: boolean;
  t: CodeEditorTranslation;
  openFailedTitle: string;
  openFailedMessage: string;
  newFileNameLabel: string;
  untitledPathLabel: string;
  confirmDiscardIfNeeded: (action: () => void) => void;
  setLoading: (value: boolean) => void;
  setSaving: (value: boolean) => void;
  setActivePath: (value: string) => void;
  setPathDraft: (value: string) => void;
  setLanguage: (value: CodeEditorLanguage) => void;
  setEditorSeedContent: (value: string) => void;
  setEditorKey: (updater: (value: number) => number) => void;
  setIsDirty: (value: boolean) => void;
  setSource: (value: CodeEditorSource) => void;
  setTargetId: (value: string | undefined) => void;
  setBrowserVisible: (value: boolean) => void;
  setReadOnly: (value: boolean) => void;
}

export interface UseCodeEditorFileWorkflowResult {
  cancelPendingFileOpen: () => void;
  resetEditorDocument: (
    nextContent: string,
    nextPath: string,
    nextLanguage: CodeEditorLanguage,
  ) => void;
  openPersistedFile: (request: OpenPersistedFileRequest) => Promise<void>;
  handleContent: (content: string) => Promise<void>;
  handleReload: (activePath: string) => void;
  handleNewFile: () => void;
  listCurrentDirectory: (path: string) => Promise<FileEntry[]>;
  targetLabel: string;
}

/** Owns CodeEditorScreen's file open/save/reload/new-file workflow and its error alerts. */
export function useCodeEditorFileWorkflow(
  params: UseCodeEditorFileWorkflowParams,
): UseCodeEditorFileWorkflowResult {
  const {
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
  } = params;

  const isMountedRef = useRef(true);
  const remoteOpenRequestIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      remoteOpenRequestIdRef.current += 1;
    };
  }, []);

  const cancelPendingFileOpen = useCallback(() => {
    remoteOpenRequestIdRef.current += 1;
    if (isMountedRef.current) {
      setLoading(false);
    }
  }, [setLoading]);

  const resetEditorDocument = useCallback(
    (nextContent: string, nextPath: string, nextLanguage: CodeEditorLanguage) => {
      setEditorSeedContent(nextContent);
      setEditorKey((value) => value + 1);
      setActivePath(nextPath);
      setPathDraft(nextPath || untitledPathLabel);
      setLanguage(nextLanguage);
      setIsDirty(false);
    },
    [setActivePath, setEditorKey, setEditorSeedContent, setIsDirty, setLanguage, setPathDraft, untitledPathLabel],
  );

  const openPersistedFile = useCallback(
    async (request: OpenPersistedFileRequest) => {
      const requestId = remoteOpenRequestIdRef.current + 1;
      remoteOpenRequestIdRef.current = requestId;
      setLoading(true);
      try {
        let nextDocument: {
          content: string;
          path: string;
          language: CodeEditorLanguage;
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
        showLocalizedErrorAlert({
          title: openFailedTitle,
          message: openFailedMessage,
          error: err,
          technicalDetailsLabel: t('common.technicalDetails'),
        });
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
      setBrowserVisible,
      setLoading,
      setSource,
      setTargetId,
      t,
    ],
  );

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
          throw new CodeEditorSaveGuidanceError(t('codeEditor.scratchSaveHint'));
        } else {
          throw new CodeEditorSaveGuidanceError(t('codeEditor.targetRequired'));
        }
        // Mark clean after successful save
        editorRef.current?.markClean();
      } catch (err: unknown) {
        if (err instanceof CodeEditorSaveGuidanceError) {
          Alert.alert(t('codeEditor.saveFailedTitle'), err.message);
        } else {
          showLocalizedErrorAlert({
            title: t('codeEditor.saveFailedTitle'),
            message: t('codeEditor.saveFailedMessage'),
            error: err,
            technicalDetailsLabel: t('common.technicalDetails'),
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [
      activeSshTarget,
      activeWorkspaceTarget,
      conversationWorkspaceId,
      editorRef,
      pathDraft,
      saving,
      setActivePath,
      setLanguage,
      setPathDraft,
      setSaving,
      source,
      t,
    ],
  );

  const handleReload = useCallback(
    (activePath: string) => {
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
    },
    [confirmDiscardIfNeeded, conversationWorkspaceId, openPersistedFile, source, targetId],
  );

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
      resetEditorDocument('', nextPath, detectEditorLanguage(nextPath.split('/').pop() || nextPath));
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
    setBrowserVisible,
    setReadOnly,
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

  return {
    cancelPendingFileOpen,
    resetEditorDocument,
    openPersistedFile,
    handleContent,
    handleReload,
    handleNewFile,
    listCurrentDirectory,
    targetLabel,
  };
}
