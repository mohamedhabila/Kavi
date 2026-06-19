// ---------------------------------------------------------------------------
// Kavi — Terminal Screen (xterm.js WebView + JS REPL + SSH Shell)
// ---------------------------------------------------------------------------
// Full terminal emulator using xterm.js inside a WebView with PostMessage
// bridge for SSH shell sessions, Termux local shell, and JS REPL mode.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { Menu, Wifi } from 'lucide-react-native';
import { useTranslation } from '../i18n/useTranslation';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { executeJavaScriptWithResult, formatJavaScriptResult } from '../utils/javascript';
import {
  executeLocalShellCommand,
  getLocalRuntimeCapabilities,
  type LocalRuntimeCapabilities,
  type TerminalRuntimeMode,
} from '../services/terminal/localRuntime';
import { TerminalWebViewRef } from '../components/terminal/TerminalWebView';
import { InteractiveTerminalSurface } from '../components/terminal/InteractiveTerminalSurface';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  getSshTargetLabel,
  getSshTargetReadiness,
  openSshShell,
  type ConnectedSshShell,
  type SshReadinessReason,
} from '../services/ssh/connector';
import type { SshTargetConfig } from '../types/remote';

type TerminalMode = TerminalRuntimeMode | 'ssh';
type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

interface SshSessionState {
  targetId: string;
  connected: boolean;
  targetLabel: string;
}

const DEFAULT_CAPABILITIES: LocalRuntimeCapabilities = {
  javascriptAvailable: true,
  shellSupported: Platform.OS === 'android',
  shellAvailable: false,
  shellProvider: null,
  unavailableReason:
    Platform.OS === 'android'
      ? 'Install Termux to enable real local shell commands on Android.'
      : 'Real local shell is only available on Android. Use JavaScript mode or remote SSH.',
};

function getSshReadinessMessageForLocale(reason: SshReadinessReason, t: TranslateFn): string {
  switch (reason) {
    case 'disabled':
      return t('remoteWork.disabledTarget');
    case 'platform-unsupported':
      return t('remoteWork.sshUnsupported');
    case 'missing-verified-transport':
      return t('remoteWork.sshVerificationUnavailable');
    case 'missing-host':
      return t('remoteWork.missingSshHost');
    case 'missing-host-fingerprint':
      return t('remoteWork.missingSshFingerprint');
    case 'missing-username':
      return t('remoteWork.missingSshUsername');
    case 'missing-auth-secret':
      return t('remoteWork.missingSshAuth');
    case 'ready':
    default:
      return t('remoteWork.statusReady');
  }
}

function localizeTerminalUnavailableReason(
  reason: string | undefined,
  t: TranslateFn,
): string | undefined {
  switch (reason) {
    case 'Real local shell is only available on Android in this build. Use JavaScript mode or a remote SSH target.':
      return t('terminal.androidOnlyShellUnavailable');
    case 'The Android Termux bridge is not linked in this build.':
      return t('terminal.termuxBridgeUnavailable');
    case 'Failed to detect local shell runtime.':
      return t('terminal.detectShellRuntimeFailed');
    default:
      return reason;
  }
}

function getSshErrorMessage(error: unknown, t: TranslateFn): string {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'disabled':
      case 'platform-unsupported':
      case 'missing-verified-transport':
      case 'missing-host':
      case 'missing-host-fingerprint':
      case 'missing-username':
      case 'missing-auth-secret':
        return getSshReadinessMessageForLocale(error.message as SshReadinessReason, t);
      case 'ssh-native-module-unavailable':
        return t('terminal.sshNativeModuleUnavailable');
      case 'ssh-host-fingerprint-unavailable':
        return t('terminal.sshFingerprintUnavailable');
      default:
        return error.message;
    }
  }
  return t('terminal.sshConnectionFailed');
}

export const TerminalScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const termRef = useRef<TerminalWebViewRef>(null);
  const activeShellRef = useRef<ConnectedSshShell | null>(null);
  const sshConnectionGenerationRef = useRef(0);
  const isMountedRef = useRef(true);

  const [mode, setMode] = useState<TerminalMode>('javascript');
  const [capabilities, setCapabilities] = useState<LocalRuntimeCapabilities>(DEFAULT_CAPABILITIES);
  const [sshSession, setSshSession] = useState<SshSessionState | null>(null);
  const [connectingTargetId, setConnectingTargetId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [shellCwd, setShellCwd] = useState<string | null>(null);

  const lineBufferRef = useRef('');
  const sshTargets = useSettingsStore((s) => s.sshTargets ?? []);

  useEffect(() => {
    void getLocalRuntimeCapabilities()
      .then(setCapabilities)
      .catch((e) => console.warn('[Terminal] Failed to get runtime capabilities:', e));
  }, []);

  const getTerminalUnavailableReason = useCallback(
    (reason?: string | null) => {
      return (
        localizeTerminalUnavailableReason(reason ?? undefined, t) || t('terminal.shellUnavailable')
      );
    },
    [t],
  );

  useEffect(
    () => () => {
      isMountedRef.current = false;
      sshConnectionGenerationRef.current += 1;
      const shell = activeShellRef.current;
      activeShellRef.current = null;
      try {
        shell?.close();
      } catch {
        // Best-effort cleanup during unmount.
      }
    },
    [],
  );

  // ── SSH shell ────────────────────────────────────────────────────────────

  const closeActiveSshShell = useCallback(() => {
    const shell = activeShellRef.current;
    activeShellRef.current = null;
    try {
      shell?.close();
    } catch {
      // Best-effort cleanup.
    }
  }, []);

  const disconnectSsh = useCallback(
    (notice?: string) => {
      sshConnectionGenerationRef.current += 1;
      closeActiveSshShell();
      if (isMountedRef.current) {
        setConnectingTargetId(null);
        setSshSession(null);
      }
      if (notice) {
        termRef.current?.writeln(`\r\n\x1b[33m${notice}\x1b[0m\r\n`);
      }
    },
    [closeActiveSshShell],
  );

  const connectSsh = useCallback(
    async (target: SshTargetConfig) => {
      const readiness = getSshTargetReadiness(target);
      if (!readiness.launchable) {
        termRef.current?.writeln(
          `\r\n\x1b[31m${getSshReadinessMessageForLocale(readiness.reason, t)}\x1b[0m\r\n`,
        );
        return;
      }

      const targetLabel = getSshTargetLabel(target);
      const connectionGeneration = sshConnectionGenerationRef.current + 1;
      sshConnectionGenerationRef.current = connectionGeneration;
      closeActiveSshShell();
      if (isMountedRef.current) {
        setConnectingTargetId(target.id);
        setSshSession({ targetId: target.id, connected: false, targetLabel });
      }
      termRef.current?.writeln(
        `\r\n\x1b[33m${t('terminal.connectingToTarget', { name: targetLabel })}\x1b[0m\r\n`,
      );

      try {
        const shell = await openSshShell(target, (chunk) => {
          if (sshConnectionGenerationRef.current !== connectionGeneration) {
            return;
          }
          termRef.current?.write(chunk);
        });

        if (sshConnectionGenerationRef.current !== connectionGeneration || !isMountedRef.current) {
          shell.close();
          return;
        }

        activeShellRef.current = shell;
        setSshSession({ targetId: target.id, connected: true, targetLabel });
        termRef.current?.writeln(
          `\x1b[32m${t('terminal.connectedToTarget', { name: target.name || targetLabel })}\x1b[0m\r\n`,
        );
      } catch (err: unknown) {
        if (sshConnectionGenerationRef.current === connectionGeneration) {
          termRef.current?.writeln(
            `\r\n\x1b[31m${t('terminal.sshConnectionFailedWithReason', { reason: getSshErrorMessage(err, t) })}\x1b[0m\r\n`,
          );
          if (isMountedRef.current) {
            setSshSession(null);
          }
        }
      } finally {
        if (sshConnectionGenerationRef.current === connectionGeneration && isMountedRef.current) {
          setConnectingTargetId(null);
        }
      }
    },
    [closeActiveSshShell, t],
  );

  // ── Prompt helpers ───────────────────────────────────────────────────────

  const writePrompt = useCallback(
    (m: TerminalMode) => {
      if (m === 'javascript') {
        termRef.current?.write('\x1b[32mjs>\x1b[0m ');
      } else if (m === 'shell') {
        const dir = shellCwd ? shellCwd.split('/').pop() || '~' : '~';
        termRef.current?.write(`\x1b[34m${dir}\x1b[0m \x1b[33m$\x1b[0m `);
      }
    },
    [shellCwd],
  );

  const writeBanner = useCallback(
    (m: TerminalMode) => {
      termRef.current?.reset();
      if (m === 'ssh') {
        termRef.current?.writeln(`\x1b[1;36m── ${t('terminal.sshBanner')} ──\x1b[0m`);
        termRef.current?.writeln(`${t('terminal.sshSelectTarget')}\r\n`);
      } else if (m === 'shell') {
        termRef.current?.writeln(`\x1b[1;36m── ${t('terminal.localShellBanner')} ──\x1b[0m`);
        if (!capabilities.shellAvailable) {
          termRef.current?.writeln(
            `\x1b[33m${getTerminalUnavailableReason(capabilities.unavailableReason)}\x1b[0m\r\n`,
          );
        }
        writePrompt('shell');
      } else {
        termRef.current?.writeln(`\x1b[1;36m── ${t('terminal.javascriptBanner')} ──\x1b[0m`);
        termRef.current?.writeln(`${t('terminal.javascriptHint')}\r\n`);
        writePrompt('javascript');
      }
    },
    [capabilities, getTerminalUnavailableReason, t, writePrompt],
  );

  // ── Input handling ───────────────────────────────────────────────────────

  const handleInput = useCallback(
    async (data: string) => {
      // SSH mode: forward all keystrokes directly
      if (mode === 'ssh' && sshSession?.connected && activeShellRef.current) {
        try {
          await activeShellRef.current.write(data);
        } catch (err: unknown) {
          termRef.current?.writeln(
            `\r\n\x1b[31m${t('terminal.writeErrorWithReason', { reason: getSshErrorMessage(err, t) })}\x1b[0m`,
          );
          disconnectSsh();
        }
        return;
      }

      // Local shell / JS REPL: line-buffered input
      if (data === '\r' || data === '\n') {
        const cmd = lineBufferRef.current.trim();
        lineBufferRef.current = '';
        termRef.current?.write('\r\n');

        if (!cmd) {
          writePrompt(mode);
          return;
        }
        if (cmd === 'clear') {
          termRef.current?.clear();
          writePrompt(mode);
          return;
        }

        if (mode === 'shell') {
          if (!capabilities.shellAvailable) {
            termRef.current?.writeln(
              `\x1b[31m${getTerminalUnavailableReason(capabilities.unavailableReason)}\x1b[0m`,
            );
          } else {
            try {
              const result = await executeLocalShellCommand(cmd, { workingDirectory: shellCwd });
              if (result.workingDirectory) setShellCwd(result.workingDirectory);
              if (result.stdout) termRef.current?.writeln(result.stdout);
              if (result.stderr) termRef.current?.writeln(`\x1b[31m${result.stderr}\x1b[0m`);
              if (!result.ok && !result.stderr) {
                termRef.current?.writeln(
                  `\x1b[31m${result.errorMessage || `Exit code: ${result.exitCode ?? '?'}`}\x1b[0m`,
                );
              }
            } catch (err: unknown) {
              termRef.current?.writeln(
                `\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`,
              );
            }
          }
        } else {
          try {
            const result = await executeJavaScriptWithResult(cmd);
            if (result !== undefined && result !== null) {
              const formatted = formatJavaScriptResult(result);
              if (formatted !== 'undefined')
                termRef.current?.writeln(`\x1b[37m${formatted}\x1b[0m`);
            }
          } catch (err: unknown) {
            termRef.current?.writeln(
              `\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`,
            );
          }
        }
        writePrompt(mode);
      } else if (data === '\x7f') {
        if (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          termRef.current?.write('\b \b');
        }
      } else if (data.charCodeAt(0) >= 32) {
        lineBufferRef.current += data;
        termRef.current?.write(data);
      }
    },
    [
      mode,
      sshSession,
      capabilities,
      shellCwd,
      writePrompt,
      disconnectSsh,
      getTerminalUnavailableReason,
      t,
    ],
  );

  // ── Lifecycle ────────────────────────────────────────────────────────────

  const handleReady = useCallback(
    (_cols: number, _rows: number) => {
      setIsReady(true);
      writeBanner(mode);
    },
    [mode, writeBanner],
  );

  const handleModeChange = useCallback(
    async (nextMode: TerminalMode) => {
      if (nextMode === mode) return;
      if (mode === 'ssh') {
        disconnectSsh();
      }
      lineBufferRef.current = '';
      setMode(nextMode);
      if (isReady) writeBanner(nextMode);
    },
    [mode, disconnectSsh, writeBanner, isReady],
  );

  const handleLink = useCallback((uri: string) => {
    Linking.openURL(uri).catch((e) => console.warn('[Terminal] Failed to open URL:', e));
  }, []);

  const enabledSshTargets = useMemo(() => sshTargets.filter((t) => t.enabled), [sshTargets]);
  const sshTargetsWithReadiness = useMemo(
    () =>
      enabledSshTargets.map((target) => ({
        target,
        readiness: getSshTargetReadiness(target),
        label: getSshTargetLabel(target),
      })),
    [enabledSshTargets],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('nav.terminal')}</Text>
        <View style={styles.headerActions}>
          {mode === 'ssh' && sshSession?.connected && (
            <View style={styles.connectedBadge}>
              <Wifi size={12} color={colors.success} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.modeBar}>
        {(['javascript', 'shell', 'ssh'] as TerminalMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeButton, mode === m && styles.modeButtonActive]}
            onPress={() => handleModeChange(m)}
          >
            <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
              {m === 'javascript'
                ? t('terminal.modeJavascript')
                : m === 'shell'
                  ? t('terminal.modeShell')
                  : t('terminal.modeSsh')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'ssh' && sshSession && (
        <View style={styles.sshSessionBar}>
          <Text style={styles.sshSessionText} numberOfLines={1}>
            {sshSession.connected
              ? t('terminal.connectedTarget', { name: sshSession.targetLabel })
              : t('terminal.connectingTarget', { name: sshSession.targetLabel })}
          </Text>
          <TouchableOpacity
            onPress={() =>
              disconnectSsh(
                sshSession.connected
                  ? t('terminal.disconnected')
                  : t('terminal.connectionCancelled'),
              )
            }
            hitSlop={8}
          >
            <Text style={styles.sshSessionAction}>
              {sshSession.connected ? t('common.disconnect') : t('common.cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'ssh' && !sshSession?.connected && (
        <View style={styles.sshPicker}>
          {sshTargetsWithReadiness.length === 0 ? (
            <Text style={styles.sshPickerEmpty}>{t('terminal.noSshTargetsHint')}</Text>
          ) : (
            sshTargetsWithReadiness.map(({ target, readiness, label }) => {
              const disabled =
                !readiness.launchable ||
                Boolean(connectingTargetId && connectingTargetId !== target.id);
              const isConnecting = connectingTargetId === target.id;
              return (
                <TouchableOpacity
                  key={target.id}
                  style={[styles.sshTargetBtn, disabled && styles.sshTargetBtnDisabled]}
                  onPress={() => connectSsh(target)}
                  disabled={disabled || isConnecting}
                >
                  <Text style={styles.sshTargetText}>
                    {target.name} ({label})
                  </Text>
                  {isConnecting ? (
                    <Text style={styles.sshTargetMeta}>{t('terminal.connecting')}</Text>
                  ) : !readiness.launchable ? (
                    <Text style={styles.sshTargetMeta}>
                      {getSshReadinessMessageForLocale(readiness.reason, t)}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}

      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <InteractiveTerminalSurface
            ref={termRef}
            colors={colors}
            fontSize={14}
            onInput={handleInput}
            onReady={handleReady}
            onLink={handleLink}
            style={styles.flex}
          />
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.flex}>
          <InteractiveTerminalSurface
            ref={termRef}
            colors={colors}
            fontSize={14}
            onInput={handleInput}
            onReady={handleReady}
            onLink={handleLink}
            style={styles.flex}
          />
        </View>
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerBtn: { padding: 4 },
    connectedBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.success + '22',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modeBar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modeButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    modeButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    modeButtonText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    modeButtonTextActive: { color: colors.onPrimary },
    sshPicker: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sshSessionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sshSessionText: { flex: 1, color: colors.text, fontSize: 13, fontFamily: 'monospace' },
    sshSessionAction: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    sshPickerEmpty: {
      color: colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: 8,
    },
    sshTargetBtn: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 6,
    },
    sshTargetBtnDisabled: { opacity: 0.55 },
    sshTargetText: { color: colors.text, fontSize: 13, fontFamily: 'monospace' },
    sshTargetMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  });
