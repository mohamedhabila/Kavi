import { readFileSync } from 'fs';
import { join } from 'path';

describe('android litertlm release hardening', () => {
  test('keeps LiteRT-LM JNI callback interfaces and implementers unobfuscated', () => {
    const rules = readFileSync(join(__dirname, '../../android/app/proguard-rules.pro'), 'utf8');

    expect(rules).toContain(
      '-keep class com.google.ai.edge.litertlm.LiteRtLmJni$JniMessageCallback { *; }',
    );
    expect(rules).toContain(
      '-keep class com.google.ai.edge.litertlm.LiteRtLmJni$JniInferenceCallback { *; }',
    );
    expect(rules).toContain(
      '-keep class * implements com.google.ai.edge.litertlm.LiteRtLmJni$JniMessageCallback { *; }',
    );
    expect(rules).toContain(
      '-keep class * implements com.google.ai.edge.litertlm.LiteRtLmJni$JniInferenceCallback { *; }',
    );
  });

  test('keeps LiteRT-LM native method names stable for JNI symbol lookup', () => {
    const rules = readFileSync(join(__dirname, '../../android/app/proguard-rules.pro'), 'utf8');

    expect(rules).toContain('-keepclasseswithmembernames class com.google.ai.edge.litertlm.** {');
    expect(rules).toMatch(/native <methods>;/);
  });
});
