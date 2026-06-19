import { X } from 'lucide-react-native';
import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InteractiveTerminalSurface } from '../../components/terminal/InteractiveTerminalSurface';
import type { TerminalWebViewRef } from '../../components/terminal/TerminalWebView';
import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type ActiveSshSession = {
  id: string;
  targetName?: string;
  targetLabel?: string;
  status: string;
  error?: string;
} | null;

type RemoteWorkSshSessionModalProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  activeSshSession: ActiveSshSession;
  closeShellSession: (sessionId: string) => void | Promise<void>;
  handleCloseSshModal: () => void;
  sshTerminalRef: React.RefObject<TerminalWebViewRef | null>;
  handleSshTerminalInput: (data: string) => void | Promise<void>;
  handleSshTerminalReady: () => void;
  handleTerminalLink: (uri: string) => void;
};

export const RemoteWorkSshSessionModal: React.FC<RemoteWorkSshSessionModalProps> = ({
  colors,
  styles,
  t,
  activeSshSession,
  closeShellSession,
  handleCloseSshModal,
  sshTerminalRef,
  handleSshTerminalInput,
  handleSshTerminalReady,
  handleTerminalLink,
}) => {
  return (
    <Modal
      visible={Boolean(activeSshSession)}
      animationType="slide"
      onRequestClose={handleCloseSshModal}
    >
      <SafeAreaView style={styles.sessionContainer} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.sessionTitleWrap}>
            <Text style={styles.headerTitle}>
              {activeSshSession?.targetName || t('remoteWork.openShell')}
            </Text>
            <Text style={styles.sessionSubtitle}>{activeSshSession?.targetLabel || ''}</Text>
          </View>
          <View style={styles.modalActions}>
            {activeSshSession ? (
              <TouchableOpacity
                onPress={() => {
                  void closeShellSession(activeSshSession.id);
                  handleCloseSshModal();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.disconnectShell')}
              >
                <Text style={styles.disconnectText}>{t('remoteWork.disconnectShell')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={handleCloseSshModal}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.closeSession')}
            >
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.shellBody}>
          <Text style={styles.shellStatus}>
            {activeSshSession?.status === 'error'
              ? activeSshSession.error || t('remoteWork.sshLaunchFailed')
              : activeSshSession?.status === 'closed'
                ? t('remoteWork.shellClosed')
                : t('remoteWork.shellConnected')}
          </Text>

          <View style={styles.shellTerminal}>
            <InteractiveTerminalSurface
              ref={sshTerminalRef}
              colors={colors}
              fontSize={14}
              onInput={handleSshTerminalInput}
              onReady={handleSshTerminalReady}
              onLink={handleTerminalLink}
              searchPlaceholder={t('terminal.searchPlaceholder')}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};
