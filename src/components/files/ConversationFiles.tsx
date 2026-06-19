// ---------------------------------------------------------------------------
// Kavi — Conversation File Viewer
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from 'react';
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
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import {
  inspectConversationWorkspaceFile,
  listConversationWorkspaceDirectory,
} from '../../services/conversationWorkspace/files';
import { normalizeConversationWorkspacePath } from '../../services/files/pathUtils';
import { shareConversationWorkspaceFile } from '../../services/share/localShare';

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
}

type ViewerMode = 'text' | 'image' | 'binary';

function getParentPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

function getLanguageFromExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    py: 'Python',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    md: 'Markdown',
    txt: 'Text',
    sh: 'Shell',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    c: 'C',
    cpp: 'C++',
    h: 'C Header',
    swift: 'Swift',
    kt: 'Kotlin',
  };
  return map[ext] || ext.toUpperCase() || 'File';
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
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [viewerMode, setViewerMode] = useState<ViewerMode>('text');
  const [viewingFileUri, setViewingFileUri] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setEntries([]);
      return;
    }

    try {
      const result = await listConversationWorkspaceDirectory(
        conversationId,
        currentPath,
        fallbackConversationIds,
      );
      setEntries(
        result.entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
        })),
      );
    } catch {
      setEntries([]);
    }
  }, [conversationId, currentPath, fallbackConversationIds]);

  const openFilePath = useCallback(
    async (filePath: string) => {
      if (!conversationId) return;

      try {
        const result = await inspectConversationWorkspaceFile(
          conversationId,
          filePath,
          fallbackConversationIds,
        );

        if (result.kind === 'text' && onOpenTextFile) {
          onOpenTextFile(result.path, result.content, result.conversationId);
          return;
        }

        setViewingFile(result.path);
        setViewingFileUri(result.uri);

        if (result.kind === 'image') {
          setViewerMode('image');
          setFileContent('');
          return;
        }

        if (result.kind === 'binary') {
          setViewerMode('binary');
          setFileContent(unreadableFileMessage);
          return;
        }

        if (result.kind === 'text') {
          setFileContent(result.content);
          setViewerMode('text');
        }
      } catch {
        setViewingFile(normalizeConversationWorkspacePath(filePath) || filePath);
        setViewingFileUri(null);
        setFileContent(fileNotFoundMessage);
        setViewerMode('text');
      }
    },
    [
      conversationId,
      fallbackConversationIds,
      fileNotFoundMessage,
      onOpenTextFile,
      unreadableFileMessage,
    ],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    setFileContent('');
    setViewingFileUri(null);

    if (!conversationId) {
      setCurrentPath('');
      setViewingFile(null);
      setEntries([]);
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
  }, [visible, conversationId, initialDirectoryPath, initialFilePath, openFilePath]);

  useEffect(() => {
    if (visible && !viewingFile) {
      void refresh();
    }
  }, [currentPath, refresh, refreshToken, viewingFile, visible]);

  const navigateInto = (name: string) => {
    setCurrentPath((prev) => (prev ? `${prev}/${name}` : name));
  };

  const navigateUp = () => {
    setCurrentPath((prev) => {
      const parts = prev.split('/');
      parts.pop();
      return parts.join('/');
    });
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
            <TouchableOpacity onPress={() => setViewingFile(null)} hitSlop={8}>
              <ChevronLeft size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {viewingFile.split('/').pop()}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {getLanguageFromExt(viewingFile)} · {viewingFile}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleCopy} hitSlop={8}>
                <Copy size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleShare} hitSlop={8}>
                <Share2 size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
          {viewerMode === 'image' && viewingFileUri ? (
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
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <X size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>{t('common.files')}</Text>
              {currentPath ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  /{currentPath}
                </Text>
              ) : null}
            </View>
            {currentPath ? (
              <TouchableOpacity onPress={navigateUp} hitSlop={8}>
                <ChevronLeft size={24} color={colors.primary} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 24 }} />
            )}
          </View>
          <FlatList
            data={entries}
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
              <View style={styles.emptyState}>
                <FileIcon size={40} color={colors.textTertiary} />
                <Text style={styles.emptyText}>{emptyTitle}</Text>
                <Text style={styles.emptyHint}>{emptyHint}</Text>
              </View>
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
      gap: 16,
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
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 80,
      gap: 8,
    },
    emptyText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    emptyHint: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingHorizontal: 40,
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
