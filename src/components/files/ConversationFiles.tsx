// ---------------------------------------------------------------------------
// Kavi — Conversation File Viewer
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  File as FileIcon,
  Folder,
  ChevronLeft,
  ChevronRight,
  Copy,
  Share2,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import {
  ConversationWorkspaceFileNotFoundError,
  inspectConversationWorkspaceFile,
  listConversationWorkspaceDirectory,
} from '../../services/conversationWorkspace/files';
import { normalizeConversationWorkspacePath } from '../../services/files/pathUtils';
import { shareConversationWorkspaceFile } from '../../services/share/localShare';
import { ConversationFilesStatusView } from './ConversationFilesStatusView';
import { getConversationFileTypeLabel } from './filePresentation';

interface FileEntry {
  name: string;
  isDirectory: boolean;
}

interface ConversationFilesProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string | null;
  fallbackConversationIds?: string[];
  refreshToken?: string | number;
  initialFilePath?: string | null;
  initialDirectoryPath?: string | null;
  onOpenTextFile?: (filePath: string, content: string, sourceConversationId?: string) => void;
  presentation?: 'modal' | 'screen';
  workspaceLabel?: string;
}

type ViewerMode = 'text' | 'image' | 'binary';
type DirectoryStatus = 'loading' | 'ready' | 'error';
type FileViewState =
  | { status: 'ready' | 'loading' }
  | { status: 'error'; title: string; hint: string; detail: string };

function getParentPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

export const ConversationFiles: React.FC<ConversationFilesProps> = ({
  visible,
  onClose,
  conversationId,
  fallbackConversationIds,
  refreshToken,
  initialFilePath,
  initialDirectoryPath,
  onOpenTextFile,
  presentation = 'modal',
  workspaceLabel,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const fileNotFoundMessage = t('conversationFiles.fileNotFoundMessage');
  const unreadableFileMessage = t('conversationFiles.unreadableFileMessage');
  const binaryPreviewUnavailable = t('conversationFiles.binaryPreviewUnavailable');
  const imageFileAccessibilityLabel = t('conversationFiles.imageFileAccessibilityLabel');
  const emptyTitle = t('conversationFiles.emptyTitle');
  const emptyHint = t('conversationFiles.emptyHint');
  const loadingTitle = t('conversationFiles.loadingTitle');
  const loadErrorTitle = t('conversationFiles.loadErrorTitle');
  const loadErrorHint = t('conversationFiles.loadErrorHint');
  const fileOpeningTitle = t('conversationFiles.fileOpeningTitle');
  const fileMissingTitle = t('conversationFiles.fileMissingTitle');
  const fileMissingHint = t('conversationFiles.fileMissingHint');
  const fileOpenErrorTitle = t('conversationFiles.fileOpenErrorTitle');
  const fileOpenErrorHint = t('conversationFiles.fileOpenErrorHint');
  const retryLabel = t('common.retry');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<DirectoryStatus>('loading');
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [viewerMode, setViewerMode] = useState<ViewerMode>('text');
  const [viewingFileUri, setViewingFileUri] = useState<string | null>(null);
  const [fileViewState, setFileViewState] = useState<FileViewState>({ status: 'ready' });
  const directoryRequestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = directoryRequestIdRef.current + 1;
    directoryRequestIdRef.current = requestId;
    setDirectoryStatus('loading');
    setDirectoryError(null);

    if (!conversationId) {
      setEntries([]);
      setDirectoryStatus('ready');
      return;
    }

    try {
      const result = await listConversationWorkspaceDirectory(
        conversationId,
        currentPath,
        fallbackConversationIds,
      );
      if (requestId !== directoryRequestIdRef.current) return;
      setEntries(
        result.entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
        })),
      );
      setDirectoryStatus('ready');
    } catch (error) {
      if (requestId !== directoryRequestIdRef.current) return;
      setEntries([]);
      setDirectoryError(error instanceof Error ? error.message : String(error));
      setDirectoryStatus('error');
    }
  }, [conversationId, currentPath, fallbackConversationIds]);

  const openFilePath = useCallback(
    async (filePath: string) => {
      if (!conversationId) return;

      const displayPath = normalizeConversationWorkspacePath(filePath) || filePath;
      const requestId = fileRequestIdRef.current + 1;
      fileRequestIdRef.current = requestId;
      setViewingFile(displayPath);
      setViewingFileUri(null);
      setFileContent('');
      setFileViewState({ status: 'loading' });

      try {
        const result = await inspectConversationWorkspaceFile(
          conversationId,
          filePath,
          fallbackConversationIds,
        );
        if (requestId !== fileRequestIdRef.current) return;

        if (result.kind === 'text' && onOpenTextFile) {
          setFileViewState({ status: 'ready' });
          onOpenTextFile(result.path, result.content, result.conversationId);
          return;
        }

        setViewingFile(result.path);
        setViewingFileUri(result.uri);

        if (result.kind === 'image') {
          setViewerMode('image');
          setFileContent('');
          setFileViewState({ status: 'ready' });
          return;
        }

        if (result.kind === 'binary') {
          setViewerMode('binary');
          setFileContent(unreadableFileMessage);
          setFileViewState({ status: 'ready' });
          return;
        }

        if (result.kind === 'text') {
          setFileContent(result.content);
          setViewerMode('text');
          setFileViewState({ status: 'ready' });
        }
      } catch (error) {
        if (requestId !== fileRequestIdRef.current) return;
        const isMissing = error instanceof ConversationWorkspaceFileNotFoundError;
        setViewingFileUri(null);
        setFileContent('');
        setViewerMode('text');
        setFileViewState({
          status: 'error',
          title: isMissing ? fileMissingTitle : fileOpenErrorTitle,
          hint: isMissing ? fileMissingHint : fileOpenErrorHint,
          detail:
            error instanceof Error
              ? error.message
              : isMissing
                ? fileNotFoundMessage
                : String(error),
        });
      }
    },
    [
      conversationId,
      fallbackConversationIds,
      fileMissingHint,
      fileMissingTitle,
      fileNotFoundMessage,
      fileOpenErrorHint,
      fileOpenErrorTitle,
      onOpenTextFile,
      unreadableFileMessage,
    ],
  );

  useEffect(() => {
    directoryRequestIdRef.current += 1;
    fileRequestIdRef.current += 1;

    if (!visible) {
      return;
    }

    setFileContent('');
    setViewingFileUri(null);
    setFileViewState({ status: 'ready' });

    if (!conversationId) {
      setCurrentPath('');
      setViewingFile(null);
      setEntries([]);
      setDirectoryStatus('ready');
      setDirectoryError(null);
      return;
    }

    if (initialFilePath) {
      setCurrentPath(getParentPath(initialFilePath));
      void openFilePath(initialFilePath);
      return;
    }

    setCurrentPath(normalizeConversationWorkspacePath(initialDirectoryPath ?? ''));
    setViewingFile(null);
    setViewerMode('text');
    setDirectoryStatus('loading');
    setDirectoryError(null);
  }, [visible, conversationId, initialDirectoryPath, initialFilePath, openFilePath]);

  useEffect(() => {
    if (visible && !viewingFile) {
      void refresh();
    }
  }, [currentPath, refresh, refreshToken, viewingFile, visible]);

  const navigateInto = (name: string) => {
    setEntries([]);
    setDirectoryStatus('loading');
    setDirectoryError(null);
    setCurrentPath((prev) => (prev ? `${prev}/${name}` : name));
  };

  const navigateUp = () => {
    setEntries([]);
    setDirectoryStatus('loading');
    setDirectoryError(null);
    setCurrentPath((prev) => {
      const parts = prev.split('/');
      parts.pop();
      return parts.join('/');
    });
  };

  const closeViewer = () => {
    fileRequestIdRef.current += 1;
    setViewingFile(null);
    setFileViewState({ status: 'ready' });
    setDirectoryStatus('loading');
  };

  const openFile = async (name: string) => {
    const filePath = currentPath ? `${currentPath}/${name}` : name;
    await openFilePath(filePath);
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(fileContent);
    } catch (e) {
      console.warn('[ConversationFiles] Copy failed:', e);
    }
  };

  const shareFilePath = useCallback(
    async (filePath: string, dialogTitle?: string) => {
      if (!conversationId) return;

      try {
        await shareConversationWorkspaceFile({
          conversationId,
          path: filePath,
          fallbackConversationIds,
          dialogTitle,
        });
      } catch (e) {
        Alert.alert(
          t('common.error'),
          e instanceof Error ? e.message : t('conversationFiles.shareFileFailed'),
        );
      }
    },
    [conversationId, fallbackConversationIds, t],
  );

  const handleShare = useCallback(async () => {
    if (!viewingFile) return;

    await shareFilePath(viewingFile, viewingFile.split('/').pop());
  }, [shareFilePath, viewingFile]);

  if (!visible) return null;

  const content = (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {viewingFile ? (
        // ── File Viewer ──
        <View style={styles.flex}>
          <View style={styles.header}>
            <TouchableOpacity
              accessibilityLabel={t('common.back')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={closeViewer}
              style={styles.headerIconButton}
              testID="conversation-file-back"
            >
              <ChevronLeft size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {viewingFile.split('/').pop()}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {getConversationFileTypeLabel(viewingFile)} · {viewingFile}
              </Text>
            </View>
            <View style={styles.headerActions}>
              {fileViewState.status === 'ready' && viewerMode === 'text' ? (
                <TouchableOpacity
                  accessibilityLabel={t('common.copy')}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={handleCopy}
                  style={styles.headerIconButton}
                  testID="conversation-file-copy"
                >
                  <Copy size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
              {fileViewState.status === 'ready' ? (
                <TouchableOpacity
                  accessibilityLabel={t('common.share')}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={handleShare}
                  style={styles.headerIconButton}
                  testID="conversation-file-share"
                >
                  <Share2 size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          {fileViewState.status === 'loading' ? (
            <ConversationFilesStatusView
              colors={colors}
              status="loading"
              testID="conversation-file-loading"
              title={fileOpeningTitle}
            />
          ) : fileViewState.status === 'error' ? (
            <ConversationFilesStatusView
              colors={colors}
              detail={t('conversationFiles.technicalDetails', {
                detail: fileViewState.detail,
              })}
              hint={fileViewState.hint}
              onRetry={() => void openFilePath(viewingFile)}
              retryLabel={retryLabel}
              status="error"
              testID="conversation-file-error"
              title={fileViewState.title}
            />
          ) : viewerMode === 'image' && viewingFileUri ? (
            <View style={styles.imagePreviewContainer}>
              <Image
                source={{ uri: viewingFileUri }}
                style={styles.imagePreview}
                resizeMode="contain"
                testID="conversation-file-image-preview"
                accessibilityLabel={viewingFile.split('/').pop() || imageFileAccessibilityLabel}
              />
            </View>
          ) : viewerMode === 'binary' ? (
            <View style={styles.binaryState}>
              <FileIcon size={36} color={colors.textTertiary} />
              <Text style={styles.binaryStateTitle}>{binaryPreviewUnavailable}</Text>
              <Text style={styles.binaryStateHint}>{fileContent || unreadableFileMessage}</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.fileContentScroll}
              contentContainerStyle={styles.fileContentContainer}
              horizontal={false}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <Text style={styles.fileContent} selectable>
                  {fileContent}
                </Text>
              </ScrollView>
            </ScrollView>
          )}
        </View>
      ) : (
        // ── Directory Listing ──
        <View style={styles.flex}>
          <View style={styles.header}>
            <TouchableOpacity
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.headerIconButton}
              testID="conversation-files-close"
            >
              <X size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>{t('common.files')}</Text>
              {currentPath ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  /{currentPath}
                </Text>
              ) : workspaceLabel ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {t('conversationFiles.sharedFromConversation', { title: workspaceLabel })}
                </Text>
              ) : null}
            </View>
            {currentPath ? (
              <TouchableOpacity
                accessibilityLabel={t('common.back')}
                accessibilityRole="button"
                hitSlop={8}
                onPress={navigateUp}
                style={styles.headerIconButton}
                testID="conversation-files-up"
              >
                <ChevronLeft size={24} color={colors.primary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.headerIconButton} />
            )}
          </View>
          <FlatList
            data={directoryStatus === 'ready' ? entries : []}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const filePath = currentPath ? `${currentPath}/${item.name}` : item.name;

              return (
                <View style={styles.fileRow}>
                  <TouchableOpacity
                    style={styles.fileRowMain}
                    onPress={() =>
                      item.isDirectory ? navigateInto(item.name) : openFile(item.name)
                    }
                  >
                    {item.isDirectory ? (
                      <Folder size={18} color={colors.primary} />
                    ) : (
                      <FileIcon size={18} color={colors.textSecondary} />
                    )}
                    <Text style={styles.fileName} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                  {item.isDirectory ? (
                    <ChevronRight size={16} color={colors.textTertiary} />
                  ) : (
                    <TouchableOpacity
                      style={styles.fileRowAction}
                      onPress={() => void shareFilePath(filePath, item.name)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Share ${item.name}`}
                      testID={`conversation-file-share-${filePath}`}
                    >
                      <Share2 size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              directoryStatus === 'loading' ? (
                <ConversationFilesStatusView
                  colors={colors}
                  status="loading"
                  testID="conversation-files-loading"
                  title={loadingTitle}
                />
              ) : directoryStatus === 'error' ? (
                <ConversationFilesStatusView
                  colors={colors}
                  detail={
                    directoryError
                      ? t('conversationFiles.technicalDetails', { detail: directoryError })
                      : undefined
                  }
                  hint={loadErrorHint}
                  onRetry={() => void refresh()}
                  retryLabel={retryLabel}
                  status="error"
                  testID="conversation-files-error"
                  title={loadErrorTitle}
                />
              ) : (
                <ConversationFilesStatusView
                  colors={colors}
                  hint={emptyHint}
                  status="empty"
                  testID="conversation-files-empty"
                  title={emptyTitle}
                />
              )
            }
          />
        </View>
      )}
    </SafeAreaView>
  );

  if (presentation === 'screen') {
    return content;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {content}
    </Modal>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    headerTitleWrap: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    headerSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 1,
    },
    headerActions: {
      flexDirection: 'row',
      gap: 4,
    },
    headerIconButton: {
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    listContent: {
      paddingVertical: 8,
      flexGrow: 1,
    },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    fileRowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      minHeight: 44,
    },
    fileName: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
    },
    fileRowAction: {
      minHeight: 44,
      paddingLeft: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    fileContentScroll: {
      flex: 1,
      backgroundColor: colors.codeBackground,
    },
    fileContentContainer: {
      padding: 12,
    },
    fileContent: {
      fontFamily: 'monospace',
      fontSize: 13,
      lineHeight: 20,
      color: colors.text,
    },
    imagePreviewContainer: {
      flex: 1,
      padding: 16,
      backgroundColor: colors.codeBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    imagePreview: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
    },
    binaryState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 32,
      backgroundColor: colors.codeBackground,
    },
    binaryStateTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    binaryStateHint: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
