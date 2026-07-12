import assert from 'node:assert/strict';
import { runOpenSshContract } from './run-open-ssh-contract.mjs';

const hostKey = {
  algorithm: 'ssh-ed25519',
  publicKeyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  fingerprintSha256: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
};
const connectionId = 'fixture-connection-0001';
let connected = false;
let closed = false;

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

const adapter = {
  async discoverHostKey() {
    return hostKey;
  },
  async connectVerified(request) {
    if (request.expectedHostKey.fingerprintSha256 !== hostKey.fingerprintSha256) {
      throw codedError('ERR_SSH_HOST_KEY_MISMATCH');
    }
    assert.deepEqual(request.expectedHostKey, hostKey);
    connected = true;
    closed = false;
    return { connectionId, verifiedHostKey: hostKey };
  },
  async exec(request) {
    if (!connected || closed) {
      throw codedError('ERR_SSH_CONNECTION_CLOSED');
    }
    return {
      connectionId: request.connectionId,
      stdout: 'contract-stdout\n',
      stderr: 'contract-stderr\n',
      exitCode: 23,
      signal: null,
      durationMs: 4,
    };
  },
  async disconnect(request) {
    assert.equal(request.connectionId, connectionId);
    closed = true;
    return { connectionId, state: 'disconnected' };
  },
};

const fixture = {
  endpoint: { host: '127.0.0.1', port: 2222 },
  username: 'kavi-contract',
  timeoutMs: 5_000,
  expectedHostKey: hostKey,
  exec: {
    command: "printf 'contract-stdout\\n'; printf 'contract-stderr\\n' >&2; exit 23",
    outputLimitBytes: 4_096,
    expected: {
      stdout: 'contract-stdout\n',
      stderr: 'contract-stderr\n',
      exitCode: 23,
      signal: null,
    },
  },
};

const report = await runOpenSshContract({
  adapter,
  fixture,
  authentication: { kind: 'password', password: 'not-logged-by-the-harness' },
});
assert.equal(report.passed, true);
process.stdout.write('kavi-ssh contract harness self-test passed\n');
