import { X } from 'lucide-react-native';
import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppPalette } from '../../theme/useAppTheme';
import type { WorkspaceTargetConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type WorkspaceSession = {
  target: WorkspaceTargetConfig;
  source: { uri: string; headers?: Record<string, string> };
};

type RemoteWorkWorkspaceSessionModalProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  activeWorkspaceSession: WorkspaceSession | null;
  setActiveWorkspaceSession: React.Dispatch<React.SetStateAction<WorkspaceSession | null>>;
  workspaceSessionError: string | null;
  setWorkspaceSessionError: React.Dispatch<React.SetStateAction<string | null>>;
  getWorkspaceTargetDisplayName: (target: WorkspaceTargetConfig) => string;
  WebViewComponent: any;
};

export const RemoteWorkWorkspaceSessionModal: React.FC<RemoteWorkWorkspaceSessionModalProps> = ({
  colors,
  styles,
  t,
  activeWorkspaceSession,
  setActiveWorkspaceSession,
  workspaceSessionError,
  setWorkspaceSessionError,
  getWorkspaceTargetDisplayName,
  WebViewComponent,
}) => {
  return (
    <Modal
      visible={Boolean(activeWorkspaceSession)}
      animationType="slide"
      onRequestClose={() => setActiveWorkspaceSession(null)}
    >
      <SafeAreaView style={styles.sessionContainer} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.sessionTitleWrap}>
            <Text style={styles.headerTitle}>
              {activeWorkspaceSession
                ? getWorkspaceTargetDisplayName(activeWorkspaceSession.target)
                : t('remoteWork.title')}
            </Text>
            <Text style={styles.sessionSubtitle}>
              {activeWorkspaceSession?.target.rootPath || ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setActiveWorkspaceSession(null)}
            accessibilityRole="button"
            accessibilityLabel={t('remoteWork.closeSession')}
          >
            <X size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        {workspaceSessionError ? (
          <Text style={styles.sessionError}>{workspaceSessionError}</Text>
        ) : null}
        {activeWorkspaceSession ? (
          WebViewComponent ? (
            <WebViewComponent
              testID="remote-workspace-webview"
              source={activeWorkspaceSession.source}
              style={styles.webview}
              onError={(event: any) =>
                setWorkspaceSessionError(
                  event.nativeEvent?.description || t('remoteWork.launchFailed'),
                )
              }
              startInLoadingState
            />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t('remoteWork.webviewUnavailableTitle')}</Text>
              <Text style={styles.emptyText}>{t('remoteWork.webviewUnavailableHint')}</Text>
            </View>
          )
        ) : null}
      </SafeAreaView>
    </Modal>
  );
};
