export const SSH_NATIVE_MODULE_NAME = 'KaviSsh';

export const SSH_SHA256_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

export type KaviSshErrorCode =
  | 'ERR_SSH_INVALID_ARGUMENT'
  | 'ERR_SSH_INVALID_NATIVE_RESPONSE'
  | 'ERR_SSH_NATIVE_NOT_READY'
  | 'ERR_SSH_TIMEOUT'
  | 'ERR_SSH_HOST_KEY_UNAVAILABLE'
  | 'ERR_SSH_HOST_KEY_MISMATCH'
  | 'ERR_SSH_AUTHENTICATION_FAILED'
  | 'ERR_SSH_CONNECTION_FAILED'
  | 'ERR_SSH_CONNECTION_NOT_FOUND'
  | 'ERR_SSH_CONNECTION_CLOSED'
  | 'ERR_SSH_EXEC_FAILED'
  | 'ERR_SSH_OUTPUT_LIMIT_EXCEEDED'
  | 'ERR_SSH_DISCONNECT_FAILED';

export interface SshEndpoint {
  host: string;
  port: number;
}

/**
 * An OpenSSH host key. `publicKeyBase64` is the base64-encoded SSH wire-format
 * key blob, not a PEM document. Its fingerprint is always canonical OpenSSH
 * SHA-256 form: `SHA256:` plus 43 unpadded base64 characters.
 */
export interface SshHostKey {
  algorithm: string;
  publicKeyBase64: string;
  fingerprintSha256: string;
}

export interface SshPasswordAuthentication {
  kind: 'password';
  password: string;
}

export interface SshPrivateKeyAuthentication {
  kind: 'private-key';
  privateKey: string;
  passphrase?: string;
}

export type SshAuthentication = SshPasswordAuthentication | SshPrivateKeyAuthentication;

export interface DiscoverHostKeyRequest {
  endpoint: SshEndpoint;
  timeoutMs: number;
}

export interface ConnectVerifiedRequest {
  endpoint: SshEndpoint;
  username: string;
  authentication: SshAuthentication;
  expectedHostKey: SshHostKey;
  timeoutMs: number;
}

export interface ConnectVerifiedResult {
  connectionId: string;
  verifiedHostKey: SshHostKey;
}

export interface ExecRequest {
  connectionId: string;
  command: string;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface ExecResult {
  connectionId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
}

export interface DisconnectRequest {
  connectionId: string;
  timeoutMs: number;
}

export interface DisconnectResult {
  connectionId: string;
  state: 'disconnected';
}

export interface KaviSshTransport {
  discoverHostKey(request: DiscoverHostKeyRequest): Promise<SshHostKey>;
  connectVerified(request: ConnectVerifiedRequest): Promise<ConnectVerifiedResult>;
  exec(request: ExecRequest): Promise<ExecResult>;
  disconnect(request: DisconnectRequest): Promise<DisconnectResult>;
}
