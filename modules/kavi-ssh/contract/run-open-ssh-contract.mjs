#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CANONICAL_SHA256_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

function fingerprintForPublicKey(publicKeyBase64) {
  const keyBlob = Buffer.from(publicKeyBase64, 'base64');
  assert.ok(keyBlob.length > 0, 'host public key must decode to a non-empty SSH key blob');
  const digest = createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/u, '');
  return `SHA256:${digest}`;
}

function errorCode(error) {
  return error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function expectErrorCode(operation, expectedCode, label) {
  try {
    await operation();
  } catch (error) {
    assert.equal(errorCode(error), expectedCode, `${label} must reject with ${expectedCode}`);
    return;
  }
  assert.fail(`${label} must reject with ${expectedCode}`);
}

function mutateFingerprint(fingerprint) {
  const digest = Buffer.from(fingerprint.slice('SHA256:'.length), 'base64');
  assert.equal(digest.length, 32, 'fixture fingerprint must decode to exactly 32 bytes');
  digest[0] ^= 0x01;
  return `SHA256:${digest.toString('base64').replace(/=+$/u, '')}`;
}

function assertHostKey(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} must return the exact configured OpenSSH host key`);
  assert.match(actual.fingerprintSha256, CANONICAL_SHA256_PATTERN);
  assert.equal(
    actual.fingerprintSha256,
    fingerprintForPublicKey(actual.publicKeyBase64),
    `${label} fingerprint must be SHA-256 over the decoded SSH wire-format key blob`,
  );
}

function resolveAuthentication(authenticationFixture, environment) {
  assert.ok(authenticationFixture && typeof authenticationFixture === 'object');
  if (authenticationFixture.kind === 'password') {
    const password = environment[authenticationFixture.passwordEnv];
    assert.ok(password, `missing contract secret ${authenticationFixture.passwordEnv}`);
    return { kind: 'password', password };
  }
  if (authenticationFixture.kind === 'private-key') {
    const privateKey = environment[authenticationFixture.privateKeyEnv];
    assert.ok(privateKey, `missing contract secret ${authenticationFixture.privateKeyEnv}`);
    const passphrase = authenticationFixture.passphraseEnv
      ? environment[authenticationFixture.passphraseEnv]
      : undefined;
    return {
      kind: 'private-key',
      privateKey,
      ...(passphrase === undefined ? {} : { passphrase }),
    };
  }
  assert.fail('fixture authentication kind must be password or private-key');
}

/**
 * Runs the provider-neutral verified SSH lifecycle contract against one OpenSSH
 * fixture. The adapter must expose discoverHostKey, connectVerified, exec, and
 * disconnect with the TypeScript shapes in ../src/KaviSsh.types.ts.
 */
export async function runOpenSshContract({ adapter, fixture, authentication }) {
  for (const operation of ['discoverHostKey', 'connectVerified', 'exec', 'disconnect']) {
    assert.equal(
      typeof adapter?.[operation],
      'function',
      `adapter.${operation} must be a function`,
    );
  }

  const discoveryRequest = {
    endpoint: fixture.endpoint,
    timeoutMs: fixture.timeoutMs,
  };
  const discoveredHostKey = await adapter.discoverHostKey(discoveryRequest);
  assertHostKey(discoveredHostKey, fixture.expectedHostKey, 'host-key discovery');

  const connectRequest = {
    endpoint: fixture.endpoint,
    username: fixture.username,
    authentication,
    expectedHostKey: fixture.expectedHostKey,
    timeoutMs: fixture.timeoutMs,
  };
  await expectErrorCode(
    () =>
      adapter.connectVerified({
        ...connectRequest,
        expectedHostKey: {
          ...fixture.expectedHostKey,
          fingerprintSha256: mutateFingerprint(fixture.expectedHostKey.fingerprintSha256),
        },
      }),
    'ERR_SSH_HOST_KEY_MISMATCH',
    'mismatched host-key connect',
  );

  const connection = await adapter.connectVerified(connectRequest);
  assert.equal(typeof connection.connectionId, 'string');
  assert.ok(connection.connectionId.length >= 16, 'connection ID must be opaque and non-trivial');
  assertHostKey(connection.verifiedHostKey, fixture.expectedHostKey, 'verified connect');

  let disconnected = false;
  try {
    const result = await adapter.exec({
      connectionId: connection.connectionId,
      command: fixture.exec.command,
      timeoutMs: fixture.timeoutMs,
      outputLimitBytes: fixture.exec.outputLimitBytes,
    });
    assert.deepEqual(
      {
        connectionId: result.connectionId,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
      },
      {
        connectionId: connection.connectionId,
        ...fixture.exec.expected,
      },
      'exec must preserve stdout, stderr, and remote termination status',
    );
    assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);

    const expectedDisconnect = {
      connectionId: connection.connectionId,
      state: 'disconnected',
    };
    assert.deepEqual(
      await adapter.disconnect({
        connectionId: connection.connectionId,
        timeoutMs: fixture.timeoutMs,
      }),
      expectedDisconnect,
    );
    disconnected = true;
    assert.deepEqual(
      await adapter.disconnect({
        connectionId: connection.connectionId,
        timeoutMs: fixture.timeoutMs,
      }),
      expectedDisconnect,
      'disconnect must be idempotent for an issued connection ID',
    );
    await expectErrorCode(
      () =>
        adapter.exec({
          connectionId: connection.connectionId,
          command: fixture.exec.command,
          timeoutMs: fixture.timeoutMs,
          outputLimitBytes: fixture.exec.outputLimitBytes,
        }),
      'ERR_SSH_CONNECTION_CLOSED',
      'exec after disconnect',
    );
  } finally {
    if (!disconnected) {
      await adapter
        .disconnect({ connectionId: connection.connectionId, timeoutMs: fixture.timeoutMs })
        .catch(() => undefined);
    }
  }

  return {
    passed: true,
    endpoint: fixture.endpoint,
    algorithm: discoveredHostKey.algorithm,
    fingerprintSha256: discoveredHostKey.fingerprintSha256,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert.ok(flag?.startsWith('--') && value, 'usage: --adapter <module> --fixture <json>');
    values[flag.slice(2)] = value;
  }
  assert.ok(values.adapter && values.fixture, 'usage: --adapter <module> --fixture <json>');
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(args.fixture, 'utf8'));
  const adapterModule = await import(pathToFileURL(args.adapter).href);
  const adapter = adapterModule.createAdapter
    ? await adapterModule.createAdapter({ fixture })
    : adapterModule.default;
  const authentication = resolveAuthentication(fixture.authentication, process.env);
  const report = await runOpenSshContract({ adapter, fixture, authentication });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
