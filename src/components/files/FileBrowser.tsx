// ---------------------------------------------------------------------------
// Kavi — File Browser Component
// ---------------------------------------------------------------------------
// A reusable file tree browser for SSH and workspace targets.
// Enables navigating, selecting, opening, and performing actions on files.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  RefreshCw,
  Home,
} from 'lucide-react-native';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';

// ── Types ────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface FileBrowserProps {
  /** Root path (e.g. `/home/user/project`) */
  rootPath: string;
  /** Initial directory to open (defaults to rootPath) */
  initialPath?: string;
  /** Function to list directory contents. Must return FileEntry[] */
  listDirectory: (path: string) => Promise<FileEntry[]>;
  /** Called when a file is selected/tapped */
  onFileSelect?: (filePath: string, entry: FileEntry) => void;
  /** Called when user long-presses a file */
  onFileLongPress?: (filePath: string, entry: FileEntry) => void;
  /** Maximum height of the file list */
  maxHeight?: number;
}

interface BreadcrumbSegment {
  label: string;
  path: string;
}

// ── Component ────────────────────────────────────────────────────────────

export const FileBrowser: React.FC<FileBrowserProps> = ({
  rootPath,
  initialPath,
  listDirectory,
  onFileSelect,
  onFileLongPress,
  maxHeight,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [currentPath, setCurrentPath] = useState(initialPath || rootPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const breadcrumbs = useMemo((): BreadcrumbSegment[] => {
    const root = rootPath.replace(/\/+$/, '');
    const current = currentPath.replace(/\/+$/, '');
    const segments: BreadcrumbSegment[] = [{ label: '~', path: root }];

    if (current !== root && current.startsWith(root)) {
      const relative = current.slice(root.length + 1);
      const parts = relative.split('/').filter(Boolean);
      let accumulated = root;
      for (const part of parts) {
        accumulated = `${accumulated}/${part}`;
        segments.push({ label: part, path: accumulated });
      }
    }

    return segments;
  }, [rootPath, currentPath]);

  const loadDirectory = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listDirectory(path);
        // Sort: directories first, then alphabetically
        const sorted = [...result].sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to list directory');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [listDirectory],
  );

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const handleNavigate = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        const newPath = currentPath.replace(/\/+$/, '') + '/' + entry.name;
        setCurrentPath(newPath);
      } else {
        onFileSelect?.(currentPath.replace(/\/+$/, '') + '/' + entry.name, entry);
      }
    },
    [currentPath, onFileSelect],
  );

  const handleLongPress = useCallback(
    (entry: FileEntry) => {
      const fullPath = currentPath.replace(/\/+$/, '') + '/' + entry.name;
      onFileLongPress?.(fullPath, entry);
    },
    [currentPath, onFileLongPress],
  );

  const handleGoUp = useCallback(() => {
    const parent = currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
    if (parent.length >= rootPath.length) {
      setCurrentPath(parent);
    }
  }, [currentPath, rootPath]);

  const formatSize = (bytes?: number): string => {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const renderEntry = useCallback(
    ({ item }: { item: FileEntry }) => (
      <TouchableOpacity
        style={styles.entryRow}
        onPress={() => handleNavigate(item)}
        onLongPress={() => handleLongPress(item)}
      >
        <View style={styles.entryIcon}>
          {item.isDirectory ? (
            <Folder size={18} color={colors.primary} />
          ) : (
            <FileIcon size={18} color={colors.textSecondary} />
          )}
        </View>
        <View style={styles.entryInfo}>
          <Text
            style={[styles.entryName, item.isDirectory && styles.entryNameDir]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {!item.isDirectory && item.size != null && (
            <Text style={styles.entryMeta}>{formatSize(item.size)}</Text>
          )}
        </View>
        {item.isDirectory && <ChevronRight size={16} color={colors.textTertiary} />}
      </TouchableOpacity>
    ),
    [colors, handleNavigate, handleLongPress, styles],
  );

  const canGoUp = currentPath.replace(/\/+$/, '') !== rootPath.replace(/\/+$/, '');

  return (
    <View style={[styles.container, maxHeight ? { maxHeight } : undefined]}>
      {/* Breadcrumb bar */}
      <View style={styles.breadcrumbBar}>
        <TouchableOpacity style={styles.navBtn} onPress={handleGoUp} disabled={!canGoUp}>
          <ArrowLeft size={16} color={canGoUp ? colors.primary : colors.textTertiary} />
        </TouchableOpacity>
        <FlatList
          horizontal
          data={breadcrumbs}
          keyExtractor={(item) => item.path}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.breadcrumbs}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              onPress={() => setCurrentPath(item.path)}
              style={styles.breadcrumbItem}
            >
              {index === 0 && <Home size={12} color={colors.primary} />}
              {index > 0 && <Text style={styles.breadcrumbSep}>/</Text>}
              <Text
                style={[
                  styles.breadcrumbText,
                  index === breadcrumbs.length - 1 && styles.breadcrumbActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
        <TouchableOpacity style={styles.navBtn} onPress={() => loadDirectory(currentPath)}>
          <RefreshCw size={14} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => loadDirectory(currentPath)}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.centerState}>
          <FolderOpen size={24} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{t('common.emptyDirectory')}</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.name}
          renderItem={renderEntry}
          initialNumToRender={30}
          windowSize={5}
        />
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    breadcrumbBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    navBtn: {
      padding: 6,
    },
    breadcrumbs: {
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 4,
    },
    breadcrumbItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    breadcrumbSep: {
      fontSize: 11,
      color: colors.textTertiary,
      marginHorizontal: 1,
    },
    breadcrumbText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    breadcrumbActive: {
      color: colors.text,
      fontWeight: '600',
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 10,
    },
    entryIcon: {
      width: 24,
      alignItems: 'center',
    },
    entryInfo: {
      flex: 1,
    },
    entryName: {
      fontSize: 14,
      color: colors.text,
    },
    entryNameDir: {
      fontWeight: '500',
    },
    entryMeta: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 1,
    },
    centerState: {
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 8,
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
      textAlign: 'center',
    },
    retryText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '500',
    },
    emptyText: {
      fontSize: 13,
      color: colors.textTertiary,
    },
  });
