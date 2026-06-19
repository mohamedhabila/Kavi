// ---------------------------------------------------------------------------
// Kavi — Canvas (A2UI) Screen
// ---------------------------------------------------------------------------
// Renders active canvas surfaces in a WebView. Each surface is its own
// interactive component rendered as HTML via the canvas renderer.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Layers, MessageSquare, Trash2, RefreshCw } from 'lucide-react-native';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import {
  getActiveSurfaces,
  deleteSurface,
  openCanvasSurface,
  subscribeToCanvasSurfaces,
} from '../services/canvas/renderer';
import type { CanvasSurface } from '../types/canvas';
import { useBackToChat } from '../navigation/useBackToChat';

function formatSurfaceDestination(url: string, maxLength = 56): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    const suffix = `${parsed.pathname || ''}${parsed.search || ''}${parsed.hash || ''}`;
    const normalized = suffix && suffix !== '/' ? `${host}${suffix}` : host;
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const keep = Math.max(12, maxLength - host.length - 3);
    const shortenedSuffix = suffix.slice(0, keep).replace(/\/$/, '');
    return `${host}${shortenedSuffix}...`;
  } catch {
    return url.length <= maxLength ? url : `${url.slice(0, maxLength - 3)}...`;
  }
}

export const CanvasScreen: React.FC = () => {
  const navigation = useNavigation();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [, setRefreshKey] = useState(0);

  const surfaces = getActiveSurfaces();

  useEffect(() => {
    const unsubscribe = subscribeToCanvasSurfaces(() => {
      setRefreshKey((current) => current + 1);
    });

    return unsubscribe;
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      deleteSurface(id);
      handleRefresh();
    },
    [handleRefresh],
  );

  const renderSurface = ({ item: surface }: { item: CanvasSurface }) => {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Layers size={16} color={colors.primary} />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {surface.title || t('canvas.surfaceTitle', { id: surface.id })}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDelete(surface.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('canvas.deleteSurface', { title: surface.title || surface.id })}
          >
            <Trash2 size={16} color={colors.danger} />
          </TouchableOpacity>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardDescription}>
            {surface.renderMode === 'url' && surface.url
              ? t('canvas.listDescriptionUrl')
              : t('canvas.listDescriptionPreview')}
          </Text>
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.surfaceModeText} numberOfLines={1} ellipsizeMode="middle">
            {surface.renderMode === 'url' && surface.url
              ? formatSurfaceDestination(surface.url)
              : t('canvas.readyToOpen')}
          </Text>
          <TouchableOpacity
            onPress={() => {
              openCanvasSurface(surface.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('canvas.openSurface', { title: surface.title || surface.id })}
          >
            <Text style={styles.openLink}>{t('common.open')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('canvas.title')}</Text>
        <TouchableOpacity
          onPress={handleRefresh}
          accessibilityRole="button"
          accessibilityLabel={t('common.refresh')}
        >
          <RefreshCw size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={surfaces}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        renderItem={renderSurface}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Layers size={40} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{t('canvas.noSurface')}</Text>
            <Text style={styles.emptyText}>{t('canvas.noSurfaceHint')}</Text>
            <TouchableOpacity
              style={styles.chatBtn}
              onPress={() => (navigation as any).navigate('Chat')}
              accessibilityRole="button"
              accessibilityLabel={t('canvas.startChat')}
            >
              <MessageSquare size={16} color="#fff" />
              <Text style={styles.chatBtnText}>{t('canvas.startChat')}</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    list: {
      padding: 16,
      flexGrow: 1,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    cardBody: {
      paddingHorizontal: 12,
      paddingVertical: 14,
      backgroundColor: colors.surface,
    },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    cardDescription: {
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    webviewWrapper: {
      flex: 1,
      minHeight: 320,
    },
    webview: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    surfaceModeText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
      marginRight: 12,
    },
    openLink: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    modalTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      marginRight: 12,
    },
    closeLink: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    modalBody: {
      flex: 1,
    },
    sourcePanel: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    sourceToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    sourceToggleLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      textTransform: 'uppercase',
    },
    sourceToggleText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    sourceScroll: {
      maxHeight: 220,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    sourceScrollContent: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    sourceCode: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
      fontFamily: 'monospace',
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      marginTop: 60,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginTop: 16,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    chatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 20,
    },
    chatBtnText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
  });
