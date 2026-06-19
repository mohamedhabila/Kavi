import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import type { TerminalWebViewRef } from '../../components/terminal/TerminalWebView';
import { useSshSessionStore } from '../../services/ssh/sessionStore';
import type { SshTargetConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type SshSessionRecord = ReturnType<typeof useSshSessionStore.getState>['sessions'][string];

type UseRemoteWorkSshSessionFlowParams = {
  t: TranslationFn;
  sshSessions: SshSessionRecord[];
  openShellSession: (target: SshTargetConfig) => Promise<string>;
  writeShellInput: (sessionId: string, data: string) => Promise<void>;
};

export function useRemoteWorkSshSessionFlow({
  t,
  sshSessions,
  openShellSession,
  writeShellInput,
}: UseRemoteWorkSshSessionFlowParams) {
  const [activeSshSessionId, setActiveSshSessionId] = useState<string | null>(null);
  const [openingShellTargetId, setOpeningShellTargetId] = useState<string | null>(null);
  const sshTerminalRef = useRef<TerminalWebViewRef>(null);
  const sshTerminalReadyRef = useRef(false);
  const renderedSshSessionIdRef = useRef<string | null>(null);
  const renderedSshTranscriptRef = useRef('');

  const activeSshSession = activeSshSessionId
    ? sshSessions.find((session) => session.id === activeSshSessionId) || null
    : null;

  const handleOpenShell = useCallback(
    async (target: SshTargetConfig) => {
      setOpeningShellTargetId(target.id);
      try {
        const existingSession = sshSessions.find(
          (session) => session.targetId === target.id && session.status !== 'closed',
        );
        if (existingSession) {
          setActiveSshSessionId(existingSession.id);
          return;
        }
        const sessionId = await openShellSession(target);
        setActiveSshSessionId(sessionId);
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.sshLaunchFailed'),
        );
      } finally {
        setOpeningShellTargetId(null);
      }
    },
    [openShellSession, sshSessions, t],
  );

  const resetSshTerminalSurface = useCallback(() => {
    sshTerminalReadyRef.current = false;
    renderedSshSessionIdRef.current = null;
    renderedSshTranscriptRef.current = '';
  }, []);

  const syncActiveSshTranscript = useCallback(() => {
    if (!sshTerminalReadyRef.current || !activeSshSession) {
      return;
    }

    const terminal = sshTerminalRef.current;
    if (!terminal) {
      return;
    }

    const transcript = activeSshSession.transcript || '';
    if (renderedSshSessionIdRef.current !== activeSshSession.id) {
      terminal.reset();
      renderedSshSessionIdRef.current = activeSshSession.id;
      renderedSshTranscriptRef.current = '';
    }

    const previousTranscript = renderedSshTranscriptRef.current;
    if (transcript === previousTranscript) {
      return;
    }

    if (previousTranscript && transcript.startsWith(previousTranscript)) {
      const delta = transcript.slice(previousTranscript.length);
      if (delta) {
        terminal.write(delta);
      }
    } else {
      terminal.reset();
      if (transcript) {
        terminal.write(transcript);
      }
    }

    renderedSshTranscriptRef.current = transcript;
  }, [activeSshSession]);

  useEffect(() => {
    if (!activeSshSession) {
      resetSshTerminalSurface();
      return;
    }
    syncActiveSshTranscript();
  }, [
    activeSshSession,
    activeSshSession?.id,
    activeSshSession?.transcript,
    resetSshTerminalSurface,
    syncActiveSshTranscript,
  ]);

  const handleSshTerminalReady = useCallback(() => {
    sshTerminalReadyRef.current = true;
    syncActiveSshTranscript();
  }, [syncActiveSshTranscript]);

  const handleSshTerminalInput = useCallback(
    async (data: string) => {
      if (!activeSshSession || activeSshSession.status !== 'connected') {
        return;
      }
      try {
        await writeShellInput(activeSshSession.id, data);
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.sshLaunchFailed'),
        );
      }
    },
    [activeSshSession, t, writeShellInput],
  );

  const handleTerminalLink = useCallback((uri: string) => {
    Linking.openURL(uri).catch((error) => {
      console.warn('[RemoteWorkScreen] Failed to open terminal link:', error);
    });
  }, []);

  const handleCloseSshModal = useCallback(() => {
    resetSshTerminalSurface();
    setActiveSshSessionId(null);
  }, [resetSshTerminalSurface]);

  return {
    activeSshSession,
    activeSshSessionId,
    openingShellTargetId,
    sshTerminalRef,
    handleOpenShell,
    handleSshTerminalReady,
    handleSshTerminalInput,
    handleTerminalLink,
    handleCloseSshModal,
  };
}
