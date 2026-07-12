import type {
  ConnectVerifiedRequest,
  ConnectVerifiedResult,
  DisconnectRequest,
  DisconnectResult,
  DiscoverHostKeyRequest,
  ExecRequest,
  ExecResult,
  KaviSshErrorCode,
  SshAuthentication,
  SshEndpoint,
  SshHostKey,
} from './KaviSsh.types';
import { SSH_SHA256_FINGERPRINT_PATTERN } from './KaviSsh.types';

const SSH_ALGORITHM_PATTERN = /^[a-z0-9][a-z0-9@._+-]{0,127}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9._~-]{16,256}$/;
const SIGNAL_PATTERN = /^[A-Z][A-Z0-9]{0,31}$/;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_COMMAND_LENGTH = 128 * 1024;
const MAX_SECRET_LENGTH = 1024 * 1024;

type ContractErrorCode = Extract<
  KaviSshErrorCode,
  'ERR_SSH_INVALID_ARGUMENT' | 'ERR_SSH_INVALID_NATIVE_RESPONSE'
>;

export class KaviSshContractError extends Error {
  readonly code: ContractErrorCode;
  readonly field: string;

  constructor(code: ContractErrorCode, field: string) {
    super(`${code}: invalid ${field}`);
    this.name = 'KaviSshContractError';
    this.code = code;
    this.field = field;
  }
}

function invalidArgument(field: string): never {
  throw new KaviSshContractError('ERR_SSH_INVALID_ARGUMENT', field);
}

function invalidResponse(field: string): never {
  throw new KaviSshContractError('ERR_SSH_INVALID_NATIVE_RESPONSE', field);
}

function asRecord(value: unknown, field: string, response = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return response ? invalidResponse(field) : invalidArgument(field);
  }
  return value as Record<string, unknown>;
}

function asString(
  value: unknown,
  field: string,
  options: { maxLength: number; response?: boolean; allowEmpty?: boolean },
): string {
  const fail = options.response ? invalidResponse : invalidArgument;
  if (
    typeof value !== 'string' ||
    (!options.allowEmpty && value.length === 0) ||
    value.length > options.maxLength ||
    value.includes('\0')
  ) {
    return fail(field);
  }
  return value;
}

function asBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  response = false,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return response ? invalidResponse(field) : invalidArgument(field);
  }
  return value as number;
}

function parseEndpoint(value: unknown, field: string): SshEndpoint {
  const record = asRecord(value, field);
  const host = asString(record.host, `${field}.host`, { maxLength: 253 });
  if (
    host !== host.trim() ||
    /\s/.test(host) ||
    host.includes('://') ||
    host.includes('/') ||
    host.includes('@')
  ) {
    invalidArgument(`${field}.host`);
  }
  return {
    host,
    port: asBoundedInteger(record.port, `${field}.port`, 1, 65_535),
  };
}

function parseTimeout(value: unknown, field: string): number {
  return asBoundedInteger(value, field, 1, MAX_TIMEOUT_MS);
}

export function parseSshHostKey(value: unknown, field = 'hostKey', response = false): SshHostKey {
  const record = asRecord(value, field, response);
  const fail = response ? invalidResponse : invalidArgument;
  const algorithm = asString(record.algorithm, `${field}.algorithm`, {
    maxLength: 128,
    response,
  });
  const publicKeyBase64 = asString(record.publicKeyBase64, `${field}.publicKeyBase64`, {
    maxLength: 16_384,
    response,
  });
  const fingerprintSha256 = asString(record.fingerprintSha256, `${field}.fingerprintSha256`, {
    maxLength: 50,
    response,
  });

  if (!SSH_ALGORITHM_PATTERN.test(algorithm)) {
    fail(`${field}.algorithm`);
  }
  if (!BASE64_PATTERN.test(publicKeyBase64)) {
    fail(`${field}.publicKeyBase64`);
  }
  if (!SSH_SHA256_FINGERPRINT_PATTERN.test(fingerprintSha256)) {
    fail(`${field}.fingerprintSha256`);
  }

  return { algorithm, publicKeyBase64, fingerprintSha256 };
}

function parseAuthentication(value: unknown, field: string): SshAuthentication {
  const record = asRecord(value, field);
  if (record.kind === 'password') {
    if (record.privateKey !== undefined || record.passphrase !== undefined) {
      invalidArgument(field);
    }
    return {
      kind: 'password',
      password: asString(record.password, `${field}.password`, {
        maxLength: MAX_SECRET_LENGTH,
      }),
    };
  }

  if (record.kind === 'private-key') {
    if (record.password !== undefined) {
      invalidArgument(field);
    }
    const passphrase =
      record.passphrase === undefined
        ? undefined
        : asString(record.passphrase, `${field}.passphrase`, {
            maxLength: MAX_SECRET_LENGTH,
            allowEmpty: true,
          });
    return {
      kind: 'private-key',
      privateKey: asString(record.privateKey, `${field}.privateKey`, {
        maxLength: MAX_SECRET_LENGTH,
      }),
      ...(passphrase === undefined ? {} : { passphrase }),
    };
  }

  return invalidArgument(`${field}.kind`);
}

function parseConnectionId(value: unknown, field: string, response = false): string {
  const connectionId = asString(value, field, { maxLength: 256, response });
  if (!CONNECTION_ID_PATTERN.test(connectionId)) {
    return response ? invalidResponse(field) : invalidArgument(field);
  }
  return connectionId;
}

export function parseDiscoverHostKeyRequest(value: unknown): DiscoverHostKeyRequest {
  const record = asRecord(value, 'request');
  return {
    endpoint: parseEndpoint(record.endpoint, 'request.endpoint'),
    timeoutMs: parseTimeout(record.timeoutMs, 'request.timeoutMs'),
  };
}

export function parseConnectVerifiedRequest(value: unknown): ConnectVerifiedRequest {
  const record = asRecord(value, 'request');
  const username = asString(record.username, 'request.username', { maxLength: 255 });
  if (username !== username.trim() || /[\u0000-\u001f\u007f]/.test(username)) {
    invalidArgument('request.username');
  }
  return {
    endpoint: parseEndpoint(record.endpoint, 'request.endpoint'),
    username,
    authentication: parseAuthentication(record.authentication, 'request.authentication'),
    expectedHostKey: parseSshHostKey(record.expectedHostKey, 'request.expectedHostKey'),
    timeoutMs: parseTimeout(record.timeoutMs, 'request.timeoutMs'),
  };
}

export function parseConnectVerifiedResult(value: unknown): ConnectVerifiedResult {
  const record = asRecord(value, 'result', true);
  return {
    connectionId: parseConnectionId(record.connectionId, 'result.connectionId', true),
    verifiedHostKey: parseSshHostKey(record.verifiedHostKey, 'result.verifiedHostKey', true),
  };
}

export function parseExecRequest(value: unknown): ExecRequest {
  const record = asRecord(value, 'request');
  return {
    connectionId: parseConnectionId(record.connectionId, 'request.connectionId'),
    command: asString(record.command, 'request.command', { maxLength: MAX_COMMAND_LENGTH }),
    timeoutMs: parseTimeout(record.timeoutMs, 'request.timeoutMs'),
    outputLimitBytes: asBoundedInteger(
      record.outputLimitBytes,
      'request.outputLimitBytes',
      1,
      MAX_OUTPUT_LIMIT_BYTES,
    ),
  };
}

export function parseExecResult(value: unknown): ExecResult {
  const record = asRecord(value, 'result', true);
  const exitCode =
    record.exitCode === null
      ? null
      : asBoundedInteger(record.exitCode, 'result.exitCode', 0, 255, true);
  const signal =
    record.signal === null
      ? null
      : asString(record.signal, 'result.signal', { maxLength: 32, response: true });
  if (
    (exitCode === null) === (signal === null) ||
    (signal !== null && !SIGNAL_PATTERN.test(signal))
  ) {
    invalidResponse('result.termination');
  }
  return {
    connectionId: parseConnectionId(record.connectionId, 'result.connectionId', true),
    stdout: asString(record.stdout, 'result.stdout', {
      maxLength: MAX_OUTPUT_LIMIT_BYTES,
      response: true,
      allowEmpty: true,
    }),
    stderr: asString(record.stderr, 'result.stderr', {
      maxLength: MAX_OUTPUT_LIMIT_BYTES,
      response: true,
      allowEmpty: true,
    }),
    exitCode,
    signal,
    durationMs: asBoundedInteger(record.durationMs, 'result.durationMs', 0, MAX_TIMEOUT_MS, true),
  };
}

export function parseDisconnectRequest(value: unknown): DisconnectRequest {
  const record = asRecord(value, 'request');
  return {
    connectionId: parseConnectionId(record.connectionId, 'request.connectionId'),
    timeoutMs: parseTimeout(record.timeoutMs, 'request.timeoutMs'),
  };
}

export function parseDisconnectResult(value: unknown): DisconnectResult {
  const record = asRecord(value, 'result', true);
  if (record.state !== 'disconnected') {
    invalidResponse('result.state');
  }
  return {
    connectionId: parseConnectionId(record.connectionId, 'result.connectionId', true),
    state: 'disconnected',
  };
}
