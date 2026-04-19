import { readFileSync } from 'fs';
import { join } from 'path';

describe('android ssh release hardening', () => {
  test('keeps JSch reflective classes in release builds', () => {
    const rules = readFileSync(join(__dirname, '../../android/app/proguard-rules.pro'), 'utf8');

    expect(rules).toContain('-keep,allowoptimization class com.jcraft.jsch.jce.** { *; }');
    expect(rules).toContain(
      '-keep,allowoptimization class com.jcraft.jsch.UserAuthPassword { *; }',
    );
    expect(rules).toContain(
      '-keep,allowoptimization class com.jcraft.jsch.UserAuthPublicKey { *; }',
    );
    expect(rules).toContain('com.jcraft.jsch.jce.Random');
  });

  test('patch-package persists pre-auth host key verification hardening', () => {
    const patch = readFileSync(
      join(__dirname, '../../patches/@dylankenneally+react-native-ssh-sftp+1.6.8.patch'),
      'utf8',
    );

    expect(patch).toContain('ExpectedFingerprintHostKeyRepository');
    expect(patch).toContain('session.setHostKeyRepository(hostKeyRepository);');
    expect(patch).toContain('properties.setProperty("PreferredAuthentications", "none");');
    expect(patch).toContain(
      'properties.setProperty("PreferredAuthentications", password != null ? "password,keyboard-interactive" : "publickey");',
    );
    expect(patch).toContain(
      'properties.setProperty("StrictHostKeyChecking", hostKeyRepository != null ? "yes" : "no");',
    );
    expect(patch).toContain('session.connect(SSH_CONNECT_TIMEOUT_MS);');
    expect(patch).toContain(
      'passphrase == null || passphrase.isEmpty() ? null : passphrase.getBytes()',
    );
    expect(patch).toContain('char[] shellBuffer = new char[1024];');
    expect(patch).toContain('client._bufferedReader.read(shellBuffer, 0, shellBuffer.length)');
    expect(patch).toContain('new String(shellBuffer, 0, charCount)');
    expect(patch).toContain(
      '-          while (client._bufferedReader != null && (line = client._bufferedReader.readLine()) != null) {',
    );
  });
});
