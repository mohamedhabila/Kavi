import { Platform } from 'react-native';
import type { SshTargetConfig } from '../../types';

export interface NativeSftpListEntry {
  filename: string;
  isDirectory: boolean;
  modificationDate: string;
  lastAccess: string;
  fileSize: number;
  ownerUserID: number;
  ownerGroupID: number;
  flags: number;
}

export interface NativeSshClient {
  on(eventName: string, handler: (value: any) => void): void;
  execute(command: string): Promise<string>;
  startShell(ptyType: string): Promise<string>;
  writeToShell(command: string): Promise<string>;
  closeShell(): void;
  sftpLs(path: string): Promise<NativeSftpListEntry[]>;
  sftpRename(oldPath: string, newPath: string): Promise<void>;
  sftpMkdir(path: string): Promise<void>;
  sftpRm(path: string): Promise<void>;
  sftpRmdir(path: string): Promise<void>;
  sftpUpload(localFilePath: string, remoteFilePath: string): Promise<void>;
  sftpDownload(remoteFilePath: string, localFilePath: string): Promise<string>;
  disconnect(): void;
}

export const SSH_SHELL_EVENT = 'Shell';
export const SSH_UPLOAD_PROGRESS_EVENT = 'UploadProgress';
export const SSH_DOWNLOAD_PROGRESS_EVENT = 'DownloadProgress';

interface NativeSshModule {
  default?: {
    connectWithPassword(
      host: string,
      port: number,
      username: string,
      password: string,
    ): Promise<NativeSshClient>;
    connectWithKey(
      host: string,
      port: number,
      username: string,
      privateKey: string,
      passphrase?: string,
    ): Promise<NativeSshClient>;
    connectWithVerifiedPassword(
      host: string,
      port: number,
      username: string,
      password: string,
      expectedFingerprint: string,
    ): Promise<NativeSshClient>;
    connectWithVerifiedKey(
      host: string,
      port: number,
      username: string,
      privateKey: string,
      passphrase: string | undefined,
      expectedFingerprint: string,
    ): Promise<NativeSshClient>;
    getHostFingerprint(host: string, port: number, username: string): Promise<string>;
  };
  PtyType?: Record<string, string>;
}

export interface NativeSshCapabilities {
  verifiedPassword: boolean;
  verifiedKey: boolean;
  fingerprintLookup: boolean;
}

export function isNativeSshSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function loadNativeSshModule(): NativeSshModule {
  if (!isNativeSshSupported()) {
    throw new Error('ssh-platform-unsupported');
  }

  try {
    return require('@dylankenneally/react-native-ssh-sftp') as NativeSshModule;
  } catch {
    throw new Error('ssh-native-module-unavailable');
  }
}

function getNativePtyTypeMap(): Record<string, string> {
  const module = loadNativeSshModule();
  return (
    module.PtyType || {
      VANILLA: 'vanilla',
      VT100: 'vt100',
      VT102: 'vt102',
      VT220: 'vt220',
      ANSI: 'ansi',
      XTERM: 'xterm',
    }
  );
}

function getNativeSshClientClass(): NonNullable<NativeSshModule['default']> {
  const module = loadNativeSshModule();
  if (!module.default) {
    throw new Error('ssh-native-module-unavailable');
  }
  return module.default;
}

export function getNativeSshCapabilities(): NativeSshCapabilities {
  const clientClass = getNativeSshClientClass();
  return {
    verifiedPassword: typeof clientClass.connectWithVerifiedPassword === 'function',
    verifiedKey: typeof clientClass.connectWithVerifiedKey === 'function',
    fingerprintLookup: typeof clientClass.getHostFingerprint === 'function',
  };
}

export function supportsVerifiedSshConnections(): boolean {
  if (!isNativeSshSupported()) {
    return false;
  }
  try {
    const capabilities = getNativeSshCapabilities();
    return (
      capabilities.verifiedPassword && capabilities.verifiedKey && capabilities.fingerprintLookup
    );
  } catch {
    return false;
  }
}

export const SSH_AUTH_MODE_OPTIONS: Array<{
  value: NonNullable<SshTargetConfig['authMode']>;
  labelKey: string;
}> = [
  { value: 'password', labelKey: 'settings.sshAuthPassword' },
  { value: 'private-key', labelKey: 'settings.sshAuthPrivateKey' },
];

export const SSH_PTY_OPTIONS: Array<{
  value: NonNullable<SshTargetConfig['ptyType']>;
  label: string;
}> = [
  { value: 'xterm', label: 'xterm' },
  { value: 'vt100', label: 'vt100' },
  { value: 'vt102', label: 'vt102' },
  { value: 'vt220', label: 'vt220' },
  { value: 'ansi', label: 'ansi' },
  { value: 'vanilla', label: 'vanilla' },
];

export function getSshAuthMode(
  target: Pick<SshTargetConfig, 'authMode'>,
): NonNullable<SshTargetConfig['authMode']> {
  return target.authMode || 'password';
}

export function getSshPtyType(target: Pick<SshTargetConfig, 'ptyType'>): string {
  const pty = getNativePtyTypeMap();
  switch (target.ptyType || 'xterm') {
    case 'vanilla':
      return pty.VANILLA;
    case 'vt100':
      return pty.VT100;
    case 'vt102':
      return pty.VT102;
    case 'vt220':
      return pty.VT220;
    case 'ansi':
      return pty.ANSI;
    case 'xterm':
    default:
      return pty.XTERM;
  }
}

export async function connectNativeSshWithPassword(
  target: SshTargetConfig,
  password: string,
): Promise<NativeSshClient> {
  return getNativeSshClientClass().connectWithPassword(
    target.host.trim(),
    target.port || 22,
    target.username.trim(),
    password,
  );
}

export async function connectNativeSshWithVerifiedPassword(
  target: SshTargetConfig,
  password: string,
  expectedFingerprint: string,
): Promise<NativeSshClient> {
  return getNativeSshClientClass().connectWithVerifiedPassword(
    target.host.trim(),
    target.port || 22,
    target.username.trim(),
    password,
    expectedFingerprint,
  );
}

export async function connectNativeSshWithKey(
  target: SshTargetConfig,
  privateKey: string,
  passphrase?: string,
): Promise<NativeSshClient> {
  return getNativeSshClientClass().connectWithKey(
    target.host.trim(),
    target.port || 22,
    target.username.trim(),
    privateKey,
    passphrase,
  );
}

export async function connectNativeSshWithVerifiedKey(
  target: SshTargetConfig,
  privateKey: string,
  passphrase: string | undefined,
  expectedFingerprint: string,
): Promise<NativeSshClient> {
  return getNativeSshClientClass().connectWithVerifiedKey(
    target.host.trim(),
    target.port || 22,
    target.username.trim(),
    privateKey,
    passphrase,
    expectedFingerprint,
  );
}

export async function getNativeSshHostFingerprint(
  target: Pick<SshTargetConfig, 'host' | 'port' | 'username'>,
): Promise<string> {
  return getNativeSshClientClass().getHostFingerprint(
    target.host.trim(),
    target.port || 22,
    target.username.trim(),
  );
}
