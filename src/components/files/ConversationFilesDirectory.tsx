import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowDownAZ,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  File as FileIcon,
  Folder,
  RefreshCw,
  Search,
  Share2,
  X,
} from 'lucide-react-native';
import { useTranslation } from '../../i18n/useTranslation';
import type { ConversationWorkspaceDirectoryEntry } from '../../services/conversationWorkspace/files';
import type { AppPalette } from '../../theme/useAppTheme';
import { ConversationFilesStatusView } from './ConversationFilesStatusView';
import type { ConversationFilesStyles } from './ConversationFiles.styles';
import {
  formatConversationFileModifiedAt,
  formatConversationFileSize,
  getSafeConversationFileName,
  getVisibleConversationFileEntries,
  type ConversationFileFilter,
  type ConversationFileSort,
} from './conversationFilesPresentation';
import { getConversationFileTypeLabel } from './filePresentation';

type DirectoryStatus = 'loading' | 'ready' | 'error';

interface ConversationFilesDirectoryProps {
  colors: AppPalette;
  currentPath: string;
  directoryError: string | null;
  directoryStatus: DirectoryStatus;
  entries: ConversationWorkspaceDirectoryEntry[];
  fileFilter: ConversationFileFilter;
  fileSort: ConversationFileSort;
  isRefreshing: boolean;
  initialScrollOffset: number;
  onClose: () => void;
  onFileFilterChange: (filter: ConversationFileFilter) => void;
  onFileSortChange: (sort: ConversationFileSort) => void;
  onNavigateInto: (name: string) => void;
  onNavigateUp: () => void;
  onOpenFile: (name: string) => void;
  onRefresh: () => void;
  onSearchQueryChange: (query: string) => void;
  onScrollOffsetChange: (offset: number) => void;
  onShareFile: (filePath: string, displayName: string) => void;
  presentation: 'modal' | 'screen';
  searchQuery: string;
  styles: ConversationFilesStyles;
  workspaceLabel?: string;
}

const FILTERS: ConversationFileFilter[] = ['all', 'documents', 'images', 'audio', 'code', 'other'];

type Translate = (key: string, params?: Record<string, string | number>) => string;

function getFilterLabel(filter: ConversationFileFilter, t: Translate): string {
  switch (filter) {
    case 'documents':
      return t('conversationFiles.filterDocuments');
    case 'images':
      return t('conversationFiles.filterImages');
    case 'audio':
      return t('conversationFiles.filterAudio');
    case 'code':
      return t('conversationFiles.filterCode');
    case 'other':
      return t('conversationFiles.filterOther');
    default:
      return t('conversationFiles.filterAll');
  }
}

export const ConversationFilesDirectory: React.FC<ConversationFilesDirectoryProps> = ({
  colors,
  currentPath,
  directoryError,
  directoryStatus,
  entries,
  fileFilter,
  fileSort,
  isRefreshing,
  initialScrollOffset,
  onClose,
  onFileFilterChange,
  onFileSortChange,
  onNavigateInto,
  onNavigateUp,
  onOpenFile,
  onRefresh,
  onSearchQueryChange,
  onScrollOffsetChange,
  onShareFile,
  presentation,
  searchQuery,
  styles,
  workspaceLabel,
}) => {
  const { locale, t } = useTranslation();
  const listRef = useRef<FlatList<ConversationWorkspaceDirectoryEntry>>(null);
  const pendingScrollRestorationRef = useRef(true);
  const visibleEntries = useMemo(
    () => getVisibleConversationFileEntries(entries, searchQuery, fileFilter, fileSort),
    [entries, fileFilter, fileSort, searchQuery],
  );
  const hasActiveRefinement = searchQuery.trim().length > 0 || fileFilter !== 'all';
  const sortLabel =
    fileSort === 'recent' ? t('conversationFiles.sortNewest') : t('conversationFiles.sortName');
  const refreshDisabled = isRefreshing || directoryStatus === 'loading';
  const leadingLabel = currentPath
    ? t('common.back')
    : presentation === 'screen'
      ? t('common.back')
      : t('common.close');

  useEffect(() => {
    pendingScrollRestorationRef.current = true;
  }, [currentPath, initialScrollOffset]);

  const restoreScrollOffset = useCallback(() => {
    if (directoryStatus !== 'ready' || !pendingScrollRestorationRef.current) {
      return;
    }

    pendingScrollRestorationRef.current = false;
    if (initialScrollOffset <= 0) {
      return;
    }

    listRef.current?.scrollToOffset({ animated: false, offset: initialScrollOffset });
  }, [directoryStatus, initialScrollOffset]);

  useEffect(() => {
    restoreScrollOffset();
  }, [restoreScrollOffset, visibleEntries.length]);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={leadingLabel}
          accessibilityRole="button"
          onPress={currentPath ? onNavigateUp : onClose}
          style={styles.headerIconButton}
          testID={currentPath ? 'conversation-files-up' : 'conversation-files-close'}
        >
          {currentPath || presentation === 'screen' ? (
            <ChevronLeft size={24} color={colors.text} />
          ) : (
            <X size={24} color={colors.text} />
          )}
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('conversationFiles.title')}
          </Text>
          {currentPath ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              /{getSafeConversationFileName(currentPath, '')}
            </Text>
          ) : workspaceLabel ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {t('conversationFiles.sharedFromConversation', {
                title: getSafeConversationFileName(
                  workspaceLabel,
                  t('conversationFiles.untitledItem'),
                ),
              })}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          accessibilityHint={t('conversationFiles.refreshHint')}
          accessibilityLabel={t('conversationFiles.refresh')}
          accessibilityRole="button"
          accessibilityState={{ busy: isRefreshing, disabled: refreshDisabled }}
          disabled={refreshDisabled}
          onPress={onRefresh}
          style={[
            styles.headerIconButton,
            refreshDisabled ? styles.headerIconButtonDisabled : null,
          ]}
          testID="conversation-files-refresh"
        >
          {isRefreshing ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <RefreshCw size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <View style={styles.searchBox}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput
            accessibilityLabel={t('conversationFiles.searchLabel')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onSearchQueryChange}
            placeholder={t('conversationFiles.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            returnKeyType="search"
            style={styles.searchInput}
            testID="conversation-files-search"
            value={searchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity
              accessibilityLabel={t('conversationFiles.clearSearch')}
              accessibilityRole="button"
              onPress={() => onSearchQueryChange('')}
              style={styles.searchClearButton}
              testID="conversation-files-clear-search"
            >
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.filterToolbar}>
          <ScrollView
            accessibilityLabel={t('conversationFiles.filtersLabel')}
            contentContainerStyle={styles.filterContent}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
          >
            {FILTERS.map((filter) => {
              const selected = filter === fileFilter;
              const label = getFilterLabel(filter, t);
              return (
                <TouchableOpacity
                  accessibilityLabel={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={filter}
                  onPress={() => onFileFilterChange(filter)}
                  style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
                  testID={`conversation-files-filter-${filter}`}
                >
                  <Text
                    style={[styles.filterChipText, selected ? styles.filterChipTextSelected : null]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            accessibilityHint={t('conversationFiles.sortHint')}
            accessibilityLabel={t('conversationFiles.sortLabel', { sort: sortLabel })}
            accessibilityRole="button"
            onPress={() => onFileSortChange(fileSort === 'recent' ? 'name' : 'recent')}
            style={styles.sortButton}
            testID="conversation-files-sort"
          >
            {fileSort === 'recent' ? (
              <CalendarClock size={16} color={colors.textSecondary} />
            ) : (
              <ArrowDownAZ size={16} color={colors.textSecondary} />
            )}
            <Text style={styles.sortButtonText}>{sortLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        testID="conversation-files-list"
        contentContainerStyle={styles.listContent}
        contentOffset={{ x: 0, y: initialScrollOffset }}
        data={directoryStatus === 'ready' ? visibleEntries : []}
        initialNumToRender={20}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.name}
        maxToRenderPerBatch={16}
        onContentSizeChange={restoreScrollOffset}
        onScroll={(event) => {
          const offset = event.nativeEvent.contentOffset.y;
          onScrollOffsetChange(Number.isFinite(offset) && offset > 0 ? offset : 0);
        }}
        refreshControl={
          <RefreshControl
            colors={[colors.primary]}
            onRefresh={onRefresh}
            refreshing={isRefreshing}
            tintColor={colors.primary}
          />
        }
        removeClippedSubviews={Platform.OS === 'android'}
        scrollEventThrottle={16}
        renderItem={({ item }) => {
          const filePath = currentPath ? `${currentPath}/${item.name}` : item.name;
          const displayName = getSafeConversationFileName(
            item.name,
            t('conversationFiles.untitledItem'),
          );
          const metadata = item.isDirectory
            ? null
            : [
                getConversationFileTypeLabel(displayName),
                formatConversationFileModifiedAt(item.modifiedAt, locale),
                formatConversationFileSize(item.size),
              ]
                .filter(Boolean)
                .join(' • ');
          return (
            <View style={styles.fileRow}>
              <TouchableOpacity
                accessibilityLabel={
                  item.isDirectory
                    ? t('conversationFiles.openFolderLabel', { name: displayName })
                    : t('conversationFiles.openFileLabel', { name: displayName })
                }
                accessibilityRole="button"
                onPress={() =>
                  item.isDirectory ? onNavigateInto(item.name) : onOpenFile(item.name)
                }
                style={styles.fileRowMain}
              >
                {item.isDirectory ? (
                  <Folder size={20} color={colors.primary} />
                ) : (
                  <FileIcon size={20} color={colors.textSecondary} />
                )}
                <View style={styles.fileTextWrap}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {metadata ? (
                    <Text style={styles.fileMeta} numberOfLines={1}>
                      {metadata}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
              {item.isDirectory ? (
                <ChevronRight size={18} color={colors.textTertiary} />
              ) : (
                <TouchableOpacity
                  accessibilityLabel={t('conversationFiles.shareFileLabel', {
                    name: displayName,
                  })}
                  accessibilityRole="button"
                  onPress={() => onShareFile(filePath, displayName)}
                  style={styles.fileRowAction}
                  testID={`conversation-file-share-${displayName}`}
                >
                  <Share2 size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        ListEmptyComponent={
          directoryStatus === 'loading' ? (
            <ConversationFilesStatusView
              colors={colors}
              status="loading"
              testID="conversation-files-loading"
              title={t('conversationFiles.loadingTitle')}
            />
          ) : directoryStatus === 'error' ? (
            <ConversationFilesStatusView
              colors={colors}
              detail={
                directoryError
                  ? t('conversationFiles.technicalDetails', { detail: directoryError })
                  : undefined
              }
              hint={t('conversationFiles.loadErrorHint')}
              onRetry={onRefresh}
              retryLabel={t('common.retry')}
              status="error"
              testID="conversation-files-error"
              title={t('conversationFiles.loadErrorTitle')}
            />
          ) : hasActiveRefinement && entries.length > 0 ? (
            <ConversationFilesStatusView
              colors={colors}
              hint={t('conversationFiles.noMatchesHint')}
              status="empty"
              testID="conversation-files-no-matches"
              title={t('conversationFiles.noMatchesTitle')}
            />
          ) : (
            <ConversationFilesStatusView
              colors={colors}
              hint={t('conversationFiles.emptyHint')}
              status="empty"
              testID="conversation-files-empty"
              title={t('conversationFiles.emptyTitle')}
            />
          )
        }
      />
    </View>
  );
};
