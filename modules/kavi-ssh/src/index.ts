import KaviSshModule from './KaviSshModule';
import {
  KaviSshContractError,
  parseConnectVerifiedRequest,
  parseConnectVerifiedResult,
  parseDisconnectRequest,
  parseDisconnectResult,
  parseDiscoverHostKeyRequest,
  parseExecRequest,
  parseExecResult,
  parseSshHostKey,
} from './contract';
import type {
  ConnectVerifiedRequest,
  ConnectVerifiedResult,
  DisconnectRequest,
  DisconnectResult,
  DiscoverHostKeyRequest,
  ExecRequest,
  ExecResult,
  SshHostKey,
} from './KaviSsh.types';

function requireMatchingHostKey(actual: SshHostKey, expected: SshHostKey): void {
  if (
    actual.algorithm !== expected.algorithm ||
    actual.publicKeyBase64 !== expected.publicKeyBase64 ||
    actual.fingerprintSha256 !== expected.fingerprintSha256
  ) {
    throw new KaviSshContractError('ERR_SSH_INVALID_NATIVE_RESPONSE', 'result.verifiedHostKey');
  }
}

function requireMatchingConnectionId(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new KaviSshContractError('ERR_SSH_INVALID_NATIVE_RESPONSE', 'result.connectionId');
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export async function discoverHostKey(request: DiscoverHostKeyRequest): Promise<SshHostKey> {
  const result = await KaviSshModule.discoverHostKey(parseDiscoverHostKeyRequest(request));
  return parseSshHostKey(result, 'result', true);
}

export async function connectVerified(
  request: ConnectVerifiedRequest,
): Promise<ConnectVerifiedResult> {
  const parsedRequest = parseConnectVerifiedRequest(request);
  const result = parseConnectVerifiedResult(await KaviSshModule.connectVerified(parsedRequest));
  requireMatchingHostKey(result.verifiedHostKey, parsedRequest.expectedHostKey);
  return result;
}

export async function exec(request: ExecRequest): Promise<ExecResult> {
  const parsedRequest = parseExecRequest(request);
  const result = parseExecResult(await KaviSshModule.exec(parsedRequest));
  requireMatchingConnectionId(result.connectionId, parsedRequest.connectionId);
  if (
    utf8ByteLength(result.stdout) + utf8ByteLength(result.stderr) >
    parsedRequest.outputLimitBytes
  ) {
    throw new KaviSshContractError('ERR_SSH_INVALID_NATIVE_RESPONSE', 'result.outputLimitBytes');
  }
  return result;
}

export async function disconnect(request: DisconnectRequest): Promise<DisconnectResult> {
  const parsedRequest = parseDisconnectRequest(request);
  const result = parseDisconnectResult(await KaviSshModule.disconnect(parsedRequest));
  requireMatchingConnectionId(result.connectionId, parsedRequest.connectionId);
  return result;
}

export { KaviSshContractError } from './contract';
export { SSH_NATIVE_MODULE_NAME, SSH_SHA256_FINGERPRINT_PATTERN } from './KaviSsh.types';
export type * from './KaviSsh.types';
