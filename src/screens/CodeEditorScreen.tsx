// ---------------------------------------------------------------------------
// Kavi — Code Editor Screen
// ---------------------------------------------------------------------------
// Full syntax-highlighted code editor (CodeMirror 6 in WebView) with remote
// file integration for SSH and workspace targets.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import {
  ArrowLeft,
  Save,
  FileCode,
  FolderOpen,
  Eye,
  Edit3,
  RefreshCw,
  FolderTree,
  PlusSquare,
} from 'lucide-react-native';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import { useSettingsStore } from '../store/useSettingsStore';
import { FileBrowser, type FileEntry } from '../components/files/FileBrowser';
import {
  CodeEditorWebView,
  CodeEditorWebViewRef,
  detectEditorLanguage,
  EditorLanguage,
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
import type { SshTargetConfig, WorkspaceTargetConfig } from '../types';

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
  const hasRemoteTargets = enabledWorkspaceTargets.length > 0 || enabledSshTargets.length > 0;
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={8} accessibilityLabel={t('common.back')}>
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <FileCode size={16} color={colors.textSecondary} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName || t('codeEditor.title')}
          </Text>
          {isDirty && <View style={styles.dirtyDot} />}
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
          {!readOnly && (
            <TouchableOpacity
              onPress={handleSave}
              hitSlop={8}
              style={styles.headerBtn}
              disabled={!isDirty || saving || !canPersist}
              accessibilityLabel={t('codeEditor.saveFile')}
            >
              <Save
                size={18}
                color={isDirty && canPersist ? colors.primary : colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.sourceBar}>
        {(['workspace', 'ssh', 'local'] as Array<'workspace' | 'ssh' | 'local'>).map((entry) => {
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

      {source !== 'local' && (
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
      )}

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
        {language && (
          <View style={styles.langBadge}>
            <Text style={styles.langBadgeText}>{language}</Text>
          </View>
        )}
      </View>

      <View style={styles.contextBar}>
        <Text style={styles.contextText} numberOfLines={1}>
          {targetLabel}
        </Text>
        <View style={styles.contextActions}>
          {source !== 'local' && (
            <TouchableOpacity
              style={styles.contextBtn}
              onPress={() => setBrowserVisible((value) => !value)}
            >
              <FolderTree size={14} color={colors.primary} />
              <Text style={styles.contextBtnText}>{t('codeEditor.browseFiles')}</Text>
            </TouchableOpacity>
          )}
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
          <TouchableOpacity
            style={styles.primaryCta}
            onPress={() => navigation.navigate('RemoteWork')}
          >
            <Text style={styles.primaryCtaText}>{t('codeEditor.openRemoteWork')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!hasRemoteTargets &&
      source === 'local' &&
      !isConversationWorkspaceSource &&
      !activePath &&
      !editorSeedContent ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('codeEditor.startEditingTitle')}</Text>
          <Text style={styles.emptyBody}>{t('codeEditor.startEditingMessage')}</Text>
          <TouchableOpacity
            style={styles.primaryCta}
            onPress={() => navigation.navigate('RemoteWork')}
          >
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

      {/* Editor */}
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>{t('codeEditor.loadingFile')}</Text>
            </View>
          ) : (
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
          )}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.flex}>
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>{t('codeEditor.loadingFile')}</Text>
            </View>
          ) : (
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
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    sourceBar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    sourceChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sourceChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    sourceChipDisabled: {
      opacity: 0.45,
    },
    sourceChipText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    sourceChipTextActive: {
      color: colors.primary,
    },
    sourceChipTextDisabled: {
      color: colors.textTertiary,
    },
    targetBar: {
      paddingHorizontal: 16,
      paddingTop: 10,
      gap: 8,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    targetChipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    targetChip: {
      maxWidth: '100%',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    targetChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    targetChipText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    targetChipTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerCenter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 12,
    },
    headerTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
    dirtyDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.warning,
      marginLeft: 4,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerBtn: { padding: 4 },
    pathBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 6,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pathInput: {
      flex: 1,
      fontSize: 11,
      color: colors.textTertiary,
      fontFamily: 'monospace',
      paddingVertical: 0,
    },
    langBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: colors.primarySoft,
    },
    langBadgeText: { fontSize: 10, fontWeight: '600', color: colors.primary },
    contextBar: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    contextText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontFamily: 'monospace',
    },
    contextActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    contextBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    contextBtnText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    modeBanner: {
      marginHorizontal: 16,
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      gap: 2,
    },
    modeBannerWarning: {
      backgroundColor: colors.warning + '15',
      borderColor: colors.warning,
    },
    modeBannerSuccess: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    modeBannerText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    modeBannerSubtext: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    browserPanel: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 8,
    },
    emptyState: {
      marginHorizontal: 16,
      marginTop: 12,
      padding: 16,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    primaryCta: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    primaryCtaText: {
      fontSize: 12,
      color: colors.onPrimary,
      fontWeight: '700',
    },
    loadingState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    loadingText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
  });
