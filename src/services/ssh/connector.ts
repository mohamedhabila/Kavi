import { Directory, File, Paths } from 'expo-file-system';
import { deleteSecure, getSecure } from '../storage/SecureStorage';
import { i18n } from '../../i18n';
import { generateId } from '../../utils/id';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { SshTargetConfig } from '../../types';
import {
  connectNativeSshWithKey,
  connectNativeSshWithVerifiedKey,
  connectNativeSshWithVerifiedPassword,
  connectNativeSshWithPassword,
  getNativeSshHostFingerprint,
  getSshAuthMode,
  getSshPtyType,
  isNativeSshSupported,
  supportsVerifiedSshConnections,
  SSH_SHELL_EVENT,
  type NativeSftpListEntry,
  type NativeSshClient,
} from './native';

export type SshReadinessReason =
  | 'disabled'
  | 'platform-unsupported'
  | 'missing-verified-transport'
  | 'missing-host'
  | 'missing-host-fingerprint'
  | 'missing-username'
  | 'missing-auth-secret'
  | 'ready';

export interface SshTargetReadiness {
  launchable: boolean;
  reason: SshReadinessReason;
}

export interface SshProbeResult {
  ok: boolean;
  message: string;
  checkedAt: number;
}

interface ResolvedSshSecrets {
  authMode: NonNullable<SshTargetConfig['authMode']>;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ConnectedSshClient {
  client: NativeSshClient;
  target: SshTargetConfig;
  authMode: NonNullable<SshTargetConfig['authMode']>;
  disconnect: () => void;
}

export interface ConnectedSshShell {
  target: SshTargetConfig;
  write: (input: string) => Promise<string>;
  close: () => void;
}

export const SSH_HOST_KEY_POLICY_OPTIONS: Array<NonNullable<SshTargetConfig['hostKeyPolicy']>> = [
  'trust-on-first-use',
  'strict',
];

const SSH_TEMP_DIR_NAME = 'ssh';
const MAX_REMOTE_FILE_BYTES = 512 * 1024;

function normalizeHostFingerprint(fingerprint?: string | null): string | undefined {
  const normalized = (fingerprint || '').trim().replace(/-/g, ':').toUpperCase();
  return normalized || undefined;
}

export function getSshHostKeyPolicy(
  target: Pick<SshTargetConfig, 'hostKeyPolicy'>,
): NonNullable<SshTargetConfig['hostKeyPolicy']> {
  return target.hostKeyPolicy || 'trust-on-first-use';
}

function ensureSshTempDir(): Directory {
  const dir = new Directory(Paths.cache, SSH_TEMP_DIR_NAME);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeRemotePath(target: SshTargetConfig, remotePath?: string): string {
  const trimmed = remotePath?.trim() || '';
  if (!trimmed) {
    return target.remoteRoot?.trim() || '.';
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  const remoteRoot = target.remoteRoot?.trim();
  if (!remoteRoot) {
    return trimmed;
  }
  return `${remoteRoot.replace(/\/+$/g, '')}/${trimmed.replace(/^\/+/, '')}`;
}

function getParentRemotePath(remotePath: string): string {
  const normalized = remotePath.replace(/\/+$/g, '');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) {
    return normalized.startsWith('/') ? '/' : '.';
  }
  if (slashIndex === 0) {
    return '/';
  }
  return normalized.slice(0, slashIndex) || (normalized.startsWith('/') ? '/' : '.');
}

function getRemoteBasename(remotePath: string): string {
  const normalized = remotePath.replace(/\/+$/g, '');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function toNativeLocalPath(
  pathOrFile: Pick<File, 'uri'> | Pick<Directory, 'uri'> | string,
): string {
  const rawPath = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.uri;
  let normalized = rawPath;

  try {
    normalized = new URL(rawPath).pathname;
  } catch {
    normalized = rawPath.replace(/^file:\/\//, '');
    if (normalized === rawPath) {
      normalized = rawPath.replace(/^file:\//, '/');
    }
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function buildRemoteCommand(command: string, cwd?: string): string {
  const parts: string[] = [];
  if (cwd?.trim()) {
    parts.push(`cd ${shellQuote(cwd.trim())}`);
  }
  parts.push(command);
  return `sh -lc ${shellQuote(parts.join(' && '))}`;
}

export function getSshShellEventChunk(event: unknown): string {
  if (typeof event === 'string') {
    return event;
  }
  if (!event || typeof event !== 'object') {
    return '';
  }
  const value = (event as { value?: unknown }).value;
  return typeof value === 'string' ? value : '';
}

async function withConnectedSshClient<T>(
  target: SshTargetConfig,
  callback: (connection: ConnectedSshClient) => Promise<T>,
): Promise<T> {
  const connection = await connectSshTarget(target);
  try {
    return await callback(connection);
  } finally {
    connection.disconnect();
  }
}

export function getSshTargetReadiness(target: SshTargetConfig): SshTargetReadiness {
  if (!target.enabled) {
    return { launchable: false, reason: 'disabled' };
  }
  if (!isNativeSshSupported()) {
    return { launchable: false, reason: 'platform-unsupported' };
  }
  if (!supportsVerifiedSshConnections()) {
    return { launchable: false, reason: 'missing-verified-transport' };
  }
  if (!target.host.trim()) {
    return { launchable: false, reason: 'missing-host' };
  }
  if (!target.username.trim()) {
    return { launchable: false, reason: 'missing-username' };
  }
  if (
    getSshHostKeyPolicy(target) === 'strict' &&
    !normalizeHostFingerprint(target.trustedHostFingerprint)
  ) {
    return { launchable: false, reason: 'missing-host-fingerprint' };
  }
  const authMode = getSshAuthMode(target);
  if (authMode === 'password' && !target.passwordRef) {
    return { launchable: false, reason: 'missing-auth-secret' };
  }
  if (authMode === 'private-key' && !target.privateKeyRef) {
    return { launchable: false, reason: 'missing-auth-secret' };
  }
  return { launchable: true, reason: 'ready' };
}

export function getSshTargetAuthModeLabel(target: Pick<SshTargetConfig, 'authMode'>): string {
  return getSshAuthMode(target) === 'private-key'
    ? i18n.t('settings.sshAuthPrivateKey')
    : i18n.t('settings.sshAuthPassword');
}

export function getSshHostKeyPolicyLabel(target: Pick<SshTargetConfig, 'hostKeyPolicy'>): string {
  return getSshHostKeyPolicy(target) === 'strict'
    ? i18n.t('settings.sshHostKeyPolicyStrict')
    : i18n.t('settings.sshHostKeyPolicyTofu');
}

export function getSshTargetLabel(target: SshTargetConfig): string {
  const host = target.host.trim();
  return host ? `${target.username.trim() || 'user'}@${host}:${target.port || 22}` : target.name;
}

export async function resolveSshSecrets(target: SshTargetConfig): Promise<ResolvedSshSecrets> {
  const authMode = getSshAuthMode(target);
  if (authMode === 'private-key') {
    const privateKey = target.privateKeyRef ? await getSecure(target.privateKeyRef) : '';
    const passphrase = target.passphraseRef ? await getSecure(target.passphraseRef) : '';
    if (!privateKey?.trim()) {
      throw new Error('missing-auth-secret');
    }
    return {
      authMode,
      privateKey,
      passphrase: passphrase?.trim() || undefined,
    };
  }

  const password = target.passwordRef ? await getSecure(target.passwordRef) : '';
  if (!password?.trim()) {
    throw new Error('missing-auth-secret');
  }
  return { authMode, password };
}

export async function getSshHostFingerprint(
  target: Pick<SshTargetConfig, 'host' | 'port' | 'username'>,
): Promise<string> {
  const fingerprint = await getNativeSshHostFingerprint(target);
  const normalized = normalizeHostFingerprint(fingerprint);
  if (!normalized) {
    throw new Error('ssh-host-fingerprint-unavailable');
  }
  return normalized;
}

async function ensureTrustedHostFingerprint(target: SshTargetConfig): Promise<string> {
  const trustedFingerprint = normalizeHostFingerprint(target.trustedHostFingerprint);
  if (trustedFingerprint) {
    return trustedFingerprint;
  }

  if (getSshHostKeyPolicy(target) === 'strict') {
    throw new Error('missing-host-fingerprint');
  }

  const fingerprint = await getSshHostFingerprint(target);
  useSettingsStore.getState().updateSshTarget?.({
    ...target,
    hostKeyPolicy: 'trust-on-first-use',
    trustedHostFingerprint: fingerprint,
  });
  return fingerprint;
}

export async function connectSshTarget(target: SshTargetConfig): Promise<ConnectedSshClient> {
  const readiness = getSshTargetReadiness(target);
  if (!readiness.launchable) {
    throw new Error(readiness.reason);
  }

  const secrets = await resolveSshSecrets(target);
  const expectedFingerprint = await ensureTrustedHostFingerprint(target);
  const client =
    secrets.authMode === 'private-key'
      ? await connectNativeSshWithVerifiedKey(
          target,
          secrets.privateKey || '',
          secrets.passphrase,
          expectedFingerprint,
        )
      : await connectNativeSshWithVerifiedPassword(
          target,
          secrets.password || '',
          expectedFingerprint,
        );

  return {
    client,
    target,
    authMode: secrets.authMode,
    disconnect: () => {
      try {
        client.disconnect();
      } catch {
        // Best-effort cleanup on native disconnect.
      }
    },
  };
}

export async function openSshShell(
  target: SshTargetConfig,
  onData: (chunk: string) => void,
): Promise<ConnectedSshShell> {
  const connection = await connectSshTarget(target);

  try {
    connection.client.on(SSH_SHELL_EVENT, (event) => {
      const chunk = getSshShellEventChunk(event);
      if (chunk) {
        onData(chunk);
      }
    });

    const initialOutput = await connection.client.startShell(getSshPtyType(target));
    if (initialOutput) {
      onData(initialOutput);
    }

    return {
      target,
      write: (input) => connection.client.writeToShell(input),
      close: () => {
        try {
          connection.client.closeShell();
        } catch {
          // Ignore shell-close errors during teardown.
        }
        connection.disconnect();
      },
    };
  } catch (error) {
    connection.disconnect();
    throw error;
  }
}

export async function resolveSshTarget(targetId?: string): Promise<SshTargetConfig> {
  const targets = useSettingsStore.getState().sshTargets || [];
  const enabledTargets = targets.filter((target) => target.enabled);

  if (targetId) {
    const selected = targets.find((target) => target.id === targetId);
    if (!selected) {
      throw new Error('ssh-target-not-found');
    }
    return selected;
  }

  if (enabledTargets.length === 1) {
    return enabledTargets[0];
  }
  if (enabledTargets.length === 0) {
    throw new Error('no-ssh-targets');
  }
  throw new Error('ssh-target-id-required');
}

export async function executeSshCommand(
  target: SshTargetConfig,
  command: string,
  cwd?: string,
): Promise<string> {
  return withConnectedSshClient(target, async ({ client }) => {
    const resolvedCwd = cwd ? normalizeRemotePath(target, cwd) : target.remoteRoot?.trim();
    return client.execute(buildRemoteCommand(command, resolvedCwd));
  });
}

export async function probeSshTarget(target: SshTargetConfig): Promise<SshProbeResult> {
  const checkedAt = Date.now();
  try {
    const output = await executeSshCommand(target, 'pwd');
    const firstLine = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return {
      ok: true,
      message: firstLine ? `Connected · ${firstLine}` : 'Connected',
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'SSH connection failed',
      checkedAt,
    };
  }
}

export async function listSshDirectory(
  target: SshTargetConfig,
  remotePath?: string,
): Promise<NativeSftpListEntry[]> {
  return withConnectedSshClient(target, async ({ client }) => {
    const entries = await client.sftpLs(normalizeRemotePath(target, remotePath));
    return entries
      .map((entry) => ({
        ...entry,
        filename: entry.isDirectory ? entry.filename.replace(/\/+$/g, '') : entry.filename,
      }))
      .filter((entry) => {
        const filename = entry.filename.trim();
        return filename !== '' && filename !== '.' && filename !== '..';
      });
  });
}

export async function readSshTextFile(
  target: SshTargetConfig,
  remotePath: string,
): Promise<string> {
  return withConnectedSshClient(target, async ({ client }) => {
    const resolvedPath = normalizeRemotePath(target, remotePath);
    const tempDir = ensureSshTempDir();
    const downloadDir = new Directory(tempDir, generateId());
    downloadDir.create({ idempotent: true, intermediates: true });
    const remoteBasename = getRemoteBasename(resolvedPath) || 'remote.txt';
    const tempFile = new File(downloadDir, remoteBasename);
    try {
      const expectedLocalFilePath = toNativeLocalPath(tempFile);
      const downloadedPath = await client.sftpDownload(resolvedPath, expectedLocalFilePath);
      const normalizedDownloadedPath = downloadedPath?.trim() || '';
      const downloadedFileCandidates = [
        tempFile,
        new File(expectedLocalFilePath),
        new File(`file://${expectedLocalFilePath}`),
        ...(normalizedDownloadedPath
          ? [
              new File(normalizedDownloadedPath),
              ...(normalizedDownloadedPath.startsWith('file://') ||
              normalizedDownloadedPath.startsWith('file:/')
                ? []
                : [new File(`file://${normalizedDownloadedPath}`)]),
            ]
          : []),
      ];
      const existingLocalFile = downloadedFileCandidates.find((candidate) => candidate.exists);
      if (existingLocalFile) {
        const content = await existingLocalFile.text();
        if (content.length > MAX_REMOTE_FILE_BYTES) {
          throw new Error('remote-file-too-large');
        }
        return content;
      }

      if (!normalizedDownloadedPath) {
        throw new Error('ssh-download-missing');
      }

      let emptyContentFallback: string | null = null;
      for (const candidate of downloadedFileCandidates) {
        try {
          const content = await candidate.text();
          if (content.length > MAX_REMOTE_FILE_BYTES) {
            throw new Error('remote-file-too-large');
          }
          if (content.length > 0) {
            return content;
          }
          if (emptyContentFallback === null) {
            emptyContentFallback = content;
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'remote-file-too-large') {
            throw error;
          }
          continue;
        }
      }

      if (emptyContentFallback !== null) {
        return emptyContentFallback;
      }

      throw new Error('ssh-download-missing');
    } finally {
      if (tempFile.exists) {
        tempFile.delete();
      }
      if (downloadDir.exists) {
        downloadDir.delete();
      }
    }
  });
}

export async function writeSshTextFile(
  target: SshTargetConfig,
  remotePath: string,
  content: string,
): Promise<void> {
  return withConnectedSshClient(target, async ({ client }) => {
    const resolvedPath = normalizeRemotePath(target, remotePath);
    const parentPath = getParentRemotePath(resolvedPath);
    const basename = getRemoteBasename(resolvedPath) || `remote-${generateId()}.txt`;
    const tempDir = ensureSshTempDir();
    const tempFile = new File(tempDir, `${generateId()}-${basename}`);

    tempFile.write(content);
    try {
      await client.execute(buildRemoteCommand(`mkdir -p ${shellQuote(parentPath)}`));
      await client.sftpUpload(toNativeLocalPath(tempFile), parentPath);
      const uploadedPath = `${parentPath.replace(/\/+$/g, '')}/${tempFile.name}`;
      if (uploadedPath !== resolvedPath) {
        await client.sftpRename(uploadedPath, resolvedPath);
      }
    } finally {
      if (tempFile.exists) {
        tempFile.delete();
      }
    }
  });
}

export async function makeSshDirectory(target: SshTargetConfig, remotePath: string): Promise<void> {
  return withConnectedSshClient(target, async ({ client }) => {
    await client.sftpMkdir(normalizeRemotePath(target, remotePath));
  });
}

export async function renameSshPath(
  target: SshTargetConfig,
  oldPath: string,
  newPath: string,
): Promise<void> {
  return withConnectedSshClient(target, async ({ client }) => {
    await client.sftpRename(
      normalizeRemotePath(target, oldPath),
      normalizeRemotePath(target, newPath),
    );
  });
}

export async function deleteSshPath(
  target: SshTargetConfig,
  remotePath: string,
  recursive?: boolean,
): Promise<void> {
  return withConnectedSshClient(target, async ({ client }) => {
    const resolvedPath = normalizeRemotePath(target, remotePath);
    try {
      await client.sftpRm(resolvedPath);
      return;
    } catch {
      if (recursive) {
        await client.execute(buildRemoteCommand(`rm -rf ${shellQuote(resolvedPath)}`));
        return;
      }
      await client.sftpRmdir(resolvedPath);
    }
  });
}

export async function clearStoredSshSecrets(target: SshTargetConfig): Promise<void> {
  const refs = [target.passwordRef, target.privateKeyRef, target.passphraseRef].filter(
    Boolean,
  ) as string[];
  await Promise.all(refs.map((ref) => deleteSecure(ref)));
}
