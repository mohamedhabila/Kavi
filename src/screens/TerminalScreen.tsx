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
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Wifi } from 'lucide-react-native';
import { useTranslation } from '../i18n/useTranslation';
import { useAppTheme } from '../theme/useAppTheme';
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
import { RouteLeadingButton } from '../components/navigation/RouteLeadingButton';
import { createTerminalScreenStyles } from './terminal/terminalScreenStyles';

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
      : 'Real local shell is only available on Android in this build. Use JavaScript mode or a remote SSH target.',
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
    case 'Install Termux to enable real local shell commands on Android.':
      return t('terminal.termuxInstallRequired');
    case 'Termux is installed, but the RUN_COMMAND service is not available.':
      return t('terminal.termuxServiceUnavailable');
    case 'Failed to detect local shell runtime.':
      return t('terminal.detectShellRuntimeFailed');
    default:
      return t('terminal.shellUnavailable');
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
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createTerminalScreenStyles(colors), [colors]);
  const termRef = useRef<TerminalWebViewRef>(null);
  const activeShellRef = useRef<ConnectedSshShell | null>(null);
  const sshConnectionGenerationRef = useRef(0);
  const isMountedRef = useRef(true);

  const [mode, setMode] = useState<TerminalMode>('javascript');
  const [capabilities, setCapabilities] = useState<LocalRuntimeCapabilities>(DEFAULT_CAPABILITIES);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [sshSession, setSshSession] = useState<SshSessionState | null>(null);
  const [connectingTargetId, setConnectingTargetId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [shellCwd, setShellCwd] = useState<string | null>(null);

  const lineBufferRef = useRef('');
  const sshTargets = useSettingsStore((s) => s.sshTargets ?? []);

  useEffect(() => {
    let active = true;
    void getLocalRuntimeCapabilities()
      .then((nextCapabilities) => {
        if (active) {
          setCapabilities(nextCapabilities);
        }
      })
      .catch((error) => {
        console.warn('[Terminal] Failed to get runtime capabilities:', error);
        if (active) {
          setCapabilities({
            ...DEFAULT_CAPABILITIES,
            shellAvailable: false,
            unavailableReason: 'Failed to detect local shell runtime.',
          });
        }
      })
      .finally(() => {
        if (active) {
          setCapabilitiesLoading(false);
        }
      });

    return () => {
      active = false;
    };
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
        <RouteLeadingButton />
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
            accessibilityLabel={
              m === 'javascript'
                ? t('terminal.modeJavascript')
                : m === 'shell'
                  ? t('terminal.modeShell')
                  : t('terminal.modeSsh')
            }
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            style={[styles.modeButton, mode === m && styles.modeButtonActive]}
            onPress={() => handleModeChange(m)}
            testID={`terminal-mode-${m}`}
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

      {mode === 'shell' && (capabilitiesLoading || !capabilities.shellAvailable) ? (
        <View
          accessibilityLiveRegion="polite"
          style={styles.runtimeNotice}
          testID="terminal-shell-readiness"
        >
          <Text style={styles.runtimeNoticeText}>
            {capabilitiesLoading
              ? t('terminal.checkingShell')
              : getTerminalUnavailableReason(capabilities.unavailableReason)}
          </Text>
        </View>
      ) : null}

      {mode === 'ssh' && sshSession && (
        <View style={styles.sshSessionBar}>
          <Text style={styles.sshSessionText} numberOfLines={1}>
            {sshSession.connected
              ? t('terminal.connectedTarget', { name: sshSession.targetLabel })
              : t('terminal.connectingTarget', { name: sshSession.targetLabel })}
          </Text>
          <TouchableOpacity
            accessibilityLabel={sshSession.connected ? t('common.disconnect') : t('common.cancel')}
            onPress={() =>
              disconnectSsh(
                sshSession.connected
                  ? t('terminal.disconnected')
                  : t('terminal.connectionCancelled'),
              )
            }
            accessibilityRole="button"
            style={styles.sshSessionActionButton}
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
            <View style={styles.sshEmptyState}>
              <Text style={styles.sshPickerEmpty}>{t('terminal.noSshTargetsHint')}</Text>
              <TouchableOpacity
                accessibilityLabel={t('terminal.configureSsh')}
                accessibilityRole="button"
                onPress={() =>
                  navigation.navigate('RemoteWork', { returnTo: { name: 'Terminal' } })
                }
                style={styles.sshSetupButton}
              >
                <Text style={styles.sshSetupButtonText}>{t('terminal.configureSsh')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            sshTargetsWithReadiness.map(({ target, readiness, label }) => {
              const disabled =
                !readiness.launchable ||
                Boolean(connectingTargetId && connectingTargetId !== target.id);
              const isConnecting = connectingTargetId === target.id;
              return (
                <TouchableOpacity
                  key={target.id}
                  accessibilityLabel={`${target.name} (${label})`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: disabled || isConnecting }}
                  style={[styles.sshTargetBtn, disabled && styles.sshTargetBtnDisabled]}
                  onPress={() => connectSsh(target)}
                  disabled={disabled || isConnecting}
                  testID={`terminal-ssh-target-${target.id}`}
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
