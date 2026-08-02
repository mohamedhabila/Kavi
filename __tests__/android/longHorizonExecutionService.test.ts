import { readFileSync } from 'fs';
import { join } from 'path';
import { AndroidConfig } from 'expo/config-plugins';

const projectRoot = join(__dirname, '../..');

describe('Android long-horizon execution service contract', () => {
  it('declares a non-exported special-use service with a concrete Play disclosure', async () => {
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
    );
    const permissions = new Set(
      (manifest.manifest['uses-permission'] ?? []).map((entry) => entry.$?.['android:name']),
    );
    const application = manifest.manifest.application?.[0];
    const service = application?.service?.find(
      (entry) => entry.$?.['android:name'] === '.longhorizon.AndroidLongHorizonExecutionService',
    );
    const subtype = service?.property?.find(
      (entry) => entry.$?.['android:name'] === 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
    );

    expect(permissions).toContain('android.permission.FOREGROUND_SERVICE');
    expect(permissions).toContain('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    expect(permissions).toContain('android.permission.WAKE_LOCK');
    expect(service?.$).toMatchObject({
      'android:exported': 'false',
      'android:foregroundServiceType': 'specialUse',
    });
    expect(subtype?.$?.['android:value']).toEqual(expect.stringContaining('User-initiated'));
    expect(subtype?.$?.['android:value']).toEqual(expect.stringContaining('Stop action'));
  });

  it('owns React Native background scheduling and renews a bounded partial wake lock', () => {
    const source = readFileSync(
      join(
        projectRoot,
        'android/app/src/main/java/com/kavi/app/longhorizon/AndroidLongHorizonExecutionService.kt',
      ),
      'utf8',
    );

    expect(source).toContain('PowerManager.PARTIAL_WAKE_LOCK');
    expect(source).toContain('setReferenceCounted(false)');
    expect(source).toContain('acquire(WAKE_LOCK_TIMEOUT_MS)');
    expect(source).toContain('private const val WAKE_LOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L');
    expect(source).toContain('private const val WAKE_LOCK_RENEWAL_MS = 5L * 60L * 60L * 1000L');
    expect(source).toContain('HeadlessJsTaskContext.getInstance(reactContext)');
    expect(source).toContain('ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY');
    expect(source).toContain('HeadlessJsTaskConfig(');
    expect(source).toContain('0L,');
    expect(source).toContain('mainHandler.postDelayed(renewWakeLock, WAKE_LOCK_RENEWAL_MS)');
    expect(source.match(/releaseExecutionWakeLock\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
