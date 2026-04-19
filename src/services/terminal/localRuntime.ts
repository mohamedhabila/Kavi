import { NativeModules, Platform } from 'react-native';

export type TerminalRuntimeMode = 'shell' | 'javascript';

export interface LocalRuntimeCapabilities {
  javascriptAvailable: boolean;
  shellSupported: boolean;
  shellAvailable: boolean;
  shellProvider: 'termux' | null;
  unavailableReason?: string;
}

export interface NativeTermuxAvailability {
  available: boolean;
  serviceAvailable: boolean;
  packageName?: string | null;
  versionName?: string | null;
  versionCode?: number | null;
  reason?: string | null;
}

export interface NativeTermuxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errCode: number;
  errorMessage?: string | null;
  stdoutOriginalLength?: number | null;
  stderrOriginalLength?: number | null;
  durationMs: number;
}

export interface LocalShellCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errCode: number;
  errorMessage?: string;
  workingDirectory?: string;
  durationMs: number;
  stdoutWasTruncated: boolean;
  stderrWasTruncated: boolean;
}

interface KaviTermuxModuleShape {
  getAvailability(): Promise<NativeTermuxAvailability>;
  execute(
    command: string,
    workingDirectory: string | null,
    stdin: string | null,
    timeoutMs: number,
  ): Promise<NativeTermuxCommandResult>;
}

const CWD_MARKER = '__KAVI_CWD__:';
export const DEFAULT_LOCAL_SHELL_TIMEOUT_MS = 30_000;

const kaviTermuxModule = NativeModules.KaviTermux as KaviTermuxModuleShape | undefined;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildShellRuntimeCommand(
  command: string,
  workingDirectory?: string | null,
): string {
  const trimmedDirectory = workingDirectory?.trim();
  const lines: string[] = [];

  if (trimmedDirectory) {
    lines.push(`cd ${shellQuote(trimmedDirectory)} >/dev/null 2>&1 || exit 1`);
  }

  lines.push(command);
  lines.push('status=$?');
  lines.push(`printf '\n${CWD_MARKER}%s' "$PWD"`);
  lines.push('exit "$status"');

  return lines.join('\n');
}

export function extractWorkingDirectoryFromStdout(
  stdout: string,
  fallbackDirectory?: string | null,
): { stdout: string; workingDirectory?: string } {
  if (!stdout) {
    return fallbackDirectory ? { stdout, workingDirectory: fallbackDirectory } : { stdout };
  }

  const lastMarker = stdout.lastIndexOf(CWD_MARKER);
  if (lastMarker === -1) {
    return fallbackDirectory ? { stdout, workingDirectory: fallbackDirectory } : { stdout };
  }

  const output = stdout.slice(0, lastMarker).replace(/\n$/, '');
  const workingDirectory =
    stdout.slice(lastMarker + CWD_MARKER.length).trim() || fallbackDirectory || undefined;
  return { stdout: output, workingDirectory };
}

export function normalizeTermuxCommandResult(
  result: NativeTermuxCommandResult,
  fallbackDirectory?: string | null,
): LocalShellCommandResult {
  const normalized = extractWorkingDirectoryFromStdout(result.stdout || '', fallbackDirectory);
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : null;
  const errCode = typeof result.errCode === 'number' ? result.errCode : -1;
  const stdoutOriginalLength = result.stdoutOriginalLength ?? null;
  const stderrOriginalLength = result.stderrOriginalLength ?? null;

  return {
    ok: errCode === -1 && (exitCode == null || exitCode === 0),
    stdout: normalized.stdout,
    stderr: result.stderr || '',
    exitCode,
    errCode,
    errorMessage: result.errorMessage || undefined,
    workingDirectory: normalized.workingDirectory,
    durationMs: result.durationMs,
    stdoutWasTruncated:
      stdoutOriginalLength != null && stdoutOriginalLength > (result.stdout || '').length,
    stderrWasTruncated:
      stderrOriginalLength != null && stderrOriginalLength > (result.stderr || '').length,
  };
}

export async function getLocalRuntimeCapabilities(): Promise<LocalRuntimeCapabilities> {
  if (Platform.OS !== 'android') {
    return {
      javascriptAvailable: true,
      shellSupported: false,
      shellAvailable: false,
      shellProvider: null,
      unavailableReason:
        'Real local shell is only available on Android in this build. Use JavaScript mode or a remote SSH target.',
    };
  }

  if (!kaviTermuxModule?.getAvailability) {
    return {
      javascriptAvailable: true,
      shellSupported: false,
      shellAvailable: false,
      shellProvider: null,
      unavailableReason: 'The Android Termux bridge is not linked in this build.',
    };
  }

  try {
    const availability = await kaviTermuxModule.getAvailability();
    return {
      javascriptAvailable: true,
      shellSupported: true,
      shellAvailable: Boolean(availability.available && availability.serviceAvailable),
      shellProvider: availability.available ? 'termux' : null,
      unavailableReason: availability.reason || undefined,
    };
  } catch (error) {
    return {
      javascriptAvailable: true,
      shellSupported: false,
      shellAvailable: false,
      shellProvider: null,
      unavailableReason:
        error instanceof Error ? error.message : 'Failed to detect local shell runtime.',
    };
  }
}

export async function executeLocalShellCommand(
  command: string,
  options: {
    workingDirectory?: string | null;
    stdin?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<LocalShellCommandResult> {
  if (Platform.OS !== 'android') {
    throw new Error('Local shell execution is only supported on Android in this build.');
  }

  if (!kaviTermuxModule?.execute) {
    throw new Error('The Android Termux bridge is not linked in this build.');
  }

  const nativeResult = await kaviTermuxModule.execute(
    buildShellRuntimeCommand(command, options.workingDirectory),
    null,
    options.stdin ?? null,
    options.timeoutMs ?? DEFAULT_LOCAL_SHELL_TIMEOUT_MS,
  );

  return normalizeTermuxCommandResult(nativeResult, options.workingDirectory);
}
