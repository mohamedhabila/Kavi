import { X } from 'lucide-react-native';
import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppPalette } from '../../theme/useAppTheme';
import type { RemoteSessionRecord } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkBrowserSessionModalProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  activeBrowserSession: RemoteSessionRecord | null;
  setActiveBrowserSession: (session: RemoteSessionRecord | null) => void;
  WebViewComponent: any;
};

export const RemoteWorkBrowserSessionModal: React.FC<RemoteWorkBrowserSessionModalProps> = ({
  colors,
  styles,
  t,
  activeBrowserSession,
  setActiveBrowserSession,
  WebViewComponent,
}) => {
  return (
    <Modal
      visible={Boolean(activeBrowserSession)}
      animationType="slide"
      onRequestClose={() => setActiveBrowserSession(null)}
    >
      <SafeAreaView style={styles.sessionContainer} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.sessionTitleWrap}>
            <Text style={styles.headerTitle}>
              {activeBrowserSession?.summary || t('remoteWork.openLiveView')}
            </Text>
            <Text style={styles.sessionSubtitle}>{activeBrowserSession?.liveViewUrl || ''}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setActiveBrowserSession(null)}
            accessibilityRole="button"
            accessibilityLabel={t('remoteWork.closeSession')}
          >
            <X size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        {activeBrowserSession?.liveViewUrl ? (
          WebViewComponent ? (
            <WebViewComponent
              testID="remote-browser-webview"
              source={{ uri: activeBrowserSession.liveViewUrl }}
              style={styles.webview}
              startInLoadingState
            />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t('remoteWork.webviewUnavailableTitle')}</Text>
              <Text style={styles.emptyText}>{t('remoteWork.webviewUnavailableHint')}</Text>
            </View>
          )
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noLiveViewTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noLiveViewHint')}</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};
