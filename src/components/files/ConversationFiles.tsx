// ---------------------------------------------------------------------------
// Kavi — Conversation File Viewer
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File as FileIcon, ChevronLeft, Copy, Share2 } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  type ConversationWorkspaceDirectoryEntry,
  ConversationWorkspaceFileNotFoundError,
  inspectConversationWorkspaceFile,
  listConversationWorkspaceDirectory,
} from '../../services/conversationWorkspace/files';
import { normalizeConversationWorkspacePath } from '../../services/files/pathUtils';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import { shareConversationWorkspaceFile } from '../../services/share/localShare';
import { ConversationFilesStatusView } from './ConversationFilesStatusView';
import { ConversationFilesDirectory } from './ConversationFilesDirectory';
import { createConversationFilesStyles } from './ConversationFiles.styles';
import {
  getSafeConversationFileName,
  type ConversationFileFilter,
  type ConversationFileSort,
} from './conversationFilesPresentation';
import { getConversationFileTypeLabel } from './filePresentation';

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
  const styles = React.useMemo(() => createConversationFilesStyles(colors), [colors]);
  const fileNotFoundMessage = t('conversationFiles.fileNotFoundMessage');
  const unreadableFileMessage = t('conversationFiles.unreadableFileMessage');
  const binaryPreviewUnavailable = t('conversationFiles.binaryPreviewUnavailable');
  const imageFileAccessibilityLabel = t('conversationFiles.imageFileAccessibilityLabel');
  const fileOpeningTitle = t('conversationFiles.fileOpeningTitle');
  const fileMissingTitle = t('conversationFiles.fileMissingTitle');
  const fileMissingHint = t('conversationFiles.fileMissingHint');
  const fileOpenErrorTitle = t('conversationFiles.fileOpenErrorTitle');
  const fileOpenErrorHint = t('conversationFiles.fileOpenErrorHint');
  const retryLabel = t('common.retry');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<ConversationWorkspaceDirectoryEntry[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<DirectoryStatus>('loading');
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<ConversationFileFilter>('all');
  const [fileSort, setFileSort] = useState<ConversationFileSort>('recent');
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [viewerMode, setViewerMode] = useState<ViewerMode>('text');
  const [viewingFileUri, setViewingFileUri] = useState<string | null>(null);
  const [fileViewState, setFileViewState] = useState<FileViewState>({ status: 'ready' });
  const directoryRequestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);
  const entriesRef = useRef<ConversationWorkspaceDirectoryEntry[]>([]);

  const refresh = useCallback(async (options?: { preserveContent?: boolean }) => {
    const requestId = directoryRequestIdRef.current + 1;
    directoryRequestIdRef.current = requestId;
    const preserveContent = options?.preserveContent ?? entriesRef.current.length > 0;
    if (preserveContent) {
      setIsRefreshing(true);
    } else {
      setDirectoryStatus('loading');
    }
    setDirectoryError(null);

    if (!conversationId) {
      entriesRef.current = [];
      setEntries([]);
      setDirectoryStatus('ready');
      setIsRefreshing(false);
      return;
    }

    try {
      const result = await listConversationWorkspaceDirectory(
        conversationId,
        currentPath,
        fallbackConversationIds,
      );
      if (requestId !== directoryRequestIdRef.current) return;
      entriesRef.current = result.entries;
      setEntries(result.entries);
      setDirectoryStatus('ready');
    } catch (error) {
      if (requestId !== directoryRequestIdRef.current) return;
      entriesRef.current = [];
      setEntries([]);
      setDirectoryError(error instanceof Error ? error.message : String(error));
      setDirectoryStatus('error');
    } finally {
      if (requestId === directoryRequestIdRef.current) {
        setIsRefreshing(false);
      }
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
              ? redactSensitiveText(error.message)
              : isMissing
                ? fileNotFoundMessage
                : redactSensitiveText(String(error)),
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
    setSearchQuery('');
    setFileFilter('all');
    setFileSort('recent');

    if (!conversationId) {
      setCurrentPath('');
      setViewingFile(null);
      entriesRef.current = [];
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

  const prepareDirectoryNavigation = useCallback(() => {
    entriesRef.current = [];
    setEntries([]);
    setDirectoryStatus('loading');
    setDirectoryError(null);
    setSearchQuery('');
  }, []);

  const navigateInto = useCallback((name: string) => {
    prepareDirectoryNavigation();
    setCurrentPath((prev) => (prev ? `${prev}/${name}` : name));
  }, [prepareDirectoryNavigation]);

  const navigateUp = useCallback(() => {
    prepareDirectoryNavigation();
    setCurrentPath((prev) => {
      const parts = prev.split('/');
      parts.pop();
      return parts.join('/');
    });
  }, [prepareDirectoryNavigation]);

  const closeViewer = () => {
    fileRequestIdRef.current += 1;
    setViewingFile(null);
    setFileViewState({ status: 'ready' });
    setDirectoryStatus('loading');
  };

  const openFile = useCallback(
    (name: string) => {
      const filePath = currentPath ? `${currentPath}/${name}` : name;
      void openFilePath(filePath);
    },
    [currentPath, openFilePath],
  );

  const handleManualRefresh = useCallback(() => {
    void refresh({ preserveContent: entriesRef.current.length > 0 });
  }, [refresh]);

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

    await shareFilePath(
      viewingFile,
      getSafeConversationFileName(
        viewingFile.split('/').pop(),
        t('conversationFiles.untitledItem'),
      ),
    );
  }, [shareFilePath, t, viewingFile]);

  if (!visible) return null;

  const safeViewingFileName = viewingFile
    ? getSafeConversationFileName(
        viewingFile.split('/').pop(),
        t('conversationFiles.untitledItem'),
      )
    : '';
  const safeViewingFilePath = viewingFile
    ? getSafeConversationFileName(viewingFile, safeViewingFileName)
    : '';

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
                {safeViewingFileName}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {getConversationFileTypeLabel(safeViewingFileName)} · {safeViewingFilePath}
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
                accessibilityLabel={safeViewingFileName || imageFileAccessibilityLabel}
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
        <ConversationFilesDirectory
          colors={colors}
          currentPath={currentPath}
          directoryError={directoryError}
          directoryStatus={directoryStatus}
          entries={entries}
          fileFilter={fileFilter}
          fileSort={fileSort}
          isRefreshing={isRefreshing}
          onClose={onClose}
          onFileFilterChange={setFileFilter}
          onFileSortChange={setFileSort}
          onNavigateInto={navigateInto}
          onNavigateUp={navigateUp}
          onOpenFile={openFile}
          onRefresh={handleManualRefresh}
          onSearchQueryChange={setSearchQuery}
          onShareFile={(filePath, displayName) => {
            void shareFilePath(filePath, displayName);
          }}
          presentation={presentation}
          searchQuery={searchQuery}
          styles={styles}
          workspaceLabel={workspaceLabel}
        />
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
