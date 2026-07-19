import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

const broadPhotoPermissions = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
];

describe('Android photo picker permission hardening', () => {
  it('blocks broad photo access in Expo configuration', () => {
    const appConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'),
    ) as {
      expo: { android: { blockedPermissions: string[]; permissions: string[] } };
    };

    for (const permission of broadPhotoPermissions) {
      expect(appConfig.expo.android.blockedPermissions).toContain(permission);
      expect(appConfig.expo.android.permissions).not.toContain(
        permission.replace('android.permission.', ''),
      );
    }
  });

  it('removes every broad photo declaration from the merged manifest inputs', () => {
    const manifest = fs.readFileSync(
      path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    const permissionDeclarations = [
      ...manifest.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"[^>]*\/>/g),
    ];

    for (const permission of broadPhotoPermissions) {
      const declarations = permissionDeclarations
        .filter((match) => match[1] === permission)
        .map((match) => match[0]);
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).toContain('tools:node="remove"');
    }
  });

  it('does not ship the broad media-library runtime dependency', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).not.toHaveProperty('expo-media-library');
  });
});
