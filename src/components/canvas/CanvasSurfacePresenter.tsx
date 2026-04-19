import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { captureRef } from 'react-native-view-shot';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import {
  closeCanvasSurface,
  getActiveSurfaces,
  getSurface,
  openCanvasSurface,
  renderSurfaceToHtml,
  resolveCanvasEval,
  resolveCanvasRead,
  resolveCanvasSnapshot,
  setCanvasEventHandler,
  subscribeToCanvasFocus,
  subscribeToCanvasSurfaces,
} from '../../services/canvas/renderer';
import { hasCanvasSourceBundle } from '../../services/canvas/bundles';
import { emitCanvasEvent } from '../../services/events/bus';
import type { CanvasSurface } from '../../types';
import type { CanvasReadRequestOptions } from '../../services/canvas/types';
import { buildJavaScriptCandidates } from '../../utils/javascript';

export const CanvasSurfacePresenter: React.FC = () => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [focusedSurfaceId, setFocusedSurfaceId] = useState<string | null>(null);
  const [isSourceExpanded, setIsSourceExpanded] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const webViewWrapperRef = useRef<View>(null);
  const loadedSurfaceIdRef = useRef<string | null>(null);
  const pendingEvalScriptRef = useRef<{ surfaceId: string; script: string } | null>(null);
  const pendingReadRef = useRef<{
    surfaceId: string;
    options: Required<CanvasReadRequestOptions>;
  } | null>(null);
  const pendingSnapshotRef = useRef<{
    surfaceId: string;
    format: 'png' | 'jpeg';
    quality?: number;
  } | null>(null);
  const errorPrefix = t('common.error');
  const noReturnValue = t('canvas.noReturnValue');

  const focusedSurface: CanvasSurface | null = focusedSurfaceId
    ? getSurface(focusedSurfaceId) || null
    : null;

  const focusedSurfaceHtml =
    !focusedSurface || focusedSurface.renderMode === 'url' || !isSourceExpanded
      ? null
      : renderSurfaceToHtml(focusedSurface.id);

  const injectEvalScript = useCallback(
    (surfaceId: string, script: string): boolean => {
      const webView = webViewRef.current;
      if (!webView) {
        return false;
      }

      const safeSurfaceId = JSON.stringify(surfaceId);
      const candidates = JSON.stringify(buildJavaScriptCandidates(script));
      const wrapped = `
      (function() {
        if (!document.body) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'evalResult', surfaceId: ${safeSurfaceId},
            result: ${JSON.stringify(`${errorPrefix}: `)} + 'Document not ready'
          }));
          return;
        }
        var __candidates = ${candidates};
        var __result;
        var __error = null;
        for (var __i = 0; __i < __candidates.length; __i += 1) {
          try {
            __result = Function(__candidates[__i])();
            __error = null;
            break;
          } catch (e) {
            __error = e;
          }
        }
        if (__error) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'evalResult', surfaceId: ${safeSurfaceId},
            result: ${JSON.stringify(`${errorPrefix}: `)} + __error.message
          }));
          return;
        }
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'evalResult', surfaceId: ${safeSurfaceId},
          result: String(__result !== undefined ? __result : ${JSON.stringify(noReturnValue)})
        }));
      })(); true;`;

      webView.injectJavaScript(wrapped);
      return true;
    },
    [errorPrefix, noReturnValue],
  );

  const injectReadRequest = useCallback(
    (surfaceId: string, options: Required<CanvasReadRequestOptions>): boolean => {
      const webView = webViewRef.current;
      if (!webView || loadedSurfaceIdRef.current !== surfaceId) {
        return false;
      }

      const safeSurfaceId = JSON.stringify(surfaceId);
      const maxChars = Math.max(1000, Math.floor(options.maxChars));
      const readScript = `
      (function() {
        try {
          var docEl = document.documentElement;
          var html = docEl ? docEl.outerHTML : '';
          var truncated = html.length > ${maxChars};
          var content = truncated ? html.slice(0, ${maxChars}) : html;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'readResult',
            surfaceId: ${safeSurfaceId},
            content: content,
            truncated: truncated,
            contentLength: html.length,
            url: String(location && location.href ? location.href : ''),
            title: String(document.title || '')
          }));
        } catch(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'readResult',
            surfaceId: ${safeSurfaceId},
            error: ${JSON.stringify(`${errorPrefix}: `)} + e.message
          }));
        }
      })(); true;`;

      webView.injectJavaScript(readScript);
      return true;
    },
    [errorPrefix],
  );

  const captureSurfaceSnapshot = useCallback(
    async (surfaceId: string, format: 'png' | 'jpeg', quality?: number): Promise<boolean> => {
      if (!webViewWrapperRef.current || loadedSurfaceIdRef.current !== surfaceId) {
        return false;
      }

      try {
        const clampedQuality =
          typeof quality === 'number' && Number.isFinite(quality)
            ? Math.min(1, Math.max(0, quality))
            : 0.8;
        const base64 = await captureRef(webViewWrapperRef, {
          format: format === 'jpeg' ? 'jpg' : 'png',
          quality: format === 'jpeg' ? clampedQuality : 1,
          result: 'base64',
        });
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        resolveCanvasSnapshot(surfaceId, { dataUri: `data:${mimeType};base64,${base64}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolveCanvasSnapshot(surfaceId, { error: `${errorPrefix}: ${message}` });
      }

      return true;
    },
    [errorPrefix],
  );

  const flushPendingCanvasWork = useCallback(
    (surfaceId: string) => {
      const pendingEval = pendingEvalScriptRef.current;
      if (pendingEval?.surfaceId === surfaceId && injectEvalScript(surfaceId, pendingEval.script)) {
        pendingEvalScriptRef.current = null;
      }

      const pendingRead = pendingReadRef.current;
      if (
        pendingRead?.surfaceId === surfaceId &&
        injectReadRequest(surfaceId, pendingRead.options)
      ) {
        pendingReadRef.current = null;
      }

      const pendingSnapshot = pendingSnapshotRef.current;
      if (pendingSnapshot?.surfaceId === surfaceId) {
        void captureSurfaceSnapshot(
          surfaceId,
          pendingSnapshot.format,
          pendingSnapshot.quality,
        ).then((captured) => {
          if (captured) {
            pendingSnapshotRef.current = null;
          }
        });
      }
    },
    [captureSurfaceSnapshot, injectEvalScript, injectReadRequest],
  );

  useEffect(() => {
    const unsubscribeFocus = subscribeToCanvasFocus((surfaceId) => {
      setFocusedSurfaceId(surfaceId);
      setIsSourceExpanded(false);
    });

    const unsubscribeSurfaces = subscribeToCanvasSurfaces(() => {
      setRefreshKey((current) => current + 1);
    });

    return () => {
      unsubscribeFocus();
      unsubscribeSurfaces();
    };
  }, []);

  useEffect(() => {
    setCanvasEventHandler({
      onEval: (surfaceId, script) => {
        if (!injectEvalScript(surfaceId, script)) {
          pendingEvalScriptRef.current = { surfaceId, script };
          openCanvasSurface(surfaceId);
        }
      },
      onRead: (surfaceId, options) => {
        const normalizedOptions: Required<CanvasReadRequestOptions> = {
          mode: options.mode === 'dom' || options.mode === 'source' ? options.mode : 'auto',
          maxChars:
            typeof options.maxChars === 'number' && Number.isFinite(options.maxChars)
              ? Math.max(1000, Math.floor(options.maxChars))
              : 20_000,
        };

        if (!injectReadRequest(surfaceId, normalizedOptions)) {
          pendingReadRef.current = { surfaceId, options: normalizedOptions };
          openCanvasSurface(surfaceId);
        }
      },
      onSnapshot: (surfaceId, format, quality) => {
        void captureSurfaceSnapshot(surfaceId, format, quality).then((captured) => {
          if (!captured) {
            pendingSnapshotRef.current = { surfaceId, format, quality };
            openCanvasSurface(surfaceId);
          }
        });
      },
      onNavigate: (surfaceId) => {
        openCanvasSurface(surfaceId);
      },
    });

    return () => setCanvasEventHandler({});
  }, [captureSurfaceSnapshot, injectEvalScript, injectReadRequest]);

  useEffect(() => {
    loadedSurfaceIdRef.current = null;

    if (!focusedSurfaceId) {
      pendingEvalScriptRef.current = null;
      pendingReadRef.current = null;
      pendingSnapshotRef.current = null;
      return;
    }

    const timer = setTimeout(() => flushPendingCanvasWork(focusedSurfaceId), 0);
    return () => clearTimeout(timer);
  }, [flushPendingCanvasWork, focusedSurfaceId, refreshKey]);

  useEffect(() => {
    if (!focusedSurfaceId) {
      return;
    }

    const activeSurfaceIds = new Set(getActiveSurfaces().map((surface) => surface.id));
    if (!activeSurfaceIds.has(focusedSurfaceId)) {
      closeCanvasSurface();
    }
  }, [focusedSurfaceId, refreshKey]);

  const handleWebViewMessage = useCallback((surfaceId: string, event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'action' || data.type === 'userAction') {
        emitCanvasEvent('user_action', {
          surfaceId,
          componentId: data.componentId,
          actionType: data.action,
        });
      } else if (data.type === 'evalResult') {
        resolveCanvasEval(data.surfaceId, data.result);
      } else if (data.type === 'readResult') {
        resolveCanvasRead(data.surfaceId, {
          content: typeof data.content === 'string' ? data.content : '',
          contentType: 'live_dom',
          title: typeof data.title === 'string' ? data.title : undefined,
          url: typeof data.url === 'string' ? data.url : undefined,
          truncated: data.truncated === true,
          contentLength: typeof data.contentLength === 'number' ? data.contentLength : undefined,
          error: typeof data.error === 'string' ? data.error : undefined,
        });
      }
    } catch {
      // Ignore non-JSON messages.
    }
  }, []);

  const handleClose = useCallback(() => {
    setIsSourceExpanded(false);
    closeCanvasSurface();
  }, []);

  const source = (() => {
    if (!focusedSurface) {
      return null;
    }

    if (focusedSurface.renderMode === 'url' && focusedSurface.url) {
      return { uri: focusedSurface.url };
    }

    if (
      focusedSurface.renderMode === 'html' &&
      hasCanvasSourceBundle(focusedSurface.sourceBundle)
    ) {
      return { uri: focusedSurface.sourceBundle!.bundleEntryUri! };
    }

    const html = renderSurfaceToHtml(focusedSurface.id);
    return html ? { html } : null;
  })();

  return (
    <Modal
      visible={!!focusedSurface && !!source}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.modalContainer} edges={['top']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {focusedSurface?.title || focusedSurface?.id || t('canvas.title')}
          </Text>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Text style={styles.closeLink}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
        {focusedSurface?.renderMode !== 'url' ? (
          <View style={styles.sourcePanel}>
            <TouchableOpacity
              style={styles.sourceToggle}
              onPress={() => setIsSourceExpanded((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={
                isSourceExpanded ? t('canvas.hideSource') : t('canvas.showSource')
              }
            >
              <Text style={styles.sourceToggleLabel}>{t('canvas.sourceLabel')}</Text>
              <Text style={styles.sourceToggleText}>
                {isSourceExpanded ? t('canvas.hideSource') : t('canvas.showSource')}
              </Text>
            </TouchableOpacity>
            {isSourceExpanded && focusedSurfaceHtml ? (
              <ScrollView
                style={styles.sourceScroll}
                contentContainerStyle={styles.sourceScrollContent}
              >
                <Text style={styles.sourceCode} selectable>
                  {focusedSurfaceHtml}
                </Text>
              </ScrollView>
            ) : null}
          </View>
        ) : null}
        <View style={styles.modalBody}>
          {focusedSurface && source ? (
            <View ref={webViewWrapperRef} style={styles.webviewWrapper} collapsable={false}>
              <WebView
                ref={webViewRef}
                testID="global-canvas-webview"
                originWhitelist={['*']}
                source={source}
                style={styles.webview}
                javaScriptEnabled={true}
                domStorageEnabled
                setSupportMultipleWindows={false}
                allowFileAccess
                allowFileAccessFromFileURLs={true}
                allowUniversalAccessFromFileURLs={true}
                allowingReadAccessToURL={focusedSurface?.sourceBundle?.bundleRootUri || 'file:///'}
                onLoadEnd={() => {
                  loadedSurfaceIdRef.current = focusedSurface.id;
                  flushPendingCanvasWork(focusedSurface.id);
                }}
                onMessage={(event) => handleWebViewMessage(focusedSurface.id, event)}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    modalTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
      marginRight: 16,
    },
    closeLink: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '600',
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
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    sourceToggleLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    sourceToggleText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    sourceScroll: {
      maxHeight: 220,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sourceScrollContent: {
      padding: 16,
    },
    sourceCode: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: 'Courier',
    },
    modalBody: {
      flex: 1,
      padding: 12,
    },
    webviewWrapper: {
      flex: 1,
      overflow: 'hidden',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.panel,
    },
    webview: {
      flex: 1,
      backgroundColor: 'transparent',
    },
  });
